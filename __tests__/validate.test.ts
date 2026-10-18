import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/history";
import {
  MAX_PAYLOAD_MESSAGES,
  validateChatRequest,
  validateFeedback,
} from "@/lib/chat/validate";

const ok = (payload: unknown) => {
  const result = validateChatRequest(payload);
  if (typeof result === "string") throw new Error("rechazado: " + result);
  return result;
};

describe("validateChatRequest", () => {
  it.each([
    [null, "objeto JSON"],
    [{}, "array 'messages'"],
    [{ messages: [] }, "array 'messages'"],
    [{ messages: ["hola"] }, "objeto"],
    [{ messages: [{ role: "system", content: "x" }] }, "rol"],
    [{ messages: [{ role: "user", content: 3 }] }, "texto"],
    [{ messages: [{ role: "user", content: "   " }] }, "vacíos"],
    [{ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }, "último"],
  ])("rechaza %j", (payload, fragment) => {
    const result = validateChatRequest(payload);
    expect(typeof result).toBe("string");
    expect(result).toContain(fragment);
  });

  it("rechaza un mensaje del usuario por encima del límite", () => {
    const result = validateChatRequest({
      messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }],
    });
    expect(result).toContain("demasiado largo");
  });

  it("acepta respuestas largas del asistente en el historial", () => {
    // Antes esto devolvía 400 y la conversación quedaba bloqueada tras pedir
    // "desarróllalo": la respuesta volvía en el historial y superaba el límite.
    const result = ok({
      messages: [
        { role: "user", content: "desarróllalo" },
        { role: "assistant", content: "idea ".repeat(2_000) },
        { role: "user", content: "sigue" },
      ],
    });
    expect(result.messages).toHaveLength(3);
  });

  it("acepta un turno vacío del asistente y lo descarta", () => {
    // Antes: 400 "Cada mensaje necesita un 'content' de texto no vacío", y
    // tras detener una respuesta ya no se podía seguir hablando.
    const result = ok({
      messages: [
        { role: "user", content: "hola" },
        { role: "assistant", content: "" },
        { role: "user", content: "otra" },
      ],
    });
    expect(result.messages).toEqual([{ role: "user", content: "hola\n\notra" }]);
  });

  it("no rechaza una conversación larga: se queda con la parte reciente", () => {
    const messages = Array.from({ length: 120 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "turno " + i,
    }));
    messages.push({ role: "user", content: "el último" });
    const result = ok({ messages });
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "el último" });
  });

  it("frena los payloads fabricados con cientos de mensajes", () => {
    const messages = Array.from({ length: MAX_PAYLOAD_MESSAGES + 1 }, () => ({
      role: "user",
      content: "x",
    }));
    expect(validateChatRequest({ messages })).toContain("Demasiados");
  });

  it("recorta el sessionId y descarta uno que no sea texto", () => {
    const base = { messages: [{ role: "user", content: "hola" }] };
    expect(ok({ ...base, sessionId: "s".repeat(500) }).sessionId).toHaveLength(128);
    expect(ok({ ...base, sessionId: 42 }).sessionId).toBeUndefined();
  });
});

describe("validateFeedback", () => {
  it("acepta un voto válido", () => {
    const traceId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(validateFeedback({ traceId, value: 1 })).toEqual({ traceId, value: 1 });
    expect(validateFeedback({ traceId, value: 0 })).toEqual({ traceId, value: 0 });
  });

  it.each([
    [{ traceId: "abc", value: 2 }],
    [{ traceId: "abc", value: true }],
    [{ traceId: "", value: 1 }],
    [{ traceId: "../../x", value: 1 }],
    [{ traceId: "x".repeat(129), value: 1 }],
    [{ value: 1 }],
    ["1"],
  ])("rechaza %j", (payload) => {
    expect(typeof validateFeedback(payload)).toBe("string");
  });
});
