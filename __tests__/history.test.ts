import { describe, expect, it } from "vitest";
import {
  historyForRequest,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  normalizeHistory,
  prepareHistory,
  windowHistory,
  type Turn,
} from "@/lib/chat/history";

const user = (content: string): Turn => ({ role: "user", content });
const bot = (content: string): Turn => ({ role: "assistant", content });

describe("normalizeHistory", () => {
  it("descarta los turnos vacíos (respuesta detenida antes del primer token)", () => {
    expect(normalizeHistory([user("hola"), bot(""), bot("  "), user("sigo")])).toEqual([
      user("hola\n\nsigo"),
    ]);
  });

  it("funde turnos seguidos del mismo rol", () => {
    expect(
      normalizeHistory([user("uno"), user("dos"), bot("a"), bot("b"), user("tres")]),
    ).toEqual([user("uno\n\ndos"), bot("a\n\nb"), user("tres")]);
  });

  it("no modifica el array ni los objetos de entrada", () => {
    const input = [user("uno"), user("dos")];
    const snapshot = structuredClone(input);
    normalizeHistory(input);
    expect(input).toEqual(snapshot);
  });
});

describe("windowHistory", () => {
  it("deja intacto un historial que cabe", () => {
    const history = [user("a"), bot("b"), user("c")];
    expect(windowHistory(history)).toEqual(history);
  });

  it("se queda con los turnos más recientes si hay demasiados", () => {
    // u0 b1 u2 ... b9 u10: los cuatro últimos son b7 u8 b9 u10, y b7 sobra
    // porque el historial no puede empezar por el asistente.
    const history = Array.from({ length: 11 }, (_, i) =>
      i % 2 === 0 ? user("u" + i) : bot("b" + i),
    );
    const window = windowHistory(history, 4, 1_000);
    expect(window.map((turn) => turn.content)).toEqual(["u8", "b9", "u10"]);
  });

  it("corta por caracteres y nunca empieza con el asistente", () => {
    const window = windowHistory([user("x".repeat(50)), bot("y".repeat(50)), user("z")], 10, 60);
    // "y" cabe (51) pero dejaría el historial empezando por el asistente.
    expect(window).toEqual([user("z")]);
  });

  it("conserva siempre el último turno, recortado por el principio si desborda", () => {
    const window = windowHistory([user("a".repeat(10) + "FINAL")], 10, 8);
    expect(window).toEqual([user("aaaFINAL")]);
  });

  it("no parte un emoji al recortar", () => {
    const [turn] = windowHistory([user("😀😀😀")], 10, 3);
    expect(turn.content).toBe("😀");
  });

  it("respeta los límites por defecto", () => {
    const long = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? user("u".repeat(900)) : bot("b".repeat(900)),
    );
    const window = windowHistory([...long, user("última")]);
    const chars = window.reduce((sum, turn) => sum + turn.content.length, 0);
    expect(window.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(chars).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(window.at(-1)).toEqual(user("última"));
    expect(window[0].role).toBe("user");
  });
});

describe("prepareHistory / historyForRequest", () => {
  const history = [user("hola"), bot(""), user("otra"), bot("vale"), user("y")];

  it("el servidor funde y recorta", () => {
    expect(prepareHistory(history)).toEqual([user("hola\n\notra"), bot("vale"), user("y")]);
  });

  it("el cliente descarta vacíos pero NO funde (el servidor valida mensaje a mensaje)", () => {
    expect(historyForRequest(history)).toEqual([
      user("hola"),
      user("otra"),
      bot("vale"),
      user("y"),
    ]);
  });

  it("el cliente solo envía rol y contenido", () => {
    const [turn] = historyForRequest([
      { role: "user", content: "hola", id: "1", createdAt: 1 } as Turn,
    ]);
    expect(Object.keys(turn).sort()).toEqual(["content", "role"]);
  });
});
