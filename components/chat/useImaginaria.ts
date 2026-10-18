"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, FeedbackValue } from "@/lib/ai/types";
import { historyForRequest } from "@/lib/chat/history";
import {
  ChatStreamError,
  readChatStream,
  type ChatFailure,
} from "@/lib/chat/stream-client";

export type ChatStatus = "idle" | "streaming" | "error";

const NETWORK_MESSAGE =
  "No consigo conectarme. Revisa la conexión y prueba otra vez.";
const GENERIC_MESSAGE = "Algo ha ido mal por mi lado. Vuelve a intentarlo.";

/** Fallos que se repetirian tal cual: reintentar no tiene sentido. */
const NOT_RETRIABLE = new Set<ChatFailure>(["bad_request", "payload_too_large"]);

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
  // Un 400 no se arregla reintentando lo mismo; un corte o una cuota, si.
  const [canRetry, setCanRetry] = useState(false);

  /**
   * Controlador de la peticion en curso, y a la vez su identidad: una
   * peticion solo toca el estado mientras siga siendo la actual. Asi una
   * respuesta que llega tarde tras "Empezar de cero" no resucita nada.
   */
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  /** Pide la respuesta a un historial que termina en un mensaje del usuario. */
  const respond = useCallback(async (history: ChatMessage[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => abortRef.current === controller;

    const assistantId = crypto.randomUUID();
    const patchAssistant = (patch: (message: ChatMessage) => ChatMessage) =>
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? patch(message) : message,
        ),
      );
    // Un globo vacio del asistente es basura visual, y ademas un turno vacio
    // que viajaria en el historial: se retira si no llego ni un token, ya sea
    // por un fallo, porque el usuario detuvo la respuesta o porque el modelo
    // no dijo nada.
    const dropIfEmpty = () =>
      setMessages((current) =>
        current.filter(
          (message) => !(message.id === assistantId && message.content === ""),
        ),
      );

    setMessages([
      ...history,
      { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
    ]);
    setStatus("streaming");
    setError(null);
    setCanRetry(false);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: historyForRequest(history),
          // Perezoso a proposito: generarlo en el render romperia la
          // hidratacion al no coincidir el valor del servidor con el del
          // cliente.
          sessionId: (sessionIdRef.current ??= crypto.randomUUID()),
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response
          .json()
          .then(
            (body) =>
              body?.error as { code?: ChatFailure; message?: string } | undefined,
          )
          .catch(() => undefined);
        throw new ChatStreamError(
          detail?.message ?? "No consigo conectarme. Prueba otra vez en un momento.",
          detail?.code ?? "provider_error",
        );
      }

      await readChatStream(response.body, {
        onMeta: ({ traceId }) => {
          if (traceId) patchAssistant((message) => ({ ...message, traceId }));
        },
        onDelta: (text) =>
          patchAssistant((message) => ({
            ...message,
            content: message.content + text,
          })),
      });

      if (!isCurrent()) return;
      dropIfEmpty();
      setStatus("idle");
    } catch (caught) {
      if (!isCurrent()) return;
      dropIfEmpty();

      // Detener es una accion del usuario, no un fallo: se conserva el texto
      // parcial y se vuelve a reposo.
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }

      if (caught instanceof ChatStreamError) {
        setError(caught.message);
        setCanRetry(!NOT_RETRIABLE.has(caught.code));
      } else {
        // fetch lanza TypeError sin respuesta alguna: sin red, DNS... Su
        // mensaje ("Failed to fetch") no le dice nada a quien esta chateando.
        setError(caught instanceof TypeError ? NETWORK_MESSAGE : GENERIC_MESSAGE);
        setCanRetry(true);
      }
      setStatus("error");
    } finally {
      if (isCurrent()) abortRef.current = null;
    }
  }, []);

  const send = useCallback(
    (rawInput: string) => {
      const content = rawInput.trim();
      // La referencia y no el estado: se actualiza en el mismo tick, asi que
      // ni un doble clic ni un Enter repetido pueden lanzar dos peticiones.
      if (!content || abortRef.current) return;

      void respond([
        ...messages,
        { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() },
      ]);
    },
    [messages, respond],
  );

  /**
   * Vuelve a pedir la ultima respuesta. Si se corto a medias, el texto
   * parcial se descarta: se reintenta el turno entero, no se continua.
   */
  const retry = useCallback(() => {
    if (abortRef.current) return;

    const history = [...messages];
    while (history.at(-1)?.role === "assistant") history.pop();
    if (history.length > 0) void respond(history);
  }, [messages, respond]);

  const stop = useCallback(() => {
    // Solo se aborta: es la propia peticion la que, al ver la senal, retira
    // el globo si seguia vacio y vuelve a reposo.
    abortRef.current?.abort();
  }, []);

  /**
   * Valora una respuesta. Recibe el mensaje entero, y no su id, para no
   * depender de 'messages': asi la funcion es estable y los bocadillos
   * memorizados no se vuelven a pintar con cada token.
   */
  const rate = useCallback((message: ChatMessage, value: FeedbackValue) => {
    if (!message.traceId || message.feedback === value) return;

    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, feedback: value } : item,
      ),
    );

    // Sin esperar ni avisar de fallos: es una senal para el dashboard, y un
    // voto perdido no merece interrumpir la conversacion.
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traceId: message.traceId, value }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setStatus("idle");
    setError(null);
    setCanRetry(false);
  }, []);

  return { messages, status, error, canRetry, send, retry, stop, rate, reset };
}
