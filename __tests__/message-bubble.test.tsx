// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageBubble } from "@/components/chat/MessageBubble";

const assistant = (content: string) => ({
  id: "a1",
  role: "assistant" as const,
  content,
});

afterEach(cleanup);

describe("MessageBubble", () => {
  it("los encabezados de una respuesta no compiten con el título de la página", () => {
    render(<MessageBubble message={assistant("# Uno\n\n## Dos\n\n### Tres")} />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Uno");
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("Dos");
    expect(screen.getByRole("heading", { level: 5 }).textContent).toBe("Tres");
  });

  it("una tabla o un bloque de código anchos se pueden desplazar con teclado", () => {
    render(
      <MessageBubble
        message={assistant("| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncódigo\n```")}
      />,
    );

    const region = screen.getByRole("region", { name: "Tabla" });
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector("table")).not.toBeNull();
    expect(document.querySelector("pre")!.tabIndex).toBe(0);
  });

  it("un enlace avisa de que se abre en otra pestaña", () => {
    render(<MessageBubble message={assistant("Mira [la web](https://example.com)")} />);

    // jsdom recorta el espacio con que empieza el aviso; un navegador, no.
    const link = screen.getByRole("link", {
      name: /^la web ?\(se abre en una pestaña nueva\)$/,
    });
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("el mensaje del usuario dice quién habla, aunque no se vea", () => {
    render(<MessageBubble message={{ id: "u1", role: "user", content: "hola" }} />);

    const author = screen.getByText("Tú:");
    expect(author.className).toContain("sr-only");
    expect(author.parentElement!.textContent).toBe("Tú: hola");
  });
});
