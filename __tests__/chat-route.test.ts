import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/chat/route";
import type { StreamEvent } from "@/lib/ai/types";
import {
  chatRequest,
  hangingStream,
  jsonResponse,
  openAiSse,
  readEvents,
  sseResponse,
} from "./helpers";

/**
 * El Route Handler de verdad, con fetch simulado por proveedor. Fuera de
 * Next no hay after(), así que las trazas se vacían en línea: justo el camino
 * de respaldo que conviene tener probado.
 */

type Handler = (init: RequestInit) => Response | Promise<Response>;

const HOLA = { messages: [{ role: "user", content: "hola" }] };

const unexpected: Handler = () => {
  throw new Error("este proveedor no debería haberse llamado");
};

/** Cadena groq -> cerebras, cada uno con su respuesta simulada. */
function providers(
  vendors: string,
  { groq = unexpected, cerebras = unexpected }: { groq?: Handler; cerebras?: Handler },
) {
  vi.stubEnv("AI_PROVIDER", vendors);
  vi.stubEnv("GROQ_API_KEY", "clave-groq");
  vi.stubEnv("CEREBRAS_API_KEY", "clave-cerebras");
  const fetchMock = vi.fn(async (url: string, init: RequestInit) =>
    url.includes("groq") ? groq(init) : cerebras(init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const textOf = (events: StreamEvent[]) =>
  events.map((event) => (event.type === "delta" ? event.text : "")).join("");

beforeEach(() => {
  // Los avisos de failover y los fallos simulados son el comportamiento
  // esperado; en la salida de los tests solo serían ruido.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/chat: streaming", () => {
  it("emite meta, los deltas y done, en NDJSON", async () => {
    providers("groq", { groq: () => sseResponse(openAiSse(["Ho", "la"])) });

    const response = await POST(chatRequest(HOLA));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: "meta", traceId: null });
    expect(textOf(events)).toBe("Hola");
    expect(events.at(-1)).toMatchObject({
      type: "done",
      vendor: "groq",
      finishReason: "stop",
    });
  });

  it("el proveedor recibe el historial ya normalizado", async () => {
    const fetchMock = providers("groq", {
      groq: () => sseResponse(openAiSse(["ok"])),
    });

    await readEvents(
      await POST(
        chatRequest({
          messages: [
            { role: "user", content: "hola" },
            { role: "assistant", content: "" },
            { role: "user", content: "¿sigues?" },
          ],
        }),
      ),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.messages.slice(1)).toEqual([
      { role: "user", content: "hola\n\n¿sigues?" },
    ]);
  });
});

describe("POST /api/chat: failover", () => {
  it("si el primero se queda sin cuota, atiende el siguiente sin que se note", async () => {
    providers("groq,cerebras", {
      groq: () => jsonResponse(429),
      cerebras: () => sseResponse(openAiSse(["respaldo"])),
    });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(textOf(events)).toBe("respaldo");
    expect(events.at(-1)).toMatchObject({ type: "done", vendor: "cerebras" });
  });

  it("si el primero termina sin decir nada, prueba con el siguiente", async () => {
    providers("groq,cerebras", {
      groq: () => sseResponse(openAiSse([])),
      cerebras: () => sseResponse(openAiSse(["algo"])),
    });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(events.at(-1)).toMatchObject({ type: "done", vendor: "cerebras" });
  });

  it("una respuesta vacía del último llega como error, no como un done sin texto", async () => {
    providers("groq", { groq: () => sseResponse(openAiSse([])) });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "empty_response" });
  });

  it("no cambia de proveedor una vez que ha emitido texto", async () => {
    const fetchMock = providers("groq,cerebras", {
      groq: () =>
        sseResponse([
          openAiSse(["Empiezo "])[0],
          'data: {"error":{"message":"se cayó"}}\n\n',
        ]),
    });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(textOf(events)).toBe("Empiezo ");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un 400 es un bug nuestro: no se esconde detrás del respaldo", async () => {
    const fetchMock = providers("groq,cerebras", { groq: () => jsonResponse(400) });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin cuota en toda la cadena, lo dice con su propio mensaje", async () => {
    providers("groq", { groq: () => jsonResponse(429) });

    const events = await readEvents(await POST(chatRequest(HOLA)));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
  });
});

describe("POST /api/chat: cancelación", () => {
  it("si el cliente se va, corta la llamada al proveedor y cierra limpio", async () => {
    let providerSignal: AbortSignal | undefined;
    providers("groq", {
      groq: (init) => {
        providerSignal = init.signal ?? undefined;
        return new Response(hangingStream(init.signal), { status: 200 });
      },
    });

    const client = new AbortController();
    const response = await POST(chatRequest(HOLA, { signal: client.signal }));
    const reader = response.body!.getReader();
    await reader.read(); // meta

    client.abort();
    // El stream termina (sin error) en lugar de quedarse colgado.
    while (!(await reader.read()).done);
    expect(providerSignal?.aborted).toBe(true);
  });
});

describe("POST /api/chat: rechazos previos al stream", () => {
  it("413 con un cuerpo enorme, sin llegar a parsearlo", async () => {
    providers("groq", {});
    const raw = '{"messages":[{"role":"user","content":"' + "x".repeat(300_000) + '"}]}';

    const response = await POST(chatRequest(null, { raw }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
  });

  it("400 con JSON inválido o un payload que no cumple el contrato", async () => {
    providers("groq", {});
    expect((await POST(chatRequest(null, { raw: "{roto" }))).status).toBe(400);
    expect((await POST(chatRequest({ messages: [] }))).status).toBe(400);
  });

  it("503 sin proveedor: el visitante ve un mensaje para humanos, el log el detalle", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");

    const response = await POST(chatRequest(HOLA));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("provider_unconfigured");
    expect(body.error.message).not.toContain("GROQ_API_KEY");
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("GROQ_API_KEY"),
    );
  });

  it("429 con Retry-After al pasar del límite de peticiones", async () => {
    const fromSameIp = () =>
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7" },
        body: "{roto",
      });

    // Las peticiones inválidas también cuentan: el límite va antes que todo.
    for (let i = 0; i < 20; i++) expect((await POST(fromSameIp())).status).toBe(400);

    const limited = await POST(fromSameIp());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("GET /api/chat", () => {
  it("describe la cadena activa sin gastar un token", async () => {
    const fetchMock = providers("groq,cerebras", {});

    const body = await (await GET()).json();
    expect(body).toMatchObject({
      status: "ok",
      chain: [{ vendor: "groq" }, { vendor: "cerebras" }],
      fallback: true,
      tracing: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin claves, dice qué falta sin revelar ningún valor", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    const body = await (await GET()).json();
    expect(body.status).toBe("unconfigured");
    expect(body.problem).toContain("GROQ_API_KEY");
  });
});
