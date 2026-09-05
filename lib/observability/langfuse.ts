import type {
  Langfuse,
  LangfuseGenerationClient,
  LangfusePromptClient,
} from "langfuse";
import type { TokenUsage } from "@/lib/ai/types";
import { env } from "@/lib/env";
import {
  IMAGINARIA_SYSTEM_PROMPT,
  SYSTEM_PROMPT_NAME,
  SYSTEM_PROMPT_VERSION,
} from "@/lib/ai/system-prompt";

/**
 * Capa de observabilidad (LLMOps).
 *
 * Tres reglas de oro, y las tres estan implementadas aqui:
 *
 * 1. LA OBSERVABILIDAD NUNCA TUMBA EL PRODUCTO. Si faltan credenciales, si
 *    Langfuse esta caido o si el paquete no esta instalado, la aplicacion
 *    funciona identica y solo pierde las trazas. Cada llamada al SDK vive
 *    dentro de un try/catch y el modo degradado es un objeto no-op con la
 *    misma forma.
 *
 * 2. IMPORTACION DIFERIDA. El SDK se carga con un import() dinamico solo
 *    cuando hay credenciales, para no pagarlo en el arranque en frio de una
 *    funcion serverless donde la observabilidad este desactivada.
 *
 * 3. FLUSH EXPLICITO. Langfuse encola los eventos y los envia por lotes en
 *    segundo plano. En serverless el proceso se congela en cuanto se cierra
 *    la respuesta, asi que sin un flushAsync() esperado las trazas se
 *    pierden silenciosamente. Es el error numero uno al integrar Langfuse.
 */

const isEnabled = (): boolean =>
  Boolean(env("LANGFUSE_PUBLIC_KEY") && env("LANGFUSE_SECRET_KEY"));

/** Handle de una generacion en curso. Ninguno de sus metodos lanza. */
export interface GenerationHandle {
  /** Id de la traza, o null si la observabilidad esta desactivada. */
  readonly traceId: string | null;
  /** Marca el time-to-first-token. Idempotente. */
  markFirstToken(): void;
  end(result: {
    output: string;
    usage?: TokenUsage;
    finishReason?: string;
    /** Proveedor y modelo que atendieron, si la cadena cayo a un respaldo. */
    model?: string;
    vendor?: string;
  }): void;
  fail(error: unknown): void;
}

export interface Observability {
  readonly enabled: boolean;
  startGeneration(input: {
    sessionId?: string;
    userId?: string;
    messages: Array<{ role: string; content: string }>;
    systemPrompt: string;
    vendor: string;
    model: string;
    parameters: Record<string, string | number | boolean>;
    /** Prompt que se ha usado, para enlazar la generacion con su version. */
    prompt: ResolvedPrompt;
  }): GenerationHandle;
  /** Vacia la cola de eventos. Llamar SIEMPRE antes de cerrar el stream. */
  flush(): Promise<void>;
}

const NOOP_GENERATION: GenerationHandle = {
  traceId: null,
  markFirstToken() {},
  end() {},
  fail() {},
};

const NOOP_OBSERVABILITY: Observability = {
  enabled: false,
  startGeneration: () => NOOP_GENERATION,
  flush: async () => {},
};

/**
 * Cliente cacheado a nivel de modulo. En serverless el modulo sobrevive entre
 * invocaciones del mismo contenedor, asi que reutilizamos la instancia (y su
 * cola de envio) en lugar de crear una por peticion.
 */
let clientPromise: Promise<Langfuse | null> | null = null;

async function getClient(): Promise<Langfuse | null> {
  if (!isEnabled()) return null;

  clientPromise ??= (async () => {
    try {
      const { Langfuse: LangfuseClient } = await import("langfuse");
      return new LangfuseClient({
        publicKey: env("LANGFUSE_PUBLIC_KEY")!,
        secretKey: env("LANGFUSE_SECRET_KEY")!,
        // Cloud UE por defecto. Para Cloud US o self-hosted, define
        // LANGFUSE_BASE_URL.
        baseUrl: env("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
        // Distingue dev de produccion en el dashboard sin mezclar metricas.
        environment: env("LANGFUSE_ENVIRONMENT") ?? process.env.NODE_ENV,
        release: env("VERCEL_GIT_COMMIT_SHA"),
        // En serverless queremos enviar cuanto antes, no acumular lotes que
        // nunca se llegan a despachar.
        flushAt: 1,
      });
    } catch (error) {
      // Paquete ausente o constructor fallido: seguimos sin trazas.
      console.warn("[langfuse] inicializacion fallida, trazas desactivadas", error);
      return null;
    }
  })();

  return clientPromise;
}

/**
 * Punto de entrada. Devuelve siempre un objeto usable: nunca null, nunca
 * lanza. El llamante no necesita saber si Langfuse esta configurado.
 */
export async function getObservability(): Promise<Observability> {
  const client = await getClient();
  if (!client) return NOOP_OBSERVABILITY;

  return {
    enabled: true,

    startGeneration(input) {
      try {
        const lastUserMessage =
          [...input.messages].reverse().find((m) => m.role === "user")
            ?.content ?? "";

        const trace = client.trace({
          name: "imaginaria-chat",
          sessionId: input.sessionId,
          userId: input.userId,
          // El input de la traza es la intencion del usuario; el historico
          // completo se guarda en la generacion. Asi el dashboard es legible.
          input: lastUserMessage,
          tags: ["imaginaria", input.vendor],
          metadata: {
            promptVersion: input.prompt.version,
            promptSource: input.prompt.source,
            turns: input.messages.length,
          },
        });

        const generation: LangfuseGenerationClient = trace.generation({
          name: "creative-completion",
          model: input.model,
          modelParameters: input.parameters,
          // Enlaza la generacion con la version exacta del prompt en Langfuse.
          // Es lo que habilita sus metricas por version: latencia, coste y
          // puntuaciones agregadas por cada iteracion del prompt. Solo se
          // enlaza el prompt gestionado; el de respaldo no existe en Langfuse
          // y enlazarlo falsearia esas metricas.
          ...(input.prompt.client ? { prompt: input.prompt.client } : {}),
          // Enviamos el prompt de sistema como parte del input para que la
          // comparacion entre versiones del prompt sea posible en la UI.
          input: [
            { role: "system", content: input.systemPrompt },
            ...input.messages,
          ],
          metadata: {
            promptName: SYSTEM_PROMPT_NAME,
            promptVersion: input.prompt.version,
            promptSource: input.prompt.source,
          },
        });

        let firstTokenAt: Date | null = null;

        return {
          traceId: trace.id,

          markFirstToken() {
            if (firstTokenAt) return;
            firstTokenAt = new Date();
          },

          end({ output, usage, finishReason, model, vendor }) {
            try {
              generation.end({
                output,
                // Si la cadena cayo a un respaldo, corregimos el modelo: de lo
                // contrario Langfuse calcularia el coste con la tarifa del
                // proveedor equivocado.
                ...(model && model !== input.model ? { model } : {}),
                // completionStartTime es lo que Langfuse usa para calcular el
                // time-to-first-token, la metrica que de verdad percibe el
                // usuario en un chat con streaming.
                completionStartTime: firstTokenAt ?? undefined,
                usageDetails: usage && {
                  input: usage.input ?? 0,
                  output: usage.output ?? 0,
                  total: usage.total ?? 0,
                },
                metadata: { finishReason, servedBy: vendor ?? input.vendor },
              });
              trace.update({ output });
            } catch (error) {
              console.warn("[langfuse] fallo al cerrar la generacion", error);
            }
          },

          fail(error) {
            try {
              const message =
                error instanceof Error ? error.message : String(error);
              generation.end({
                level: "ERROR",
                statusMessage: message,
                completionStartTime: firstTokenAt ?? undefined,
              });
              trace.update({ metadata: { failed: true } });
            } catch (nested) {
              console.warn("[langfuse] fallo al registrar el error", nested);
            }
          },
        };
      } catch (error) {
        console.warn("[langfuse] no se pudo abrir la traza", error);
        return NOOP_GENERATION;
      }
    },

    async flush() {
      try {
        await client.flushAsync();
      } catch (error) {
        console.warn("[langfuse] flush fallido", error);
      }
    },
  };
}

/**
 * De donde ha salido el system prompt de esta peticion.
 *
 * Se traza en cada generacion. Si un dia la calidad cae, lo primero que
 * quieres saber es si el modelo estaba leyendo la version publicada en
 * Langfuse o el respaldo del repositorio.
 */
export interface ResolvedPrompt {
  /** Texto del prompt, venga de donde venga. */
  text: string;
  /** "langfuse" si lo sirvio Prompt Management; "local" si es el del repo. */
  source: "langfuse" | "local";
  /** Version de Langfuse ("lf-3") o la constante del repo ("2.0.0"). */
  version: string;
  /**
   * Cliente de Langfuse, solo cuando el prompt viene de alli. Se pasa a la
   * generacion para enlazarla con esa version exacta.
   */
  client?: LangfusePromptClient;
}

const LOCAL_PROMPT: ResolvedPrompt = {
  text: IMAGINARIA_SYSTEM_PROMPT,
  source: "local",
  version: SYSTEM_PROMPT_VERSION,
};

/**
 * Resuelve el system prompt: Langfuse manda, el repositorio es la red.
 *
 * Prompt Management deja iterar el prompt en produccion sin redesplegar. El
 * riesgo evidente es quedarte sin chat si Langfuse falla, y por eso NUNCA se
 * propaga un error desde aqui: ante cualquier problema -sin credenciales, sin
 * red, prompt inexistente- se devuelve el del repositorio y la conversacion
 * sigue.
 *
 * Solo se consulta si LANGFUSE_PROMPT_LABEL tiene valor. Sin el, ni se
 * intenta: el SDK escribe su propio "Prompt not found" en cada peticion
 * aunque capturemos el error, y ese ruido acaba tapando los fallos reales.
 */
export async function resolveSystemPrompt(): Promise<ResolvedPrompt> {
  const label = env("LANGFUSE_PROMPT_LABEL");
  if (!label) return LOCAL_PROMPT;

  const client = await getClient();
  if (!client) return LOCAL_PROMPT;

  try {
    const prompt = await client.getPrompt(SYSTEM_PROMPT_NAME, undefined, {
      label,
      // Cache en memoria: evita una llamada de red por mensaje. Pasados los
      // 60s se refresca en segundo plano, sin bloquear la peticion en curso,
      // asi que publicar una version nueva tarda como mucho un minuto en
      // verse en produccion.
      cacheTtlSeconds: 60,
      // Si Langfuse no contesta a tiempo, este texto se usa igualmente y el
      // cliente vuelve marcado como isFallback.
      fallback: IMAGINARIA_SYSTEM_PROMPT,
      fetchTimeoutMs: 1500,
    });

    // isFallback significa que el SDK devolvio nuestro texto local envuelto en
    // un cliente, no la version publicada. Enlazarlo a la generacion
    // ensuciaria las metricas por version de Langfuse con datos falsos.
    if (prompt.isFallback) return LOCAL_PROMPT;

    return {
      text: prompt.prompt,
      source: "langfuse",
      version: "lf-" + prompt.version,
      client: prompt,
    };
  } catch (error) {
    console.warn("[langfuse] getPrompt fallido, usando el prompt del repositorio", error);
    return LOCAL_PROMPT;
  }
}
