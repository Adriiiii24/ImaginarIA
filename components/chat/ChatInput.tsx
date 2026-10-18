"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { ChatStatus } from "@/components/chat/useImaginaria";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/history";

interface ChatInputProps {
  onSend: (value: string) => void;
  onStop: () => void;
  status: ChatStatus;
  placeholder?: string;
  autoFocus?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 200;

/** Desde aquí se enseña cuánto queda: antes solo sería ruido. */
const COUNTER_FROM = Math.round(MAX_MESSAGE_CHARS * 0.8);

/**
 * ¿Hay puntero fino, y por tanto casi seguro teclado físico? En táctil,
 * enfocar el campo por código abre el teclado virtual, que tapa media
 * pantalla: justo la mitad donde está la respuesta que se iba a leer.
 */
const hasFinePointer = () => window.matchMedia("(pointer: fine)").matches;

/**
 * Barra de comandos inferior.
 *
 * Es un textarea, no un input: escribir un briefing de tres lineas en un
 * campo de una sola linea es una friccion pequena que aparece en cada uso.
 * Crece con el contenido hasta un tope y luego hace scroll interno.
 */
export function ChatInput({
  onSend,
  onStop,
  status,
  placeholder = "Suéltalo como te salga...",
  autoFocus,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = status === "streaming";

  // Auto-crecimiento: reseteamos a 'auto' antes de medir para que scrollHeight
  // pueda tambien decrecer al borrar texto.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
  }, [value]);

  // Foco inicial, solo con teclado físico: ver hasFinePointer.
  useEffect(() => {
    if (autoFocus && hasFinePointer()) textareaRef.current?.focus();
  }, [autoFocus]);

  // Devolver el foco al terminar la respuesta. Sin esto, quien envia pulsando
  // el boton se queda con el foco EN el boton: lee la respuesta, empieza a
  // escribir y no aparece nada. Es la forma mas sigilosa de que un chat
  // parezca roto. En tactil no hace falta (se escribe tocando el campo) y
  // abriria el teclado encima de la respuesta.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && hasFinePointer()) {
      textareaRef.current?.focus();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  const submit = () => {
    if (!value.trim() || isStreaming) return;
    onSend(value);
    setValue("");
  };

  const atLimit = value.length >= MAX_MESSAGE_CHARS;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative"
    >
      <div className="im-comic relative flex items-end gap-2 rounded-im-lg bg-im-paper p-1.5 transition-shadow duration-200 focus-within:shadow-[5px_5px_0_0_var(--im-ink)]">
        {/* El mismo tope que aplica el servidor: mejor verlo venir que
            recibir un error al enviar. maxLength corta también lo pegado. */}
        {value.length >= COUNTER_FROM && (
          <span
            aria-hidden
            className={`pointer-events-none absolute -top-3 right-5 rounded-full border-2 border-im-ink px-2 text-[0.625rem] font-medium leading-4 tabular-nums text-im-ink ${
              atLimit ? "bg-im-accent" : "bg-im-paper"
            }`}
          >
            {value.length} / {MAX_MESSAGE_CHARS}
          </span>
        )}
        {/* El contador leído en cada pulsación sería ruido: solo se anuncia
            el tope, que es cuando deja de entrar texto. */}
        <span className="sr-only" aria-live="polite">
          {atLimit ? "Has llegado al máximo de " + MAX_MESSAGE_CHARS + " caracteres." : ""}
        </span>

        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          // En móvil, la tecla Intro del teclado virtual dice "Enviar".
          enterKeyHint="send"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isStreaming) {
              // Sin propagar: en el panel lateral, Escape también lo cierra.
              // El primero detiene la respuesta; el segundo ya cierra.
              event.preventDefault();
              event.stopPropagation();
              onStop();
              return;
            }
            // Enter envia, Shift+Enter salta de linea. isComposing evita
            // cortar la entrada de teclados con IME (japones, chino, coreano)
            // justo cuando el usuario confirma un caracter.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Mensaje para ImaginarIA"
          className="im-scroll max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2.5 py-[5px] text-base leading-relaxed text-im-ink outline-none placeholder:text-im-ink-muted"
        />

        {isStreaming ? (
          <motion.button
            type="button"
            onClick={onStop}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            className="im-comic im-comic-press flex size-9 shrink-0 items-center justify-center rounded-full bg-im-paper text-im-ink"
            aria-label="Detener la respuesta"
          >
            <span className="size-2.5 rounded-[2px] bg-current" />
          </motion.button>
        ) : (
          <motion.button
            type="submit"
            disabled={!value.trim()}
            whileTap={{ scale: 0.94 }}
            className="im-comic im-comic-press flex size-9 shrink-0 items-center justify-center rounded-full bg-im-accent text-im-ink hover:brightness-105 disabled:cursor-not-allowed disabled:bg-im-paper disabled:text-im-ink-muted disabled:shadow-none"
            aria-label="Enviar mensaje"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </motion.button>
        )}
      </div>

      {/* Oculta en móvil: sin teclado físico la indicación solo estorba.
          Mientras responde, cuenta lo único que se puede hacer: detenerla. */}
      <p className="mt-3 hidden px-1 text-[0.6875rem] text-im-faint sm:block">
        {isStreaming ? (
          <>
            <kbd className="font-sans">Esc</kbd> detiene la respuesta
          </>
        ) : (
          <>
            <kbd className="font-sans">Enter</kbd> envía ·{" "}
            <kbd className="font-sans">Shift + Enter</kbd> nueva línea
          </>
        )}
      </p>
    </form>
  );
}
