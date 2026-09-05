import type {
  ChatProvider,
  ProviderChunk,
  StreamChatParams,
  TokenUsage,
} from "@/lib/ai/types";

/**
 * Capa de proveedor.
 *
 * Objetivo de diseno: el Route Handler no sabe -ni debe saber- con quien
 * habla. Cada vendor implementa ChatProvider y normaliza su formato de
 * streaming a ProviderChunk. Cambiar de Gemini a Groq es una variable de
 * entorno, no una refactorizacion.
 *
 * Hablamos con las APIs HTTP directamente en lugar de a traves de un SDK
 * envoltorio: son dos endpoints SSE bien documentados, nos ahorra dos
 * dependencias que rotan rapido y nos deja el control exacto de lo que se
 * mide y se traza.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly vendor?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Faltan credenciales: es un fallo de configuracion, no del proveedor. */
export class ProviderUnconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnconfiguredError";
  }
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* -------------------------------------------------------------------------- */
/* Parser SSE compartido                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lee un cuerpo de respuesta SSE y emite el payload de cada linea "data:".
 *
 * Un chunk de red NO equivale a un evento SSE: puede partir un evento por la
 * mitad o traer varios juntos. De ahi el buffer explicito. Es el bug clasico
 * de las integraciones de streaming escritas a mano.
 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:")) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

/** Fallos transitorios del proveedor: saturacion, cuota momentanea, 5xx. */
const RETRIABLE = new Set([429, 500, 502, 503, 504]);

const MAX_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS ?? 3);

/**
 * Lanza la peticion reintentando los fallos transitorios.
 *
 * Solo es seguro reintentar AQUI, antes de haber emitido el primer token: una
 * vez que el cliente esta leyendo texto, repetir la llamada duplicaria la
 * respuesta. Por eso el reintento vive en la apertura del stream y no en el
 * bucle de lectura.
 *
 * Los modelos punteros devuelven 503 "high demand" con bastante frecuencia;
 * sin esto, un pico de demanda le llega al usuario como un chat roto.
 */
async function openStream(
  url: string,
  init: RequestInit,
  vendor: string,
): Promise<Response> {
  let lastDetail = "";
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, init);
    if (response.ok && response.body) return response;

    lastStatus = response.status;
    lastDetail = await response.text().catch(() => "");

    const isLastAttempt = attempt === MAX_ATTEMPTS;
    if (!RETRIABLE.has(response.status) || isLastAttempt) break;

    // Respetamos Retry-After si el proveedor lo indica; si no, backoff
    // exponencial con jitter para no sincronizar reintentos entre instancias.
    // Number(null) es 0, de ahi el > 0: sin el, una cabecera ausente se
    // interpretaria como "espera 0 ms" y anularia el backoff.
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : 400 * 2 ** (attempt - 1) + Math.random() * 250;

    await new Promise((resolve) => setTimeout(resolve, delay));
    if (init.signal?.aborted) break;
  }

  throw new ProviderError(
    vendor + " respondio " + lastStatus + ": " + lastDetail.slice(0, 500),
    lastStatus,
    vendor,
  );
}

/* -------------------------------------------------------------------------- */
/* Google AI Studio (Gemini)                                                  */
/* -------------------------------------------------------------------------- */

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    /** Tokens de razonamiento interno. Se facturan y NO se emiten como texto. */
    thoughtsTokenCount?: number;
  };
}

class GeminiProvider implements ChatProvider {
  readonly vendor = "google";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    readonly parameters: Record<string, number>,
    /**
     * Nivel de razonamiento previo a la respuesta: "low" | "high", o null para
     * no enviar el campo y dejar el valor por defecto del modelo.
     *
     * OJO: los modelos Gemini 3.x usan thinkingLevel; los de la generacion 2.5
     * usaban thinkingConfig.thinkingBudget (un numero de tokens) y devuelven
     * 400 "invalid argument" si les llega thinkingLevel, y viceversa. Si
     * apuntas a un modelo 2.5, pon GEMINI_THINKING_LEVEL=default y ajusta aqui.
     */
    private readonly thinkingLevel: string | null = "low",
  ) {}

  async *stream({
    systemPrompt,
    messages,
    signal,
  }: StreamChatParams): AsyncGenerator<ProviderChunk> {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      this.model +
      ":streamGenerateContent?alt=sse";

    const response = await openStream(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        // En cabecera, nunca en la query string: evita que la clave acabe
        // escrita en los logs de acceso de cualquier proxy intermedio.
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // Gemini llama "model" al rol del asistente.
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: this.parameters.temperature,
          topP: this.parameters.topP,
          maxOutputTokens: this.parameters.maxOutputTokens,
          // Decision consciente: con "low" el primer token llega antes. En un
          // chat de portfolio la latencia percibida pesa mas que el ultimo
          // punto de calidad de razonamiento. Sube a "high" con
          // GEMINI_THINKING_LEVEL si prefieres priorizar profundidad.
          ...(this.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } }
            : {}),
        },
      }),
    }, this.vendor);

    for await (const payload of readSse(response.body!)) {
      if (!payload || payload === "[DONE]") continue;

      let parsed: GeminiStreamChunk;
      try {
        parsed = JSON.parse(payload) as GeminiStreamChunk;
      } catch {
        continue; // keep-alive o fragmento no-JSON: ignorar sin romper.
      }

      const candidate = parsed.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");

      // Los tokens de razonamiento se facturan como salida aunque nunca se
      // vean. Si solo contamos candidatesTokenCount, Langfuse infravalora el
      // coste real -en una peticion tipica, casi a la mitad-.
      const usage: TokenUsage | undefined = parsed.usageMetadata && {
        input: parsed.usageMetadata.promptTokenCount,
        output:
          (parsed.usageMetadata.candidatesTokenCount ?? 0) +
          (parsed.usageMetadata.thoughtsTokenCount ?? 0),
        total: parsed.usageMetadata.totalTokenCount,
      };

      if (text || usage || candidate?.finishReason) {
        yield { text, usage, finishReason: candidate?.finishReason };
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Proveedores con API compatible con OpenAI (Groq, Cerebras, ...)            */
/* -------------------------------------------------------------------------- */

interface GroqStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Una sola implementacion para todos los proveedores que hablan el dialecto de
 * OpenAI. Groq y Cerebras solo se diferencian en la URL base y en si aceptan
 * stream_options, asi que no merecen dos clases.
 */
class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    readonly vendor: string,
    private readonly apiKey: string,
    readonly model: string,
    readonly parameters: Record<string, number>,
    /**
     * Sobreescribible para apuntar a cualquier pasarela compatible (y para
     * probar el pipeline de streaming contra un servidor local sin gastar
     * cuota).
     */
    private readonly baseUrl = "https://api.groq.com/openai/v1",
    /**
     * Groq necesita stream_options para reportar tokens. Cerebras no lo
     * documenta y podria rechazar el parametro desconocido con un 400, asi
     * que ahi lo omitimos y nos conformamos con el 'usage' que envie por su
     * cuenta.
     */
    private readonly includeUsage = true,
  ) {}

  async *stream({
    systemPrompt,
    messages,
    signal,
  }: StreamChatParams): AsyncGenerator<ProviderChunk> {
    const response = await openStream(
      this.baseUrl.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          // Sin esto, un stream compatible con OpenAI nunca reporta uso de
          // tokens, y sin tokens no hay coste calculable en Langfuse.
          ...(this.includeUsage
            ? { stream_options: { include_usage: true } }
            : {}),
          temperature: this.parameters.temperature,
          top_p: this.parameters.topP,
          max_tokens: this.parameters.maxOutputTokens,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
        }),
      },
      this.vendor,
    );

    for await (const payload of readSse(response.body!)) {
      if (!payload || payload === "[DONE]") continue;

      let parsed: GroqStreamChunk;
      try {
        parsed = JSON.parse(payload) as GroqStreamChunk;
      } catch {
        continue;
      }

      const choice = parsed.choices?.[0];
      const usage: TokenUsage | undefined = parsed.usage && {
        input: parsed.usage.prompt_tokens,
        output: parsed.usage.completion_tokens,
        total: parsed.usage.total_tokens,
      };

      if (choice?.delta?.content || usage || choice?.finish_reason) {
        yield {
          text: choice?.delta?.content ?? undefined,
          usage,
          finishReason: choice?.finish_reason ?? undefined,
        };
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Resolucion desde el entorno                                               */
/* -------------------------------------------------------------------------- */

/**
 * Construye el proveedor activo leyendo el entorno.
 *
 * Se invoca por peticion a proposito: el coste es cero y evita cachear un
 * cliente construido con variables de entorno de un despliegue anterior en
 * un proceso serverless reutilizado.
 */
function createProvider(
  vendor: string,
  shared: Record<string, number>,
): ChatProvider {
  if (vendor === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new ProviderUnconfiguredError(
        "groq: falta GROQ_API_KEY (ver .env.example).",
      );
    }
    return new OpenAICompatibleProvider(
      "groq",
      apiKey,
      process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      shared,
      process.env.GROQ_BASE_URL,
    );
  }

  if (vendor === "cerebras") {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new ProviderUnconfiguredError(
        "cerebras: falta CEREBRAS_API_KEY (ver .env.example).",
      );
    }
    return new OpenAICompatibleProvider(
      "cerebras",
      apiKey,
      process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
      shared,
      process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
      false,
    );
  }

  if (vendor === "google") {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new ProviderUnconfiguredError(
        "google: falta GOOGLE_AI_API_KEY (ver .env.example).",
      );
    }
    // "default" (o vacio) omite el campo y deja decidir al modelo.
    const level = process.env.GEMINI_THINKING_LEVEL ?? "low";
    return new GeminiProvider(
      apiKey,
      process.env.GEMINI_MODEL ?? "gemini-3.7-flash",
      shared,
      level === "default" || level === "" ? null : level,
    );
  }

  throw new ProviderUnconfiguredError(
    'AI_PROVIDER="' +
      vendor +
      '" no reconocido. Validos: "google" | "groq" | "cerebras".',
  );
}

/**
 * Construye la cadena de proveedores activa leyendo el entorno.
 *
 * AI_PROVIDER admite una lista separada por comas ("google,groq"): el primero
 * atiende, y los siguientes solo entran si el anterior se queda sin cuota o
 * esta saturado. Un proveedor sin credenciales se omite en silencio, para que
 * anadir un respaldo sea poner una clave y nada mas.
 *
 * Se invoca por peticion a proposito: el coste es cero y evita cachear
 * clientes construidos con variables de entorno de un despliegue anterior en
 * un proceso serverless reutilizado.
 */
export function resolveProviderChain(): ChatProvider[] {
  const vendors = (process.env.AI_PROVIDER ?? "google")
    .split(",")
    .map((vendor) => vendor.trim().toLowerCase())
    .filter(Boolean);

  const shared = {
    temperature: num(process.env.AI_TEMPERATURE, 1),
    topP: num(process.env.AI_TOP_P, 0.95),
    // Holgado a proposito: en los modelos con razonamiento, los tokens de
    // pensamiento se descuentan de este mismo presupuesto. Con 1200 el modelo
    // gastaba ~900 pensando y la respuesta visible se cortaba a media frase.
    maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 4000),
  };

  const chain: ChatProvider[] = [];
  const skipped: string[] = [];

  for (const vendor of vendors) {
    try {
      chain.push(createProvider(vendor, shared));
    } catch (error) {
      if (error instanceof ProviderUnconfiguredError) {
        skipped.push(error.message);
        continue;
      }
      throw error;
    }
  }

  if (chain.length === 0) {
    throw new ProviderUnconfiguredError(
      skipped.join(" | ") || "No hay ningun proveedor de IA configurado.",
    );
  }

  return chain;
}

/**
 * Decide si merece la pena pasar al siguiente proveedor de la cadena.
 *
 * Solo los fallos de disponibilidad: cuota agotada (429) y saturacion o caida
 * (5xx). Un 400 o un 404 son errores nuestros -payload mal formado, modelo
 * inexistente- y reintentarlos en otro proveedor solo esconde el bug.
 */
export function shouldFailover(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const status = error.status ?? 0;
  return status === 429 || status >= 500;
}
