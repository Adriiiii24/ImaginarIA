import { vi } from "vitest";
import { MotionGlobalConfig } from "framer-motion";

/**
 * Lo que jsdom no trae y los componentes usan: matchMedia (puntero fino,
 * movimiento reducido), scrollIntoView y los métodos de <dialog>. Solo para
 * los tests con @vitest-environment jsdom.
 */

export const FINE_POINTER = "(pointer: fine)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** matchMedia con respuestas fijas que se pueden cambiar a mitad de test. */
export function stubMatchMedia(initial: Record<string, boolean> = {}) {
  const state: Record<string, boolean> = { ...initial };
  const listeners = new Map<string, Set<() => void>>();

  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return state[query] ?? false;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.get(query)?.delete(listener);
    },
  }));

  return {
    set(query: string, matches: boolean) {
      state[query] = matches;
      listeners.get(query)?.forEach((listener) => listener());
    },
  };
}

/** scrollIntoView, showModal y close; y animaciones instantáneas. */
export function stubDom() {
  Element.prototype.scrollIntoView = () => {};

  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };

  // Las salidas de AnimatePresence terminan en el acto: sin esto, lo que
  // depende de onExitComplete (devolver el foco) esperaría a un rAF que en
  // jsdom no llega a su hora.
  MotionGlobalConfig.skipAnimations = true;
}

const encoder = new TextEncoder();
const line = (event: object) => encoder.encode(JSON.stringify(event) + "\n");

/**
 * Una respuesta de /api/chat que se escribe desde el test: lo que se emite
 * llega a la app en ese momento, como un stream de verdad. Con la señal de
 * la petición, al detener falla con AbortError, igual que fetch.
 */
export function controlledChatResponse(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener("abort", () =>
        c.error(new DOMException("Aborted", "AbortError")),
      );
    },
  });
  return {
    response: new Response(body, { status: 200 }),
    emit: (...events: object[]) => events.forEach((event) => controller.enqueue(line(event))),
    end: () => controller.close(),
  };
}

/** Una respuesta completa de /api/chat. */
export const chatReply = (text: string) => {
  const reply = controlledChatResponse();
  reply.emit(
    { type: "meta", traceId: "t1", model: "m" },
    { type: "delta", text },
    { type: "done" },
  );
  reply.end();
  return reply.response;
};
