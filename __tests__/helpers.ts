import type { StreamEvent } from "@/lib/ai/types";

const encoder = new TextEncoder();

/** Un cuerpo de respuesta que emite estos trozos tal cual, en orden. */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Un stream que se queda abierto hasta que se aborta la señal. */
export function hangingStream(signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () =>
        controller.error(new DOMException("Aborted", "AbortError")),
      );
    },
  });
}

/** SSE de un proveedor compatible con OpenAI que dice `parts` y termina. */
export function openAiSse(parts: string[]): string[] {
  return [
    ...parts.map(
      (content) =>
        "data: " +
        JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }) +
        "\n\n",
    ),
    "data: " +
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
      "\n\n",
    "data: " +
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }) +
      "\n\n",
    "data: [DONE]\n\n",
  ];
}

export function sseResponse(chunks: string[]): Response {
  return new Response(streamOf(chunks), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export function jsonResponse(status: number, body: unknown = {}, headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Lee entero un stream NDJSON de /api/chat. */
export async function readEvents(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
}

let ipCounter = 0;

/** Una petición a /api/chat desde una IP distinta cada vez (rate limit). */
export function chatRequest(
  body: unknown,
  init: { signal?: AbortSignal; raw?: string } = {},
): Request {
  ipCounter += 1;
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0." + ipCounter,
    },
    body: init.raw ?? JSON.stringify(body),
    signal: init.signal,
  });
}
