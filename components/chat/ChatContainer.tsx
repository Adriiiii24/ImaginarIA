"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useImaginaria } from "@/components/chat/useImaginaria";
import { usePaleta } from "@/components/palette";
import { BrandMark } from "@/components/BrandMark";

const SUGGESTIONS = [
  "Tengo otra app de hábitos y no sé en qué se diferencia",
  "Necesito un nombre que no suene a startup de 2015",
  "Mi landing convierte fatal y no sé por qué",
  "Llévame la contraria en algo que doy por hecho",
];

interface ChatContainerProps {
  className?: string;
  autoFocus?: boolean;
}

/**
 * Orquesta la conversacion: estado (delegado en useImaginaria), scroll y
 * composicion de los tres bloques de la interfaz.
 */
export function ChatContainer({ className = "", autoFocus }: ChatContainerProps) {
  const { messages, status, error, send, stop, reset } = useImaginaria();
  // null cuando no hay PaletaProvider por encima: el boton simplemente no sale.
  const paleta = usePaleta();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // "Pegado al fondo": seguimos el stream solo si el usuario no ha subido a
  // releer. Auto-scrollear a alguien que esta leyendo hacia arriba es una de
  // las cosas mas molestas que puede hacer un chat.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinnedRef.current = distance < 80;
    setShowJump(!pinnedRef.current && messages.length > 0);
  }, [messages.length]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({
      // 'auto' durante el streaming: un 'smooth' por token encola cientos de
      // animaciones de scroll y la vista se queda por detras del texto.
      behavior: status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, status]);

  const jumpToBottom = () => {
    pinnedRef.current = true;
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const isEmpty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  const streamingId =
    status === "streaming" && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;

  return (
    <div className={`relative flex h-full flex-col ${className}`}>
      {/* Cabecera */}
      <header className="z-10 flex shrink-0 items-center justify-between border-b border-im-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <h1 className="text-sm font-semibold tracking-tight text-im-text">
            Imaginar<span className="text-im-accent">IA</span>
          </h1>
        </div>

        <div className="flex items-center gap-1">
          {!isEmpty && (
            <button
              type="button"
              onClick={reset}
              className="rounded-full px-3 py-1 text-xs text-im-faint transition-colors hover:text-im-text"
            >
              Empezar de cero
            </button>
          )}

          {paleta && (
            <button
              type="button"
              onClick={paleta.girar}
              // El botón muestra el color al que va a cambiar el fondo, así
              // que la propia pieza dice lo que hace antes de pulsarla.
              aria-label="Cambiar la paleta de colores"
              title="Cambiar la paleta"
              className="ml-1 flex size-7 items-center justify-center rounded-full border border-im-border transition-transform duration-200 hover:scale-110 active:scale-95"
            >
              <span
                aria-hidden
                className="size-3 rounded-full transition-colors duration-500"
                style={{ backgroundColor: paleta.siguienteColor }}
              />
            </button>
          )}
        </div>
      </header>

      {/* Conversacion */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="im-scroll relative flex-1 overflow-y-auto overscroll-contain px-5"
      >
        <div className="relative z-[1] mx-auto flex w-full max-w-2xl flex-col gap-7 py-7">
          {isEmpty ? (
            <EmptyState onPick={send} />
          ) : (
            <AnimatePresence initial={false}>
              {messages
                // El globo del asistente aun vacio no se pinta: en su lugar
                // aparece el indicador de espera, sin duplicar la firma.
                .filter(
                  (message) =>
                    !(message.id === streamingId && message.content === ""),
                )
                .map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={message.id === streamingId}
                  />
                ))}
            </AnimatePresence>
          )}

          {/* Espera antes del primer token: sin esto, el envio parece no hacer
              nada durante medio segundo largo. */}
          {status === "streaming" && lastMessage?.content === "" && <Thinking />}

          {error && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-im-sm border border-im-danger/30 bg-im-danger/10 px-4 py-3 text-sm text-im-danger"
            >
              {error}
            </motion.p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Volver al final */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            type="button"
            onClick={jumpToBottom}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="im-glass absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs text-im-muted transition-colors hover:text-im-text"
          >
            Ir al final ↓
          </motion.button>
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="z-10 shrink-0 border-t border-im-border px-4 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-2xl">
          <ChatInput
            onSend={send}
            onStop={stop}
            status={status}
            autoFocus={autoFocus}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EmptyState({ onPick }: { onPick: (value: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-7 pt-10"
    >
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold leading-snug tracking-tight text-im-text">
          ¿Qué te ronda la cabeza?
        </h2>
        <p className="max-w-md text-[0.9375rem] leading-relaxed text-im-muted">
          Cuéntamelo como te salga y le damos vueltas juntos. Te llevaré la
          contraria alguna vez, pero siempre a favor de la idea.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion, index) => (
          <motion.button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + index * 0.06, duration: 0.35 }}
            className="rounded-full border border-im-border bg-im-glass px-3.5 py-2 text-left text-[0.8125rem] text-im-muted transition-colors duration-200 hover:border-im-accent hover:text-im-text"
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5" aria-label="Pensando">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1.5 rounded-full bg-im-accent"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: index * 0.16,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
