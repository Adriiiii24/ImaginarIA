import { describe, expect, it, vi } from "vitest";
import { env, envNum } from "@/lib/env";
import { readJsonBody } from "@/lib/http";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { pickSuggestions, SUGGESTION_POOL } from "@/lib/suggestions";

describe("createRateLimiter", () => {
  it("deja pasar hasta el máximo y luego pide esperar", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 10_000 });
    expect(limiter.hit("ip", 0).ok).toBe(true);
    expect(limiter.hit("ip", 1).ok).toBe(true);
    const third = limiter.hit("ip", 2_000);
    expect(third).toEqual({ ok: false, retryAfter: 8 });
  });

  it("abre una ventana nueva al caducar la anterior", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
    limiter.hit("ip", 0);
    expect(limiter.hit("ip", 500).ok).toBe(false);
    expect(limiter.hit("ip", 1_001).ok).toBe(true);
  });

  it("cuenta cada clave por separado", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
    expect(limiter.hit("a", 0).ok).toBe(true);
    expect(limiter.hit("b", 0).ok).toBe(true);
  });

  it("nunca pide esperar 0 segundos", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
    limiter.hit("ip", 0);
    expect(limiter.hit("ip", 1_000).retryAfter).toBe(1);
  });
});

describe("clientKey", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost", { headers });

  it("usa el primer valor de x-forwarded-for", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("cae a x-real-ip y luego a una clave compartida", () => {
    expect(clientKey(request({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientKey(request({}))).toBe("anonymous");
  });
});

describe("readJsonBody", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://localhost", { method: "POST", body, headers });

  it("parsea un cuerpo válido", async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rechaza por Content-Length sin leer el cuerpo", async () => {
    const result = await readJsonBody(post("{}", { "content-length": "999999" }), 100);
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("corta un cuerpo sin Content-Length en cuanto pasa del tope", async () => {
    const encoder = new TextEncoder();
    let pulled = 0;
    // Un stream "infinito": si se leyera entero, el test no terminaría.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(encoder.encode("x".repeat(64)));
      },
    });
    const request = new Request("http://localhost", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(await readJsonBody(request, 1_000)).toEqual({ ok: false, error: "too_large" });
    expect(pulled).toBeLessThan(40);
  });

  it("distingue el JSON inválido", async () => {
    expect(await readJsonBody(post("{no es json"), 100)).toEqual({
      ok: false,
      error: "invalid_json",
    });
  });
});

describe("env", () => {
  it("trata el blanco como ausente", () => {
    vi.stubEnv("IMAGINARIA_TEST_VAR", "   ");
    expect(env("IMAGINARIA_TEST_VAR")).toBeUndefined();
    expect(envNum("IMAGINARIA_TEST_VAR", 7)).toBe(7);
  });

  it("recorta y convierte", () => {
    vi.stubEnv("IMAGINARIA_TEST_VAR", " 0.5 ");
    expect(env("IMAGINARIA_TEST_VAR")).toBe("0.5");
    expect(envNum("IMAGINARIA_TEST_VAR", 7)).toBe(0.5);
  });

  it("ignora un número mal escrito", () => {
    vi.stubEnv("IMAGINARIA_TEST_VAR", "veinte");
    expect(envNum("IMAGINARIA_TEST_VAR", 20)).toBe(20);
  });
});

describe("pickSuggestions", () => {
  it("devuelve una muestra sin repeticiones del repertorio", () => {
    for (let run = 0; run < 50; run++) {
      const sample = pickSuggestions();
      expect(new Set(sample).size).toBe(sample.length);
      for (const item of sample) expect(SUGGESTION_POOL).toContain(item);
    }
  });

  it("no pide más de lo que hay ni toca el original", () => {
    const pool = ["a", "b"];
    expect(pickSuggestions(pool, 5).sort()).toEqual(["a", "b"]);
    expect(pool).toEqual(["a", "b"]);
  });
});
