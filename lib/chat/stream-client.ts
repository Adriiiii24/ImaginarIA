import type { ErrorCode, StreamEvent } from "@/lib/ai/types";

/**
 * Lectura del stream NDJSON de /api/chat en el navegador.
 *
 * Vive fuera del hook para poder probarla sin React: recibe un cuerpo de
 * respuesta y avisa de cada evento. El estado lo pone quien la llama.
 */

type MetaEvent = Extract<StreamEvent, { type: "meta" }>;
type DoneEvent = Extract<StreamEvent, { type: "done" }>;

/** Por qué se ha cortado una respuesta, en términos del cliente. */
export type ChatFailure =
  | ErrorCode
  // El servidor ni siquiera respondió: sin red, DNS, CORS...
  | "network"
  // La respuesta empezó pero la conexión se cerró sin avisar.
  | "interrupted";

export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly code: ChatFailure,
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

export const INTERRUPTED_MESSAGE =
  "Se me ha cortado la respuesta a medias. ¿Lo intento otra vez?";

export interface ChatStreamHandlers {
  onMeta?(event: MetaEvent): void;
  onDelta(text: string): void;
}

/**
 * Lee el stream hasta el evento "done" y lo devuelve.
 *
 * Lanza ChatStreamError si el servidor manda un evento "error", y también si
 * la conexión se cierra sin "done" ni "error". Eso último pasa cuando la
 * plataforma mata la función a mitad (maxDuration) o se cae la red: sin
 * comprobarlo, una respuesta cortada se daría por buena.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
): Promise<DoneEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /** Procesa una línea. Devuelve el evento "done" si lo es. */
  const handle = (raw: string): DoneEvent | undefined => {
    if (!raw) return;

    let event: StreamEvent;
    try {
      event = JSON.parse(raw) as StreamEvent;
    } catch {
      return; // Línea corrupta: se ignora sin romper la respuesta.
    }

    switch (event.type) {
      case "meta":
        handlers.onMeta?.(event);
        return;
      case "delta":
        handlers.onDelta(event.text);
        return;
      case "error":
        throw new ChatStreamError(event.message, event.code);
      case "done":
        return event;
    }
  };

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // Cancelado por el usuario: que llegue tal cual a quien llamó.
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new ChatStreamError(INTERRUPTED_MESSAGE, "interrupted");
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });

      // NDJSON: un evento por línea. El buffer es obligatorio porque un
      // chunk de red puede partir una línea por la mitad.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const raw = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        const done = handle(raw);
        if (done) return done;
      }
    }

    // Una última línea sin salto final también cuenta.
    const done = handle((buffer + decoder.decode()).trim());
    if (done) return done;

    throw new ChatStreamError(INTERRUPTED_MESSAGE, "interrupted");
  } finally {
    // Tras "done" no hace falta esperar a que el servidor cierre.
    reader.cancel().catch(() => {});
  }
}
