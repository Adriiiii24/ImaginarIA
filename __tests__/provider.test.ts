import { describe, expect, it, vi } from "vitest";
import {
  EmptyResponseError,
  ProviderError,
  readSse,
  resolveProviderChain,
  shouldFailover,
} from "@/lib/ai/provider";
import type { ProviderChunk } from "@/lib/ai/types";
import { jsonResponse, openAiSse, sseResponse, streamOf } from "./helpers";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const MESSAGES = [{ role: "user" as const, content: "hola" }];

function onlyProvider(vendor: "groq" | "google", signal?: AbortSignal) {
  vi.stubEnv("AI_PROVIDER", vendor);
  vi.stubEnv(vendor === "groq" ? "GROQ_API_KEY" : "GOOGLE_AI_API_KEY", "clave");
  const [provider] = resolveProviderChain();
  return collect(provider.stream({ systemPrompt: "SISTEMA", messages: MESSAGES, signal }));
}

const textOf = (chunks: ProviderChunk[]) => chunks.map((chunk) => chunk.text ?? "").join("");

type FetchArgs = [string, RequestInit];
type FetchMock = (...args: FetchArgs) => Promise<Response>;

describe("readSse", () => {
  it("reconstruye un evento partido entre dos chunks de red", async () => {
    const payloads = await collect(
      readSse(streamOf(['data: {"a"', ":1}\n\nda", 'ta: {"b":2}\n\n'])),
    );
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("admite CRLF, varios eventos por chunk y descarta lo que no es data:", async () => {
    const payloads = await collect(
      readSse(streamOf([": keep-alive\r\nevent: x\r\ndata: 1\r\n\r\ndata:2\r\n\r\n"])),
    );
    expect(payloads).toEqual(["1", "2"]);
  });

  it("no pierde la última línea si no acaba en salto", async () => {
    expect(await collect(readSse(streamOf(["data: 1\n", "data: final"])))).toEqual([
      "1",
      "final",
    ]);
  });
});

describe("resolveProviderChain", () => {
  it("omite en silencio los proveedores sin clave", () => {
    vi.stubEnv("AI_PROVIDER", " Google , groq ");
    vi.stubEnv("GROQ_API_KEY", "clave");
    expect(resolveProviderChain().map((provider) => provider.vendor)).toEqual(["groq"]);
  });

  it("sin ninguna clave, dice cuál falta", () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    expect(() => resolveProviderChain()).toThrow(/GROQ_API_KEY/);
  });

  it("rechaza un proveedor que no existe", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    expect(() => resolveProviderChain()).toThrow(/no reconocido/);
  });

  it("lee los parámetros de inferencia del entorno", () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "clave");
    vi.stubEnv("AI_TEMPERATURE", "0.4");
    expect(resolveProviderChain()[0].parameters).toMatchObject({ temperature: 0.4 });
  });
});

describe("adaptador compatible con OpenAI", () => {
  it("normaliza texto, uso y finishReason, y envía el prompt de sistema primero", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      sseResponse(openAiSse(["Hola ", "mundo"])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await onlyProvider("groq");

    expect(textOf(chunks)).toBe("Hola mundo");
    expect(chunks.find((chunk) => chunk.finishReason)?.finishReason).toBe("stop");
    expect(chunks.find((chunk) => chunk.usage)?.usage).toEqual({
      input: 10,
      output: 5,
      total: 15,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { role: "system", content: "SISTEMA" },
      { role: "user", content: "hola" },
    ]);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("convierte un error dentro del stream en ProviderError", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse(['data: {"error":{"message":"overloaded"}}\n\n']),
    );
    await expect(onlyProvider("groq")).rejects.toMatchObject({
      name: "ProviderError",
      status: 502,
    });
  });
});

describe("adaptador de Gemini", () => {
  it("no muestra el razonamiento pero sí lo cuenta en el coste", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        "data: " +
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "pienso en voz baja", thought: true }, { text: "Hola" }],
                },
              },
            ],
          }) +
          "\n\n",
        "data: " +
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: " mundo" }] }, finishReason: "STOP" }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              thoughtsTokenCount: 20,
              totalTokenCount: 35,
            },
          }) +
          "\n\n",
      ]),
    );

    const chunks = await onlyProvider("google");
    expect(textOf(chunks)).toBe("Hola mundo");
    expect(chunks.at(-1)?.usage).toEqual({ input: 10, output: 25, total: 35 });
    expect(chunks.at(-1)?.finishReason).toBe("STOP");
  });

  it("registra el blockReason cuando lo bloqueado es el prompt", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n',
      ]),
    );
    const chunks = await onlyProvider("google");
    expect(textOf(chunks)).toBe("");
    expect(chunks[0].finishReason).toBe("SAFETY");
  });

  it("manda la clave en cabecera, nunca en la URL", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);
    await onlyProvider("google");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain("clave");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("clave");
  });
});

describe("apertura del stream: reintentos y timeouts", () => {
  it("reintenta un 503 y sigue con la respuesta buena", async () => {
    const fetchMock = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(sseResponse(openAiSse(["ok"])));
    vi.stubGlobal("fetch", fetchMock);

    expect(textOf(await onlyProvider("groq"))).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("no reintenta un 429 contra el mismo proveedor", async () => {
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse(429));
    vi.stubGlobal("fetch", fetchMock);

    await expect(onlyProvider("groq")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no espera un Retry-After largo con el usuario delante: cede el turno", async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse(503, {}, { "retry-after": "30" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    const error = await onlyProvider("groq").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(shouldFailover(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("convierte un proveedor colgado en un 504, que activa el failover", async () => {
    vi.stubEnv("AI_CONNECT_TIMEOUT_MS", "50");
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );

    const error = await onlyProvider("groq").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "ProviderError", status: 504 });
    expect(shouldFailover(error)).toBe(true);
  });

  it("reintenta un fallo de red, que llega como 502 si persiste", async () => {
    const fetchMock = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(sseResponse(openAiSse(["recuperado"])));
    vi.stubGlobal("fetch", fetchMock);
    expect(textOf(await onlyProvider("groq"))).toBe("recuperado");

    vi.stubEnv("AI_MAX_ATTEMPTS", "1");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(onlyProvider("groq")).rejects.toMatchObject({ status: 502 });
  });

  it("si el usuario cancela durante la espera, es un aborto y no un fallo del proveedor", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(503));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    await expect(onlyProvider("groq", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("shouldFailover", () => {
  it.each([
    [new ProviderError("cuota", 429), true],
    [new ProviderError("caído", 503), true],
    [new ProviderError("colgado", 504), true],
    [new EmptyResponseError("groq", "SAFETY"), true],
    [new ProviderError("bug nuestro", 400), false],
    [new ProviderError("modelo retirado", 404), false],
    [new Error("cualquier otra cosa"), false],
  ])("%s -> %s", (error, expected) => {
    expect(shouldFailover(error)).toBe(expected);
  });
});
