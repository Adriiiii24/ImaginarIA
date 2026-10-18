import { describe, expect, it, vi } from "vitest";
import { ChatStreamError, readChatStream } from "@/lib/chat/stream-client";
import { streamOf } from "./helpers";

const ndjson = (...events: object[]) =>
  events.map((event) => JSON.stringify(event) + "\n").join("");

/** Como streamOf, pero con bytes: para partir un carácter por la mitad. */
function bytesOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("readChatStream", () => {
  it("entrega meta y deltas en orden y devuelve el done", async () => {
    const onMeta = vi.fn();
    const onDelta = vi.fn();

    const done = await readChatStream(
      streamOf([
        ndjson({ type: "meta", traceId: "t1", model: "m" }, { type: "delta", text: "Ho" }),
        ndjson({ type: "delta", text: "la" }, { type: "done", finishReason: "stop" }),
      ]),
      { onMeta, onDelta },
    );

    expect(onMeta).toHaveBeenCalledWith(expect.objectContaining({ traceId: "t1" }));
    expect(onDelta.mock.calls.flat()).toEqual(["Ho", "la"]);
    expect(done).toMatchObject({ type: "done", finishReason: "stop" });
  });

  it("reconstruye líneas partidas entre chunks, incluso a mitad de un carácter", async () => {
    const bytes = new TextEncoder().encode(
      ndjson({ type: "delta", text: "¿Qué tal? 😀" }, { type: "done" }),
    );
    const cut = bytes.indexOf(0xf0) + 2; // dentro de los 4 bytes del emoji
    const onDelta = vi.fn();

    await readChatStream(bytesOf([bytes.slice(0, cut), bytes.slice(cut)]), { onDelta });
    expect(onDelta).toHaveBeenCalledWith("¿Qué tal? 😀");
  });

  it("un evento error lanza con el mensaje y el código del servidor", async () => {
    const reading = readChatStream(
      streamOf([
        ndjson(
          { type: "delta", text: "a medias" },
          { type: "error", code: "rate_limited", message: "Dame un minuto." },
        ),
      ]),
      { onDelta: () => {} },
    );
    await expect(reading).rejects.toBeInstanceOf(ChatStreamError);
    await expect(reading).rejects.toMatchObject({
      code: "rate_limited",
      message: "Dame un minuto.",
    });
  });

  it("un stream que se cierra sin done ni error es una respuesta cortada", async () => {
    // Lo que pasa cuando la plataforma mata la función en maxDuration: antes
    // se daba por buena una respuesta a medias.
    const reading = readChatStream(streamOf([ndjson({ type: "delta", text: "Empiezo" })]), {
      onDelta: () => {},
    });
    await expect(reading).rejects.toMatchObject({ code: "interrupted" });
  });

  it("acepta el done en una última línea sin salto final", async () => {
    const done = await readChatStream(streamOf([JSON.stringify({ type: "done" })]), {
      onDelta: () => {},
    });
    expect(done.type).toBe("done");
  });

  it("salta las líneas corruptas sin perder el resto", async () => {
    const onDelta = vi.fn();
    await readChatStream(
      streamOf(["{roto\n", ndjson({ type: "delta", text: "sigue" }, { type: "done" })]),
      { onDelta },
    );
    expect(onDelta).toHaveBeenCalledWith("sigue");
  });

  it("un fallo de red a mitad es una interrupción; un aborto sigue siendo un aborto", async () => {
    const failing = (error: Error) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(error);
        },
      });

    await expect(
      readChatStream(failing(new TypeError("network error")), { onDelta: () => {} }),
    ).rejects.toMatchObject({ code: "interrupted" });

    await expect(
      readChatStream(failing(new DOMException("Aborted", "AbortError")), {
        onDelta: () => {},
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
