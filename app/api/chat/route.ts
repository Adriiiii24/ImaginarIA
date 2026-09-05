import type { NextRequest } from "next/server";
import {
  ProviderError,
  ProviderUnconfiguredError,
  resolveProviderChain,
  shouldFailover,
} from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import {
  getObservability,
  resolveSystemPrompt,
} from "@/lib/observability/langfuse";
import type {
  ChatRequestBody,
  ErrorCode,
  StreamEvent,
  TokenUsage,
} from "@/lib/ai/types";

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
/* Limites                                                                    */
/* -------------------------------------------------------------------------- */

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOTAL_CHARS = 24_000;

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ventana fija en memoria.
 *
 * ADVERTENCIA HONESTA: esto es por instancia. En serverless con varias
 * instancias activas el limite efectivo se multiplica por el numero de
 * instancias, y se reinicia en cada arranque en frio. Es suficiente para
 * frenar el abuso trivial de un chat de portfolio -y evitar que alguien te
 * funda la cuota de la API en una tarde-, pero si el trafico crece, sustituye
 * este mapa por @upstash/ratelimit con Redis, que es lo unico que da un
 * limite real y distribuido.
 */
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_REQUESTS ?? 20);
const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60) * 1_000;

const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    // Purga barata: sin esto el mapa crece indefinidamente en una instancia
    // de larga vida.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  entry.count += 1;
  return {
    ok: entry.count <= RATE_LIMIT_MAX,
    retryAfter: Math.ceil((entry.resetAt - now) / 1_000),
  };
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "anonymous";
}

/* -------------------------------------------------------------------------- */
/* Validacion                                                                 */
/* -------------------------------------------------------------------------- */

type Validated = Required<Pick<ChatRequestBody, "messages">> & {
  sessionId?: string;
};

/**
 * Validacion a mano en lugar de Zod: el contrato son dos campos y no merece
 * una dependencia mas. Si el payload crece, migra a Zod y comparte el esquema
 * con el cliente.
 */
function validate(payload: unknown): Validated | string {
  if (typeof payload !== "object" || payload === null) {
    return "El cuerpo debe ser un objeto JSON.";
  }

  const { messages, sessionId } = payload as Record<string, unknown>;

  if (!Array.isArray(messages) || messages.length === 0) {
    return "Se requiere un array 'messages' no vacío.";
  }
  if (messages.length > MAX_MESSAGES) {
    return "Conversación demasiado larga (máximo " + MAX_MESSAGES + " mensajes).";
  }

  const clean: Validated["messages"] = [];
  let totalChars = 0;

  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      return "Cada mensaje debe ser un objeto.";
    }
    const { role, content } = message as Record<string, unknown>;

    if (role !== "user" && role !== "assistant") {
      return "El rol debe ser 'user' o 'assistant'.";
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return "Cada mensaje necesita un 'content' de texto no vacío.";
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return "Mensaje demasiado largo (máximo " + MAX_MESSAGE_CHARS + " caracteres).";
    }

    totalChars += content.length;
    clean.push({ role, content });
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return "El historial excede el máximo de " + MAX_TOTAL_CHARS + " caracteres.";
  }
  if (clean[clean.length - 1].role !== "user") {
    return "El último mensaje debe ser del usuario.";
  }

  return {
    messages: clean,
    sessionId: typeof sessionId === "string" ? sessionId.slice(0, 128) : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Utilidades de respuesta                                                    */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

/** Serializa un evento como una linea NDJSON. */
const line = (event: StreamEvent): Uint8Array =>
  encoder.encode(JSON.stringify(event) + "\n");

function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  headers: HeadersInit = {},
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: NextRequest): Promise<Response> {
  const limit = rateLimit(clientKey(request));
  if (!limit.ok) {
    return errorResponse(
      "rate_limited",
      "Demasiadas peticiones. Reinténtalo en " + limit.retryAfter + " segundos.",
      429,
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("bad_request", "JSON inválido.", 400);
  }

  const validated = validate(payload);
  if (typeof validated === "string") {
    return errorResponse("bad_request", validated, 400);
  }

  let chain;
  try {
    chain = resolveProviderChain();
  } catch (error) {
    if (error instanceof ProviderUnconfiguredError) {
      // 503 y no 500: el servicio esta bien, le falta configuracion.
      return errorResponse("provider_unconfigured", error.message, 503);
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

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      let text = "";
      let usage: TokenUsage | undefined;
      let finishReason: string | undefined;

      // Proveedor que finalmente atiende. Puede no ser el primero de la
      // cadena si este se queda sin cuota o esta saturado.
      let servedBy = primary;

      try {
        sink.enqueue(
          line({
            type: "meta",
            traceId: generation.traceId,
            model: primary.model,
          }),
        );

        for (let index = 0; index < chain.length; index++) {
          const provider = chain[index];
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
                sink.enqueue(line({ type: "delta", text: chunk.text }));
              }
            }

            servedBy = provider;
            break;
          } catch (error) {
            if (isLast || emitted || !shouldFailover(error)) throw error;

            console.warn(
              "[api/chat] " + provider.vendor + " no disponible, pasando a " +
                chain[index + 1].vendor,
              error instanceof Error ? error.message : error,
            );
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
          model: servedBy.model,
          vendor: servedBy.vendor,
        });
        sink.enqueue(
          line({
            type: "done",
            finishReason,
            model: servedBy.model,
            vendor: servedBy.vendor,
          }),
        );
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
          });
        } else {
          console.error("[api/chat] fallo durante el stream", error);
          generation.fail(error);

          const isProviderError = error instanceof ProviderError;
          const status = isProviderError ? error.status : undefined;

          // Distinguimos la cuota agotada del resto de fallos. Es el error mas
          // probable en una demo publica sobre el nivel gratuito (Gemini free
          // tier permite 20 peticiones por minuto), y decirle al usuario
          // "reintenta en unos segundos" cuando el proveedor pide un minuto
          // entero solo consigue que reintente y vuelva a fallar.
          const quotaExhausted = status === 429;

          const code: ErrorCode = quotaExhausted
            ? "rate_limited"
            : isProviderError
              ? "provider_error"
              : "internal";

          sink.enqueue(
            line({
              type: "error",
              code,
              // No filtramos el detalle del proveedor al cliente: puede
              // contener trazas internas. Queda en los logs del servidor.
              message: quotaExhausted
                ? "Se ha agotado la cuota del modelo. Espera un minuto y vuelve a intentarlo."
                : "El modelo ha fallado a mitad de respuesta. Reinténtalo en unos segundos.",
            }),
          );
        }
      } finally {
        // Imprescindible: en serverless el proceso se congela en cuanto se
        // cierra la respuesta y los eventos encolados se perderian.
        await observability.flush();
        sink.close();
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
  try {
    chain = resolveProviderChain().map((provider) => ({
      vendor: provider.vendor,
      model: provider.model,
    }));
  } catch {
    chain = [];
  }

  return Response.json(
    {
      status: chain.length > 0 ? "ok" : "unconfigured",
      configured: process.env.AI_PROVIDER ?? "google",
      chain,
      fallback: chain.length > 1,
      tracing: (await getObservability()).enabled,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
