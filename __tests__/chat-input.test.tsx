// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "@/components/chat/ChatInput";
import { FINE_POINTER, stubDom, stubMatchMedia } from "./dom";

const noop = () => {};

const textbox = () =>
  screen.getByRole("textbox", { name: "Mensaje para ImaginarIA" });

beforeEach(() => stubDom());
afterEach(cleanup);

describe("ChatInput", () => {
  it("enviar y detener son el mismo botón: pasar de uno a otro no suelta el foco", () => {
    stubMatchMedia({ [FINE_POINTER]: false });
    const { rerender } = render(
      <ChatInput onSend={noop} onStop={noop} status="idle" />,
    );
    const button = screen.getByRole("button", { name: "Enviar mensaje" });
    button.focus();

    rerender(<ChatInput onSend={noop} onStop={noop} status="streaming" />);
    expect(screen.getByRole("button", { name: "Detener la respuesta" })).toBe(button);
    expect(document.activeElement).toBe(button);

    // Al terminar, sin texto: no disponible, pero sin 'disabled', que le
    // haría soltar el foco.
    rerender(<ChatInput onSend={noop} onStop={noop} status="idle" />);
    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("sin texto, enviar no hace nada", () => {
    stubMatchMedia();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={noop} status="idle" />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("con teclado físico, enviar con el botón vuelve al campo; en táctil, el foco se queda en el botón", () => {
    const media = stubMatchMedia({ [FINE_POINTER]: true });
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={noop} status="idle" />);
    const button = screen.getByRole("button", { name: "Enviar mensaje" });

    fireEvent.change(textbox(), { target: { value: "hola" } });
    button.focus();
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith("hola");
    expect(document.activeElement).toBe(textbox());

    media.set(FINE_POINTER, false);
    fireEvent.change(textbox(), { target: { value: "otra" } });
    button.focus();
    fireEvent.click(button);
    expect(onSend).toHaveBeenLastCalledWith("otra");
    expect(document.activeElement).toBe(button);
  });

  it("detener con el botón para la respuesta y, con teclado físico, vuelve al campo", () => {
    stubMatchMedia({ [FINE_POINTER]: true });
    const onStop = vi.fn();
    render(<ChatInput onSend={noop} onStop={onStop} status="streaming" />);

    fireEvent.click(screen.getByRole("button", { name: "Detener la respuesta" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textbox());
  });

  it("las instrucciones de teclado y, cerca del tope, el contador describen el campo", () => {
    stubMatchMedia();
    render(<ChatInput onSend={noop} onStop={noop} status="idle" />);
    const description = () =>
      (textbox().getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" | ");

    expect(description()).toContain("Enter envía");
    expect(description()).not.toContain("caracteres");

    fireEvent.change(textbox(), { target: { value: "x".repeat(3_200) } });
    expect(description()).toContain("3200 de 4000 caracteres");
  });

  it("Escape mientras responde la detiene y no deja que el evento siga", () => {
    stubMatchMedia();
    const onStop = vi.fn();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    render(<ChatInput onSend={noop} onStop={onStop} status="streaming" />);

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outside);
  });
});
