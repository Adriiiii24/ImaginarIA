"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { ChatStatus } from "@/components/chat/useImaginaria";

interface ChatInputProps {
  onSend: (value: string) => void;
  onStop: () => void;
  status: ChatStatus;
  placeholder?: string;
  autoFocus?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 200;

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

  // Devolver el foco al terminar la respuesta. Sin esto, quien envia pulsando
  // el boton se queda con el foco EN el boton: lee la respuesta, empieza a
  // escribir y no aparece nada. Es la forma mas sigilosa de que un chat
  // parezca roto.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      textareaRef.current?.focus();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  const submit = () => {
    if (!value.trim() || isStreaming) return;
    onSend(value);
    setValue("");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative"
    >
      <div className="flex items-end gap-2 rounded-im-lg border border-im-border bg-im-glass p-1.5 transition-colors duration-200 focus-within:border-im-accent">
        <textarea
          ref={textareaRef}
          value={value}
          autoFocus={autoFocus}
          rows={1}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
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
          className="im-scroll max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2 text-base leading-relaxed text-im-text outline-none placeholder:text-im-faint"
        />

        {isStreaming ? (
          <motion.button
            type="button"
            onClick={onStop}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-im-border-strong text-im-muted transition-colors hover:border-im-accent hover:text-im-accent"
            aria-label="Detener la respuesta"
          >
            <span className="size-2.5 rounded-[2px] bg-current" />
          </motion.button>
        ) : (
          <motion.button
            type="submit"
            disabled={!value.trim()}
            whileTap={{ scale: 0.94 }}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-im-accent text-im-accent-ink transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:bg-im-raised disabled:text-im-faint"
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

      {/* Oculta en móvil: sin teclado físico la indicación solo estorba. */}
      <p className="mt-2 hidden px-1 text-[0.6875rem] text-im-faint sm:block">
        <kbd className="font-sans">Enter</kbd> envía ·{" "}
        <kbd className="font-sans">Shift + Enter</kbd> nueva línea
      </p>
    </form>
  );
}
