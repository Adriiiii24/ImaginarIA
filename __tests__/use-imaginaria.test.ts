// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useImaginaria } from "@/components/chat/useImaginaria";
import { INTERRUPTED_MESSAGE } from "@/lib/chat/stream-client";
import { hangingStream, jsonResponse, streamOf } from "./helpers";

type FetchArgs = [string, RequestInit];

const ndjson = (...events: object[]) =>
  events.map((event) => JSON.stringify(event) + "\n").join("");

const chatResponse = (...events: object[]) =>
  new Response(streamOf([ndjson(...events)]), { status: 200 });

/** Una respuesta que no llega nunca, hasta que se aborta. */
const hanging = async (_url: string, init: RequestInit) =>
  new Response(hangingStream(init.signal), { status: 200 });

const sentBody = (call: FetchArgs) => JSON.parse(String(call[1].body));

const turns = (messages: Array<{ role: string; content: string }>) =>
  messages.map(({ role, content }) => [role, content]);

describe("useImaginaria", () => {
  it("una conversación normal: el mensaje, la respuesta y su traza", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        chatResponse(
          { type: "meta", traceId: "t1", model: "m" },
          { type: "delta", text: "Hola" },
          { type: "done" },
        ),
      ),
    );
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("  buenas  "));
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(turns(result.current.messages)).toEqual([
      ["user", "buenas"],
      ["assistant", "Hola"],
    ]);
    expect(result.current.messages[1].traceId).toBe("t1");
  });

  it("detener antes del primer token no deja un globo vacío, y se puede seguir", async () => {
    // El fallo original: quedaba un mensaje del asistente vacío que se pintaba
    // como bocadillo en blanco y hacía fallar con 400 todo lo siguiente.
    const fetchMock = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockImplementationOnce(hanging)
      .mockImplementationOnce(async () =>
        chatResponse({ type: "delta", text: "Ahora sí" }, { type: "done" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("primero"));
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(turns(result.current.messages)).toEqual([["user", "primero"]]);
    expect(result.current.error).toBeNull();

    act(() => result.current.send("otra cosa"));
    await waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("Ahora sí"));

    // Ningún turno vacío viaja al servidor; los dos del usuario, sí.
    expect(sentBody(fetchMock.mock.calls[1]).messages).toEqual([
      { role: "user", content: "primero" },
      { role: "user", content: "otra cosa" },
    ]);
  });

  it("una respuesta cortada muestra el error, conserva el texto y se puede reintentar", async () => {
    const fetchMock = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockImplementationOnce(async () => chatResponse({ type: "delta", text: "Empie" }))
      .mockImplementationOnce(async () =>
        chatResponse({ type: "delta", text: "Entera" }, { type: "done" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("cuéntame"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(INTERRUPTED_MESSAGE);
    expect(result.current.canRetry).toBe(true);
    expect(result.current.messages.at(-1)?.content).toBe("Empie");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    // El reintento rehace el turno: el trozo cortado ni se ve ni se envía.
    expect(turns(result.current.messages)).toEqual([
      ["user", "cuéntame"],
      ["assistant", "Entera"],
    ]);
    expect(sentBody(fetchMock.mock.calls[1]).messages).toEqual([
      { role: "user", content: "cuéntame" },
    ]);
  });

  it("sin red, un mensaje que se entiende y no 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("hola"));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).not.toContain("Failed to fetch");
    expect(result.current.error).toMatch(/conect/);
    expect(turns(result.current.messages)).toEqual([["user", "hola"]]);
  });

  it("un error HTTP enseña el mensaje del servidor; un 400 no ofrece reintentar", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(400, { error: { code: "bad_request", message: "Demasiado largo." } }),
    );
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("hola"));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).toBe("Demasiado largo.");
    expect(result.current.canRetry).toBe(false);
  });

  it("valora una respuesta con su traceId, sin repetir el mismo voto", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/feedback"
        ? new Response(null, { status: 204 })
        : chatResponse(
            { type: "meta", traceId: "t9", model: "m" },
            { type: "delta", text: "Idea" },
            { type: "done" },
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("hola"));
    await waitFor(() => expect(result.current.status).toBe("idle"));

    act(() => result.current.rate(result.current.messages[1], 1));
    expect(result.current.messages[1].feedback).toBe(1);
    act(() => result.current.rate(result.current.messages[1], 1));

    const votes = fetchMock.mock.calls.filter(([url]) => url === "/api/feedback");
    expect(votes).toHaveLength(1);
    expect(JSON.parse(String((votes[0] as unknown as FetchArgs)[1].body))).toEqual({
      traceId: "t9",
      value: 1,
    });
  });

  it("no lanza dos peticiones con un doble envío", async () => {
    const fetchMock = vi.fn(hanging);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useImaginaria());

    act(() => {
      result.current.send("uno");
      result.current.send("dos");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("empezar de cero durante una respuesta no deja rastro de ella", async () => {
    vi.stubGlobal("fetch", vi.fn(hanging));
    const { result } = renderHook(() => useImaginaria());

    act(() => result.current.send("hola"));
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    act(() => result.current.reset());

    // Da tiempo a que la petición abortada termine de fallar.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});
