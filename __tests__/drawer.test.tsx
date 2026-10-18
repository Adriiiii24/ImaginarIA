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
import { ImaginariaDrawer } from "@/components/ImaginariaDrawer";
import { CLOSE_MESSAGE } from "@/components/chat/ChatContainer";
import { FINE_POINTER, stubDom, stubMatchMedia } from "./dom";

const open = () => {
  const trigger = screen.getByRole("button", { name: "Abrir ImaginarIA" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

beforeEach(() => stubDom());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImaginariaDrawer", () => {
  it("abre un diálogo modal con el foco dentro y, al cerrar, lo devuelve al botón", async () => {
    stubMatchMedia({ [FINE_POINTER]: false });
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<ImaginariaDrawer />);
    const trigger = open();

    // Nombrado por su propio título, que baja a h2: la página anfitriona ya
    // tiene su h1.
    const dialog = screen.getByRole("dialog", { name: "ImaginarIA" });
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("ImaginarIA");

    // En táctil, el foco espera en "Cerrar", que va dentro de la cabecera del
    // chat (no flotando encima de sus botones) y sobre el cristal.
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(document.activeElement).toBe(close);
    expect(close.closest("header")).not.toBeNull();
    expect(dialog.querySelector(".im-glass header")).not.toBeNull();

    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("con teclado físico, el foco entra directo al campo del mensaje", () => {
    stubMatchMedia({ [FINE_POINTER]: true });
    render(<ImaginariaDrawer />);
    open();

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Mensaje para ImaginarIA" }),
    );
  });

  it("Escape cierra con la animación de salida y devuelve el foco", async () => {
    stubMatchMedia();
    render(<ImaginariaDrawer />);
    const trigger = open();

    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("con iframe, cierra cuando la app lo pide desde su origen, y solo entonces", async () => {
    stubMatchMedia();
    render(<ImaginariaDrawer src="https://imaginaria.example/" />);
    open();

    const iframe = document.querySelector("iframe")!;
    // "Cerrar" no puede ir en la cabecera de dentro: va en una barra propia.
    expect(
      screen.getByRole("button", { name: "Cerrar" }).compareDocumentPosition(iframe) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const message = (origin: string, source: Window | null) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: CLOSE_MESSAGE },
            origin,
            source,
          }),
        );
      });

    message("https://otra.example", iframe.contentWindow);
    message("https://imaginaria.example", window);
    expect(screen.getByRole("dialog", { name: "ImaginarIA" })).toBeTruthy();

    message("https://imaginaria.example", iframe.contentWindow);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
