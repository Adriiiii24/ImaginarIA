"use client";

import { memo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, FeedbackValue } from "@/lib/ai/types";

interface MessageBubbleProps {
  message: ChatMessage;
  /** Solo el último mensaje del asistente mientras llegan tokens. */
  isStreaming?: boolean;
  /** Sin él no se ofrece valorar. Debe ser estable: ver useImaginaria.rate. */
  onFeedback?: (message: ChatMessage, value: FeedbackValue) => void;
}

// Fuera del componente: react-markdown no necesita recrearlos en cada token.
const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  // Sin persistencia, un enlace que navega en la misma pestaña se lleva la
  // conversación por delante. Siempre en una nueva.
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Una imagen en la respuesta cargaría una URL que ha escrito el modelo:
  // nada que aporte a una lluvia de ideas y una vía de fuga de datos si
  // alguien le inyecta instrucciones. Queda su texto alternativo.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

/**
 * Un turno de la conversación, como viñeta de cómic.
 *
 * Los dos hablantes usan bocadillo de papel con trazo grueso y sombra dura,
 * y la cola apunta hacia su lado: la del usuario a la derecha, la de
 * ImaginarIA a la izquierda. La asimetría la marcan la posición y el ancho,
 * no dos estilos distintos.
 *
 * Memorizado: mientras llega una respuesta, cada token vuelve a pintar la
 * lista. Sin memo, eso rehacía el Markdown de TODOS los mensajes anteriores en
 * cada token; con memo solo se pinta el que está cambiando.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  onFeedback,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const showActions = !isUser && !isStreaming && message.content !== "";

  return (
    <motion.div
      // Sin 'layout': con texto creciendo token a token, el motor de layout
      // recalcula en cada frame y el scroll da tirones.
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      // El margen inferior deja sitio a la cola, que sobresale del bocadillo.
      className={`mb-4 flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      {isUser ? (
        // pre-wrap: los saltos de línea con Shift+Enter son parte del mensaje.
        <div className="im-comic im-bubble im-bubble--right im-bubble--user max-w-[85%] whitespace-pre-wrap rounded-im px-4 py-2.5 text-[0.9375rem] font-medium leading-relaxed">
          {message.content}
        </div>
      ) : (
        // min-w-0: un bloque de código ancho no puede ensanchar la columna.
        <div className="w-full min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-im-accent" />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-im-faint">
              ImaginarIA
            </span>

            {showActions && (
              <MessageActions message={message} onFeedback={onFeedback} />
            )}
          </div>

          <div
            className={`im-comic im-bubble im-bubble--left im-prose rounded-im px-4 py-3 text-[0.9375rem] ${
              isStreaming ? "im-prose--streaming" : ""
            }`}
          >
            <Markdown
              remarkPlugins={REMARK_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {message.content}
            </Markdown>
          </div>
        </div>
      )}
    </motion.div>
  );
});

/* -------------------------------------------------------------------------- */

/**
 * Copiar y valorar, en la fila de la firma y no debajo del bocadillo: ahí no
 * compiten con la cola ni añaden altura. El margen negativo hace que los
 * botones, más altos que la etiqueta, no empujen el bocadillo al aparecer.
 */
function MessageActions({
  message,
  onFeedback,
}: Pick<MessageBubbleProps, "message" | "onFeedback">) {
  // Valorar solo tiene sentido si hay una traza a la que enlazar el voto.
  const canRate = Boolean(message.traceId && onFeedback);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="-my-1 ml-auto flex items-center gap-0.5"
    >
      <CopyButton text={message.content} />
      {canRate && (
        <>
          <ActionButton
            label="Me sirve"
            pressed={message.feedback === 1}
            onClick={() => onFeedback?.(message, 1)}
          >
            <ThumbIcon filled={message.feedback === 1} />
          </ActionButton>
          <ActionButton
            label="No me sirve"
            pressed={message.feedback === 0}
            onClick={() => onFeedback?.(message, 0)}
          >
            <ThumbIcon down filled={message.feedback === 0} />
          </ActionButton>
        </>
      )}
    </motion.div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <ActionButton
      label={copied ? "Copiado" : "Copiar respuesta"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_600);
          })
          // Sin permiso (un iframe sin clipboard-write): no hay nada que
          // hacer, y el botón simplemente no confirma.
          .catch(() => {});
      }}
    >
      {copied ? (
        <path d="M20 6 9 17l-5-5" />
      ) : (
        <>
          <rect width="13" height="13" x="8" y="8" rx="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </>
      )}
    </ActionButton>
  );
}

function ActionButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  /** Solo en los botones que alternan: sin él no se anuncia como conmutador. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`flex size-6 items-center justify-center rounded-full transition-colors duration-200 hover:text-im-text ${
        pressed ? "text-im-accent" : "text-im-faint"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

function ThumbIcon({ down, filled }: { down?: boolean; filled?: boolean }) {
  return (
    <g
      fill={filled ? "currentColor" : "none"}
      // El pulgar abajo es el mismo dibujo girado: así los dos pesan igual.
      transform={down ? "rotate(180 12 12)" : undefined}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </g>
  );
}
