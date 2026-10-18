// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContainer, CLOSE_MESSAGE } from "@/components/chat/ChatContainer";
import { PaletaProvider } from "@/components/palette";
import { jsonResponse } from "./helpers";
import {
  chatReply,
  controlledChatResponse,
  FINE_POINTER,
  REDUCED_MOTION,
  stubDom,
  stubMatchMedia,
} from "./dom";

const PAUSE_KEY = "imaginaria:animacion-en-pausa";

const textbox = () =>
  screen.getByRole("textbox", { name: "Mensaje para ImaginarIA" });

/** La región viva de las respuestas (la del tope de caracteres es un span). */
const liveRegion = () => document.querySelector('p[aria-live="polite"]')!;

const send = (text: string) => {
  fireEvent.change(textbox(), { target: { value: text } });
  fireEvent.keyDown(textbox(), { key: "Enter" });
};

/** Un fetch de /api/chat cuya respuesta se escribe desde el test. */
function controlledFetch() {
  let reply!: ReturnType<typeof controlledChatResponse>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      reply = controlledChatResponse(init.signal);
      return reply.response;
    }),
  );
  return () => reply;
}

beforeEach(() => {
  stubDom();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatContainer: foco", () => {
  it("tras pulsar una sugerencia, el foco va al campo, también en táctil", async () => {
    stubMatchMedia({ [FINE_POINTER]: false });
    vi.stubGlobal("fetch", vi.fn(async () => chatReply("Vale")));
    render(<ChatContainer />);

    const [suggestion] = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") !== "Enviar mensaje");
    suggestion.focus();
    fireEvent.click(suggestion);

    expect(document.activeElement).toBe(textbox());
    await waitFor(() => expect(liveRegion().textContent).toBe("Vale"));
  });

  it("«Reintentar» y «Empezar de cero» desaparecen al pulsarlos y dejan el foco en el campo", async () => {
    stubMatchMedia({ [FINE_POINTER]: false });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () =>
          jsonResponse(500, {
            error: { code: "provider_error", message: "Algo ha ido mal." },
          }),
        )
        .mockImplementationOnce(async () => chatReply("Ahora sí")),
    );
    render(<ChatContainer />);
    send("hola");

    const retry = await screen.findByRole("button", { name: "Reintentar" });
    retry.focus();
    fireEvent.click(retry);
    expect(document.activeElement).toBe(textbox());
    await waitFor(() => expect(liveRegion().textContent).toBe("Ahora sí"));

    const reset = screen.getByRole("button", { name: "Empezar de cero" });
    reset.focus();
    fireEvent.click(reset);
    expect(screen.queryByRole("button", { name: "Empezar de cero" })).toBeNull();
    expect(document.activeElement).toBe(textbox());
  });
});

describe("ChatContainer: anuncios", () => {
  it("la región viva dice que está escribiendo y, al terminar, la respuesta sin marcas", async () => {
    stubMatchMedia();
    const reply = controlledFetch();
    render(<ChatContainer />);
    send("dame ideas");

    await waitFor(() =>
      expect(liveRegion().textContent).toBe("ImaginarIA está escribiendo…"),
    );
    // El indicador de espera ya no es una región que nace con el texto dentro.
    expect(screen.getByRole("status").textContent).toBe("");

    // A mitad de respuesta no se lee nada a trozos.
    await act(async () => reply().emit({ type: "delta", text: "# Ideas\n\n" }));
    expect(liveRegion().textContent).toBe("ImaginarIA está escribiendo…");

    await act(async () => {
      reply().emit(
        {
          type: "delta",
          text:
            "- **Faro**, por la luz\n- Brújula\n\n" +
            "| Nombre | Por qué |\n|---|:---:|\n| Faro | Guía |\n\n" +
            "---\n\nMás en [la web](https://example.com).",
        },
        { type: "done" },
      );
      reply().end();
    });

    await waitFor(() =>
      expect(liveRegion().textContent).toContain("Más en la web."),
    );
    const spoken = liveRegion().textContent!;
    expect(spoken).toContain("Faro, por la luz");
    expect(spoken).toContain("Nombre, Por qué");
    expect(spoken).toContain("Faro, Guía");
    expect(spoken).not.toMatch(/[|*#]|^\s*-/m);
  });

  it("copiar se anuncia en la región compartida, y también si falla", async () => {
    stubMatchMedia();
    vi.stubGlobal("fetch", vi.fn(async () => chatReply("Una idea")));
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denegado"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<ChatContainer />);
    send("hola");

    const copy = await screen.findByRole("button", { name: "Copiar respuesta" });
    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copiado"));

    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "No he podido copiar la respuesta.",
      ),
    );
  });
});

describe("ChatContainer: pausa de la animación", () => {
  it("el botón pausa las figuras, lo dice y lo recuerda", () => {
    stubMatchMedia();
    render(
      <PaletaProvider>
        <ChatContainer />
      </PaletaProvider>,
    );

    const button = screen.getByRole("button", { name: "Pausar animación" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toBe("Reanudar animación");
    expect(document.documentElement.dataset.imAnimacion).toBe("en-pausa");
    expect(localStorage.getItem(PAUSE_KEY)).toBe("1");

    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toBe("Pausar animación");
    expect(document.documentElement.dataset.imAnimacion).toBeUndefined();
    expect(localStorage.getItem(PAUSE_KEY)).toBeNull();
  });

  it("sin almacenamiento, el botón sigue funcionando durante la visita", () => {
    stubMatchMedia();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(
      <PaletaProvider>
        <ChatContainer />
      </PaletaProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pausar animación" }));
    expect(screen.getByRole("button", { name: "Reanudar animación" })).toBeTruthy();
    expect(document.documentElement.dataset.imAnimacion).toBe("en-pausa");

    fireEvent.click(screen.getByRole("button", { name: "Reanudar animación" }));
  });

  it("con prefers-reduced-motion no se ofrece: las figuras ya están quietas", () => {
    const media = stubMatchMedia({ [REDUCED_MOTION]: true });
    render(
      <PaletaProvider>
        <ChatContainer />
      </PaletaProvider>,
    );

    expect(screen.queryByRole("button", { name: /animación/ })).toBeNull();
    act(() => media.set(REDUCED_MOTION, false));
    expect(screen.getByRole("button", { name: "Pausar animación" })).toBeTruthy();
  });
});

describe("ChatContainer: estructura y teclado", () => {
  it("dentro de otra página el título baja a h2, y lo que cuelga de él con él", () => {
    stubMatchMedia();
    render(<ChatContainer headingLevel={2} headingId="titulo" />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.id).toBe("titulo");
    expect(title.textContent).toBe("ImaginarIA");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "¿Qué te ronda la cabeza?",
    );
  });

  it("Escape: con respuesta en curso la detiene; sin ella, dentro de un iframe pide el cierre", async () => {
    stubMatchMedia();
    const postMessage = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({
      postMessage,
    } as unknown as Window);
    controlledFetch();
    render(<ChatContainer />);
    send("hola");
    await waitFor(() =>
      expect(liveRegion().textContent).toBe("ImaginarIA está escribiendo…"),
    );

    // Con el foco fuera del campo, lo recoge la ventana.
    const first = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(first);
    });
    expect(first.defaultPrevented).toBe(true);
    await waitFor(() => expect(liveRegion().textContent).toBe(""));
    expect(postMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(postMessage).toHaveBeenCalledWith({ type: CLOSE_MESSAGE }, "*");
  });
});
