"use client";

import { motion } from "framer-motion";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/ai/types";

interface MessageBubbleProps {
  message: ChatMessage;
  /** Solo el ultimo mensaje del asistente mientras llegan tokens. */
  isStreaming?: boolean;
}

/**
 * Un turno de la conversacion.
 *
 * Asimetria deliberada: el usuario recibe un globo compacto y alineado a la
 * derecha; ImaginarIA escribe a ancho completo, sin caja, como un texto que
 * ocurre en la pagina. Encerrar una respuesta larga en un globo la hace
 * parecer un mensaje de chat; dejarla respirar la hace parecer una idea.
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
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      {isUser ? (
        <div className="max-w-[85%] rounded-im rounded-br-md border border-im-border-strong bg-im-raised px-4 py-2.5 text-[0.9375rem] leading-relaxed text-im-text">
          {message.content}
        </div>
      ) : (
        <div className="w-full">
          <div className="mb-2 flex items-center gap-2">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-im-accent shadow-[0_0_10px_var(--im-accent-glow)]"
            />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-im-faint">
              ImaginarIA
            </span>
          </div>

          <div className="im-prose text-[0.9375rem] text-im-text">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
            {isStreaming && <span className="im-caret" aria-hidden />}
          </div>
        </div>
      )}
    </motion.div>
  );
}
