import type {
  ChatRequestBody,
  FeedbackRequestBody,
} from "@/lib/ai/types";
import { MAX_MESSAGE_CHARS, prepareHistory } from "@/lib/chat/history";

/**
 * Validacion de los cuerpos que llegan a la API.
 *
 * A mano en lugar de Zod: los contratos son de dos campos y no merecen una
 * dependencia mas. Si crecen, migra a Zod y comparte el esquema con el
 * cliente.
 *
 * Convencion: cada validador devuelve el cuerpo limpio o un string con el
 * motivo del rechazo, listo para ir en la respuesta 400.
 */

/**
 * Tope del cuerpo de /api/chat. Lo que manda nuestro cliente, ya recortado a
 * MAX_HISTORY_CHARS, ocupa como mucho unos 150 KB en el peor caso (todo
 * caracteres que JSON escapa); el margen es para no rechazar nada legitimo.
 */
export const MAX_CHAT_BODY_BYTES = 256 * 1024;

/**
 * Cuantos mensajes se aceptan en bruto. Nuestro cliente nunca manda mas de
 * MAX_HISTORY_MESSAGES; esto solo frena payloads fabricados a mano.
 */
export const MAX_PAYLOAD_MESSAGES = 200;

export type ValidatedChatRequest = Required<Pick<ChatRequestBody, "messages">> & {
  sessionId?: string;
};

export function validateChatRequest(
  payload: unknown,
): ValidatedChatRequest | string {
  if (typeof payload !== "object" || payload === null) {
    return "El cuerpo debe ser un objeto JSON.";
  }

  const { messages, sessionId } = payload as Record<string, unknown>;

  if (!Array.isArray(messages) || messages.length === 0) {
    return "Se requiere un array 'messages' no vacío.";
  }
  if (messages.length > MAX_PAYLOAD_MESSAGES) {
    return "Demasiados mensajes (máximo " + MAX_PAYLOAD_MESSAGES + ").";
  }

  const clean: ValidatedChatRequest["messages"] = [];

  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      return "Cada mensaje debe ser un objeto.";
    }
    const { role, content } = message as Record<string, unknown>;

    if (role !== "user" && role !== "assistant") {
      return "El rol debe ser 'user' o 'assistant'.";
    }
    if (typeof content !== "string") {
      return "Cada mensaje necesita un 'content' de texto.";
    }
    // Los dos limites son solo para el usuario. Un mensaje del asistente vacio
    // queda asi si se detuvo la respuesta antes del primer token, y
    // prepareHistory lo descarta; uno largo es una respuesta a "desarrollalo",
    // y la ventana de historial ya acota lo que suman entre todos.
    if (role === "user" && content.trim().length === 0) {
      return "Los mensajes del usuario no pueden estar vacíos.";
    }
    if (role === "user" && content.length > MAX_MESSAGE_CHARS) {
      return "Mensaje demasiado largo (máximo " + MAX_MESSAGE_CHARS + " caracteres).";
    }

    clean.push({ role, content });
  }

  // Funde turnos seguidos del mismo rol, descarta los vacios y se queda con
  // la ventana reciente. Una conversacion larga no se rechaza: el modelo deja
  // de ver lo mas antiguo. Ver lib/chat/history.ts.
  const history = prepareHistory(clean);

  if (history[history.length - 1]?.role !== "user") {
    return "El último mensaje debe ser del usuario.";
  }

  return {
    messages: history,
    sessionId: typeof sessionId === "string" ? sessionId.slice(0, 128) : undefined,
  };
}

/** Un id de traza de Langfuse: un UUID, o como mucho algo con su forma. */
const TRACE_ID = /^[\w-]{1,128}$/;

export function validateFeedback(payload: unknown): FeedbackRequestBody | string {
  if (typeof payload !== "object" || payload === null) {
    return "El cuerpo debe ser un objeto JSON.";
  }

  const { traceId, value } = payload as Record<string, unknown>;

  if (typeof traceId !== "string" || !TRACE_ID.test(traceId)) {
    return "Se requiere un 'traceId' válido.";
  }
  if (value !== 0 && value !== 1) {
    return "'value' debe ser 1 (me sirve) o 0 (no me sirve).";
  }

  return { traceId, value };
}
