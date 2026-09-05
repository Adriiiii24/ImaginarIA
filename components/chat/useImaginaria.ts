"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, StreamEvent } from "@/lib/ai/types";

export type ChatStatus = "idle" | "streaming" | "error";

/**
 * Toda la logica de conversacion vive aqui, fuera de los componentes.
 *
 * Los componentes de UI quedan asi como funciones puras de sus props: se
 * pueden mirar, mover a Storybook o reemplazar sin tocar una sola linea de
 * la logica de red. Es la separacion que mas rentabiliza el mantenimiento.
 */
export function useImaginaria(initialMessages: ChatMessage[] = []) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Perezoso a proposito: generarlo en el render romperia la hidratacion al
  // no coincidir el valor del servidor con el del cliente.
  const getSessionId = () => (sessionIdRef.current ??= crypto.randomUUID());

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const send = useCallback(
    async (rawInput: string) => {
      const content = rawInput.trim();
      if (!content || status === "streaming") return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: Date.now(),
      };
      const assistantId = crypto.randomUUID();

      // Snapshot del historial que se envia: el estado de React es asincrono
      // y no podemos leer 'messages' actualizado dentro de este mismo tick.
      const history = [...messages, userMessage].map(({ role, content }) => ({
        role,
        content,
      }));

      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        },
      ]);
      setStatus("streaming");
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const appendToAssistant = (text: string) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + text }
              : message,
          ),
        );

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ messages: history, sessionId: getSessionId() }),
        });

        if (!response.ok || !response.body) {
          const detail = await response
            .json()
            .then((body) => body?.error?.message as string | undefined)
            .catch(() => undefined);
          throw new Error(detail ?? "No se ha podido contactar con ImaginarIA.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // NDJSON: un evento por linea. El buffer es obligatorio porque un
        // chunk de red puede partir una linea por la mitad.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!raw) continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(raw) as StreamEvent;
            } catch {
              continue;
            }

            if (event.type === "delta") appendToAssistant(event.text);
            else if (event.type === "error") throw new Error(event.message);
          }
        }

        setStatus("idle");
      } catch (caught) {
        // Abortar es una accion del usuario, no un fallo: conservamos el
        // texto parcial y volvemos a reposo.
        if (caught instanceof Error && caught.name === "AbortError") {
          setStatus("idle");
          return;
        }

        const message =
          caught instanceof Error ? caught.message : "Error inesperado.";
        setError(message);
        setStatus("error");

        // Un globo vacio del asistente es basura visual: lo retiramos si el
        // fallo ocurrio antes del primer token.
        setMessages((current) =>
          current.filter(
            (item) => !(item.id === assistantId && item.content === ""),
          ),
        );
      } finally {
        abortRef.current = null;
      }
    },
    [messages, status],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, []);

  return { messages, status, error, send, stop, reset };
}
