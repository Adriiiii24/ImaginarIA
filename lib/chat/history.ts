import type { ChatRole } from "@/lib/ai/types";

/**
 * El historial que viaja al modelo.
 *
 * Lo comparten el cliente y el servidor: el cliente recorta antes de enviar
 * para que la petición no crezca sin límite, y el servidor vuelve a recortar
 * porque no puede fiarse de que quien llama sea nuestro cliente.
 */

/**
 * Un mensaje del usuario: lo que cabe en el composer.
 *
 * Solo se aplica a lo que escribe el usuario. Las respuestas del asistente las
 * acota AI_MAX_OUTPUT_TOKENS, y cuando alguien pide que se extienda pueden
 * pasar de aquí con todo derecho: rechazarlas al volver en el historial
 * dejaría la conversación bloqueada.
 */
export const MAX_MESSAGE_CHARS = 4_000;

/** Cuántos turnos recientes ve el modelo como mucho. */
export const MAX_HISTORY_MESSAGES = 40;

/** Y cuánto texto suman entre todos. Acota el coste de cada petición. */
export const MAX_HISTORY_CHARS = 24_000;

export interface Turn {
  role: ChatRole;
  content: string;
}

/**
 * Deja el historial en una forma que cualquier proveedor acepta.
 *
 * - Los turnos vacíos se descartan. Aparecen cuando se detiene una respuesta
 *   antes del primer token o cuando el modelo no devuelve nada, y un solo
 *   mensaje vacío basta para que la petición entera se rechace.
 * - Dos turnos seguidos del mismo rol se funden en uno. Pasa cuando una
 *   respuesta falla y el usuario escribe otra vez: para el modelo, es alguien
 *   que ha dicho dos cosas seguidas.
 */
export function normalizeHistory(messages: readonly Turn[]): Turn[] {
  const result: Turn[] = [];

  for (const { role, content } of messages) {
    if (!content.trim()) continue;

    const previous = result[result.length - 1];
    if (previous?.role === role) {
      previous.content += "\n\n" + content;
    } else {
      result.push({ role, content });
    }
  }

  return result;
}

/**
 * Se queda con los turnos más recientes que caben en los límites.
 *
 * Cortar por el principio y no rechazar la petición: una conversación larga
 * sigue funcionando, y lo que el modelo deja de ver es lo más antiguo, que es
 * lo que menos pesa en una lluvia de ideas.
 *
 * El último turno entra siempre. Si él solo desborda el presupuesto (varios
 * mensajes fallidos fundidos en uno), se conserva su final, que es lo último
 * que se escribió.
 */
export function windowHistory(
  messages: readonly Turn[],
  maxMessages: number = MAX_HISTORY_MESSAGES,
  maxChars: number = MAX_HISTORY_CHARS,
): Turn[] {
  const window: Turn[] = [];
  let chars = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];

    if (window.length === 0) {
      const content = tail(message.content, maxChars);
      window.unshift({ role: message.role, content });
      chars += content.length;
      continue;
    }

    if (
      window.length >= maxMessages ||
      chars + message.content.length > maxChars
    ) {
      break;
    }

    window.unshift(message);
    chars += message.content.length;
  }

  // Un historial que empieza con una respuesta del asistente, sin la pregunta
  // que la originó, desorienta al modelo.
  while (window.length > 1 && window[0].role === "assistant") window.shift();

  return window;
}

/** Normaliza y recorta: lo que de verdad llega al modelo. Lo usa el servidor. */
export const prepareHistory = (messages: readonly Turn[]): Turn[] =>
  windowHistory(normalizeHistory(messages));

/**
 * Lo que manda el cliente: sin turnos vacíos y con la ventana reciente.
 *
 * NO funde turnos. El servidor valida el límite de cada mensaje del usuario
 * antes de fundir; si el cliente enviara ya fundidos dos mensajes de 3.000
 * caracteres, el servidor vería uno de 6.000 y lo rechazaría.
 */
export const historyForRequest = (messages: readonly Turn[]): Turn[] =>
  windowHistory(
    messages
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content })),
  );

/** Los últimos `max` caracteres, sin partir un emoji por la mitad. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const first = cut.charCodeAt(0);
  // Segunda mitad de un par sustituto: sola no es un carácter válido.
  return first >= 0xdc00 && first <= 0xdfff ? cut.slice(1) : cut;
}
