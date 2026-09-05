import type { Langfuse, LangfuseGenerationClient } from "langfuse";
import type { TokenUsage } from "@/lib/ai/types";
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
  Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

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
        publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
        secretKey: process.env.LANGFUSE_SECRET_KEY!,
        // Cloud UE por defecto. Para Cloud US o self-hosted, define
        // LANGFUSE_BASE_URL.
        baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
        // Distingue dev de produccion en el dashboard sin mezclar metricas.
        environment: process.env.LANGFUSE_ENVIRONMENT ?? process.env.NODE_ENV,
        release: process.env.VERCEL_GIT_COMMIT_SHA,
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
            promptVersion: SYSTEM_PROMPT_VERSION,
            turns: input.messages.length,
          },
        });

        const generation: LangfuseGenerationClient = trace.generation({
          name: "creative-completion",
          model: input.model,
          modelParameters: input.parameters,
          // Enviamos el prompt de sistema como parte del input para que la
          // comparacion entre versiones del prompt sea posible en la UI.
          input: [
            { role: "system", content: input.systemPrompt },
            ...input.messages,
          ],
          metadata: {
            promptName: SYSTEM_PROMPT_NAME,
            promptVersion: SYSTEM_PROMPT_VERSION,
          },
        });

        let firstTokenAt: Date | null = null;

        return {
          traceId: trace.id,

          markFirstToken() {
            if (firstTokenAt) return;
            firstTokenAt = new Date();
          },

          end({ output, usage, finishReason }) {
            try {
              generation.end({
                output,
                // completionStartTime es lo que Langfuse usa para calcular el
                // time-to-first-token, la metrica que de verdad percibe el
                // usuario en un chat con streaming.
                completionStartTime: firstTokenAt ?? undefined,
                usageDetails: usage && {
                  input: usage.input ?? 0,
                  output: usage.output ?? 0,
                  total: usage.total ?? 0,
                },
                metadata: { finishReason },
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
 * Prompt Management: recupera el system prompt publicado en Langfuse para
 * poder iterarlo sin redespliegue, con el prompt local como red de seguridad.
 *
 * Devuelve null si Langfuse esta desactivado o el prompt no existe todavia;
 * el llamante usa entonces IMAGINARIA_SYSTEM_PROMPT. Empieza SIEMPRE con el
 * prompt en codigo y adopta Prompt Management cuando quieras iterar en
 * caliente: asi el repositorio sigue siendo la referencia auditable.
 */
export async function fetchManagedSystemPrompt(): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const prompt = await client.getPrompt(SYSTEM_PROMPT_NAME, undefined, {
      label: process.env.LANGFUSE_PROMPT_LABEL ?? "production",
      // El cache en memoria evita una llamada de red por mensaje; a los 60s
      // se refresca en segundo plano sin bloquear la peticion en curso.
      cacheTtlSeconds: 60,
      fallback: IMAGINARIA_SYSTEM_PROMPT,
      fetchTimeoutMs: 1500,
    });
    return prompt.prompt;
  } catch (error) {
    console.warn("[langfuse] getPrompt fallido, usando prompt local", error);
    return null;
  }
}
