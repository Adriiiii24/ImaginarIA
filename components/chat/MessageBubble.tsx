"use client";

import { motion } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/ai/types";

interface MessageBubbleProps {
  message: ChatMessage;
  /** Solo el último mensaje del asistente mientras llegan tokens. */
  isStreaming?: boolean;
}

/**
 * Un turno de la conversación, como viñeta de cómic.
 *
 * Los dos hablantes usan bocadillo de papel con trazo grueso y sombra dura,
 * y la cola apunta hacia su lado: la del usuario a la derecha, la de
 * ImaginarIA a la izquierda. La asimetría la marcan la posición y el ancho,
 * no dos estilos distintos.
 */
export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";

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
        <div className="im-comic im-bubble im-bubble--right max-w-[85%] rounded-im px-4 py-2.5 text-[0.9375rem] leading-relaxed">
          {message.content}
        </div>
      ) : (
        <div className="w-full">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-im-accent" />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-im-faint">
              ImaginarIA
            </span>
          </div>

          <div className="im-comic im-bubble im-bubble--left im-prose rounded-im px-4 py-3 text-[0.9375rem]">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
            {isStreaming && <span className="im-caret" aria-hidden />}
          </div>
        </div>
      )}
    </motion.div>
  );
}
