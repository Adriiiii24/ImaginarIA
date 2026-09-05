/**
 * Contratos compartidos entre el cliente, el Route Handler y los adaptadores
 * de proveedor. Este fichero es la unica fuente de verdad del "protocolo"
 * interno de ImaginarIA: si cambia algo aqui, rompe en tiempo de compilacion
 * en los tres extremos, que es exactamente lo que queremos.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: number;
}

/** Lo que el cliente envia a POST /api/chat */
export interface ChatRequestBody {
  messages: Array<Pick<ChatMessage, "role" | "content">>;
  /** Agrupa varios turnos en una misma sesion de Langfuse. */
  sessionId?: string;
}

/**
 * Protocolo de streaming: NDJSON (un objeto JSON por linea, terminado en \n).
 *
 * Elegimos NDJSON sobre texto plano porque necesitamos un canal fuera de banda
 * para el traceId y, sobre todo, para senalizar errores que ocurren *despues*
 * de haber enviado la cabecera 200 (un fallo a mitad de stream no puede
 * expresarse con un codigo HTTP).
 */
export type StreamEvent =
  | { type: "meta"; traceId: string | null; model: string }
  | { type: "delta"; text: string }
  // 'model' aqui es el que ATENDIO de verdad, que puede no ser el anunciado
  // en 'meta' si la cadena tuvo que caer al proveedor de respaldo.
  | { type: "done"; finishReason?: string; model?: string; vendor?: string }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad_request"
  | "rate_limited"
  | "provider_error"
  | "provider_unconfigured"
  | "aborted"
  | "internal";

/** Uso de tokens normalizado entre proveedores (para el coste en Langfuse). */
export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface StreamChatParams {
  systemPrompt: string;
  messages: Array<Pick<ChatMessage, "role" | "content">>;
  signal?: AbortSignal;
}

export interface ProviderChunk {
  text?: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface ChatProvider {
  /** Identificador legible del proveedor, p.ej. "google". */
  readonly vendor: string;
  /** Id exacto del modelo, tal y como se reporta a Langfuse. */
  readonly model: string;
  /** Parametros de inferencia, trazados junto a la generacion. */
  readonly parameters: Record<string, string | number | boolean>;
  stream(params: StreamChatParams): AsyncGenerator<ProviderChunk>;
}
