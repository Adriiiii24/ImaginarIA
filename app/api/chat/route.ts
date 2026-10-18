import {
  EmptyResponseError,
  ProviderError,
  ProviderUnconfiguredError,
  resolveProviderChain,
  shouldFailover,
} from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import {
  getObservability,
  resolveSystemPrompt,
  type FailoverRecord,
} from "@/lib/observability/langfuse";
import type {
  ChatProvider,
  ErrorCode,
  StreamEvent,
  TokenUsage,
} from "@/lib/ai/types";
import { MAX_CHAT_BODY_BYTES, validateChatRequest } from "@/lib/chat/validate";
import { env, envNum } from "@/lib/env";
import { errorResponse, readJsonBody, runAfterResponse } from "@/lib/http";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

/**
 * POST /api/chat
 *
 * El unico punto del sistema que conoce las claves de API. El cliente jamas
 * habla con el proveedor de IA: habla con nosotros, y nosotros validamos,
 * limitamos, trazamos y reenviamos.
 *
 * Responde 200 con un stream NDJSON. Ver StreamEvent en lib/ai/types.ts.
 */

// El SDK de Langfuse y el streaming por generadores asincronos requieren
// runtime Node, no Edge.
export const runtime = "nodejs";
// Nada de esta ruta es prerenderizable: depende de la peticion en cada caso.
export const dynamic = "force-dynamic";
// Vercel: margen suficiente para una respuesta larga con streaming.
export const maxDuration = 60;

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

// En memoria y por instancia: ver la advertencia en lib/rate-limit.ts.
const limiter = createRateLimiter({
  max: envNum("RATE_LIMIT_REQUESTS", 20),
  windowMs: envNum("RATE_LIMIT_WINDOW_SECONDS", 60) * 1_000,
});

/* -------------------------------------------------------------------------- */
/* Utilidades de respuesta                                                    */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

/** Serializa un evento como una linea NDJSON. */
const line = (event: StreamEvent): Uint8Array =>
  encoder.encode(JSON.stringify(event) + "\n");

/** Lo que ve el usuario para cada fallo durante el stream. */
function describeFailure(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof EmptyResponseError) {
    return {
      code: "empty_response",
      message: "Me he quedado en blanco. ¿Me lo cuentas de otra forma?",
    };
  }

  // Distinguimos la cuota agotada del resto de fallos. Es el error mas
  // probable en una demo publica sobre el nivel gratuito (Gemini free tier
  // permite 20 peticiones por minuto), y decirle al usuario "reintenta en unos
  // segundos" cuando el proveedor pide un minuto entero solo consigue que
  // reintente y vuelva a fallar.
  if (error instanceof ProviderError && error.status === 429) {
    return {
      code: "rate_limited",
      message: "Me he quedado sin cupo por ahora. Dame un minuto y seguimos.",
    };
  }

  // No filtramos el detalle del proveedor al cliente: puede contener trazas
  // internas. Queda en los logs del servidor.
  return {
    code: error instanceof ProviderError ? "provider_error" : "internal",
    message: "Se me ha cortado a mitad de frase. Prueba otra vez en unos segundos.",
  };
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request): Promise<Response> {
  const limit = limiter.hit(clientKey(request));
  if (!limit.ok) {
    return errorResponse(
      "rate_limited",
      "Vas muy rápido para mí. Dame " + limit.retryAfter + " segundos.",
      429,
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  const body = await readJsonBody(request, MAX_CHAT_BODY_BYTES);
  if (!body.ok) {
    return body.error === "too_large"
      ? errorResponse(
          "payload_too_large",
          "Eso es demasiado texto para mí de una vez.",
          413,
        )
      : errorResponse("bad_request", "JSON inválido.", 400);
  }

  const validated = validateChatRequest(body.value);
  if (typeof validated === "string") {
    return errorResponse("bad_request", validated, 400);
  }

  let chain: ChatProvider[];
  try {
    chain = resolveProviderChain();
  } catch (error) {
    if (error instanceof ProviderUnconfiguredError) {
      // 503 y no 500: el servicio esta bien, le falta configuracion. El
      // detalle (que clave falta) es para quien despliega, no para quien
      // visita: va al log y a GET /api/chat.
      console.error("[api/chat] sin proveedor configurado:", error.message);
      return errorResponse(
        "provider_unconfigured",
        "Ahora mismo no tengo cabeza para ideas: me falta configuración. Vuelve en un rato.",
        503,
      );
    }
    throw error;
  }

  // Langfuse manda sobre el prompt; el del repositorio es la red de
  // seguridad. resolveSystemPrompt no lanza nunca: ante cualquier problema
  // devuelve el local y la conversacion sigue.
  const prompt = await resolveSystemPrompt();
  const systemPrompt = buildSystemPrompt(prompt.text);

  const observability = await getObservability();
  const primary = chain[0];
  const generation = observability.startGeneration({
    sessionId: validated.sessionId,
    messages: validated.messages,
    systemPrompt,
    vendor: primary.vendor,
    model: primary.model,
    parameters: primary.parameters,
    prompt,
  });

  // Cortamos la llamada al proveedor si el cliente cierra la pestana: sin
  // esto seguiriamos pagando tokens de una respuesta que nadie va a leer.
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  // Las trazas se envian DESPUES de cerrar la respuesta. Vaciarlas antes de
  // cerrar el stream -como se hacia- tenia al cliente esperando la ida y
  // vuelta a Langfuse con la respuesta ya completa: el boton de detener
  // seguia ahi y no se podia enviar el siguiente mensaje. 'settled' evita que
  // el vaciado se adelante si el cliente se va a mitad: espera a que la
  // generacion quede registrada, sea como sea que termine.
  let settle = () => {};
  const settled = new Promise<void>((resolve) => (settle = resolve));
  const flushDeferred =
    observability.enabled &&
    runAfterResponse(() => settled.then(() => observability.flush()));

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      // Si el cliente ya se ha ido, escribir en el stream lanza. No es un
      // fallo nuestro y no debe tapar el registro de lo ocurrido.
      const send = (event: StreamEvent) => {
        try {
          sink.enqueue(line(event));
        } catch {}
      };

      let text = "";
      let usage: TokenUsage | undefined;
      let finishReason: string | undefined;

      // Proveedor que esta atendiendo. Puede no ser el primero de la cadena
      // si este se queda sin cuota o esta saturado; y es a el a quien se
      // atribuye la generacion, tambien si se cancela o falla.
      let current = primary;
      const failovers: FailoverRecord[] = [];

      try {
        send({
          type: "meta",
          traceId: generation.traceId,
          model: primary.model,
        });

        for (let index = 0; index < chain.length; index++) {
          const provider = chain[index];
          current = provider;
          const isLast = index === chain.length - 1;
          // Solo podemos cambiar de proveedor mientras no hayamos emitido
          // nada: si el cliente ya esta leyendo texto, reempezar con otro
          // modelo produciria una respuesta con dos comienzos pegados.
          let emitted = false;

          try {
            for await (const chunk of provider.stream({
              systemPrompt,
              messages: validated.messages,
              signal: controller.signal,
            })) {
              if (chunk.usage) usage = { ...usage, ...chunk.usage };
              if (chunk.finishReason) finishReason = chunk.finishReason;

              if (chunk.text) {
                generation.markFirstToken();
                emitted = true;
                text += chunk.text;
                send({ type: "delta", text: chunk.text });
              }
            }

            if (!emitted) {
              throw new EmptyResponseError(provider.vendor, finishReason);
            }
            break;
          } catch (error) {
            if (isLast || emitted || !shouldFailover(error)) throw error;

            const reason = error instanceof Error ? error.message : String(error);
            console.warn(
              "[api/chat] " + provider.vendor + " no disponible, pasando a " +
                chain[index + 1].vendor,
              reason,
            );
            failovers.push({
              vendor: provider.vendor,
              model: provider.model,
              reason: reason.slice(0, 200),
            });
            // Descartamos el uso parcial del proveedor fallido para no
            // atribuirle tokens al que si conteste.
            usage = undefined;
            finishReason = undefined;
          }
        }

        generation.end({
          output: text,
          usage,
          finishReason,
          model: current.model,
          vendor: current.vendor,
          failovers,
        });
        send({
          type: "done",
          finishReason,
          model: current.model,
          vendor: current.vendor,
        });
      } catch (error) {
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");

        if (aborted) {
          // Cancelacion voluntaria: se traza lo generado hasta el corte, no
          // es un error que deba ensuciar el dashboard.
          generation.end({
            output: text,
            usage,
            finishReason: "aborted",
            model: current.model,
            vendor: current.vendor,
            failovers,
          });
        } else {
          const empty = error instanceof EmptyResponseError;
          if (empty) console.warn("[api/chat]", error.message);
          else console.error("[api/chat] fallo durante el stream", error);

          generation.fail(error, {
            // Que el modelo no conteste no es un fallo del sistema.
            level: empty ? "WARNING" : "ERROR",
            output: text,
            model: current.model,
            vendor: current.vendor,
            failovers,
          });
          send({ type: "error", ...describeFailure(error) });
        }
      } finally {
        settle();
        // Sin after() disponible, se vacia aqui, como ultimo recurso: en
        // serverless el proceso se congela al cerrar la respuesta y los
        // eventos encolados se perderian en silencio.
        if (!flushDeferred) await observability.flush();
        try {
          sink.close();
        } catch {}
      }
    },

    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform impide que un proxy intermedio comprima o agrupe el
      // cuerpo; X-Accel-Buffering desactiva el buffer de nginx. Sin ambas,
      // el streaming llega a golpes o directamente de una sola vez.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * GET /api/chat — sonda de salud.
 *
 * Permite al portfolio comprobar si el widget debe habilitarse, y verificar
 * la configuracion de un despliegue sin gastar un solo token. No expone
 * ningun secreto: solo si estan presentes.
 */
export async function GET(): Promise<Response> {
  // Devuelve la cadena completa: asi se ve de un vistazo si el respaldo que
  // creias configurado se esta omitiendo por falta de clave.
  let chain: Array<{ vendor: string; model: string }> = [];
  let problem: string | undefined;
  try {
    chain = resolveProviderChain().map((provider) => ({
      vendor: provider.vendor,
      model: provider.model,
    }));
  } catch (error) {
    // El POST no le cuenta al visitante que clave falta; esto es para quien
    // despliega, y no expone ningun valor.
    problem = error instanceof Error ? error.message : String(error);
  }

  return Response.json(
    {
      status: chain.length > 0 ? "ok" : "unconfigured",
      configured: env("AI_PROVIDER") ?? "google",
      chain,
      fallback: chain.length > 1,
      tracing: (await getObservability()).enabled,
      ...(problem ? { problem } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
