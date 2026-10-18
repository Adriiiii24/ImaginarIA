"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { motion } from "framer-motion";
import type { ChatStatus } from "@/components/chat/useImaginaria";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/history";

interface ChatInputProps {
  onSend: (value: string) => void;
  onStop: () => void;
  status: ChatStatus;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * El campo, para quien tenga que devolverle el foco: cuando desaparece el
   * control que se acaba de pulsar (una sugerencia, "Reintentar"...), el foco
   * tiene que ir a alguna parte, y lo siguiente que se hace es escribir.
   */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

/** Tope del auto-crecimiento. Con poca altura manda el CSS (30dvh). */
const MAX_TEXTAREA_HEIGHT = 200;

/** Desde aquí se enseña cuánto queda: antes solo sería ruido. */
const COUNTER_FROM = Math.round(MAX_MESSAGE_CHARS * 0.8);

/**
 * ¿Hay puntero fino, y por tanto casi seguro teclado físico? En táctil,
 * enfocar el campo por código abre el teclado virtual, que tapa media
 * pantalla: justo la mitad donde está la respuesta que se iba a leer.
 */
const hasFinePointer = () => window.matchMedia("(pointer: fine)").matches;

/** El foco no está en ningún control: se pulsó fuera o se desmontó el suyo. */
const isFocusLost = () =>
  !document.activeElement || document.activeElement === document.body;

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
  inputRef,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? ownRef;
  const hintId = useId();
  const counterId = useId();
  const isStreaming = status === "streaming";
  const canSend = value.trim() !== "";
  const showCounter = value.length >= COUNTER_FROM;

  // Auto-crecimiento: reseteamos a 'auto' antes de medir para que scrollHeight
  // pueda tambien decrecer al borrar texto.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
  }, [value, textareaRef]);

  // Foco inicial, solo con teclado físico: ver hasFinePointer.
  useEffect(() => {
    if (autoFocus && hasFinePointer()) textareaRef.current?.focus();
  }, [autoFocus, textareaRef]);

  /**
   * Quien envía o detiene pulsando el botón vuelve al campo en el acto. Sin
   * esto se queda con el foco EN el botón: lee la respuesta, empieza a
   * escribir y no aparece nada. Es la forma más sigilosa de que un chat
   * parezca roto.
   *
   * En el acto y no al terminar la respuesta: mover el foco justo cuando
   * llega haría que el lector de pantalla anunciara el campo y cortara el
   * anuncio de la respuesta. Solo con puntero fino: en táctil abriría el
   * teclado encima de la respuesta, y el botón, que ya no se desmonta, es un
   * sitio válido donde dejar el foco.
   */
  const returnFocus = () => {
    if (hasFinePointer()) textareaRef.current?.focus();
  };

  // Red de seguridad al terminar la respuesta: si el foco se ha quedado en
  // ninguna parte (se pulsó fuera de cualquier control mientras llegaba),
  // vuelve al campo. Si está en otro control es que alguien lo ha llevado
  // allí, y no se le quita.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (
      wasStreaming.current &&
      !isStreaming &&
      hasFinePointer() &&
      isFocusLost()
    ) {
      textareaRef.current?.focus();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, textareaRef]);

  const submit = () => {
    if (!canSend || isStreaming) return;
    onSend(value);
    setValue("");
    returnFocus();
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
      {/* El campo no lleva anillo de foco propio (sobre el papel no se
          vería): lo lleva la caja entera, por fuera, en el amarillo del foco
          del resto de la interfaz. */}
      <div className="im-comic relative flex items-end gap-2 rounded-im-lg bg-im-paper p-1.5 transition-shadow duration-200 focus-within:shadow-[5px_5px_0_0_var(--im-ink)] has-[textarea:focus]:outline-2 has-[textarea:focus]:outline-offset-2 has-[textarea:focus]:outline-im-accent">
        {/* El mismo tope que aplica el servidor: mejor verlo venir que
            recibir un error al enviar. maxLength corta también lo pegado.
            Forma parte de la descripción del campo, que se lee al llegar a
            él, y no de una región viva: leído en cada pulsación sería ruido. */}
        {showCounter && (
          <span
            id={counterId}
            className={`pointer-events-none absolute -top-3 right-5 rounded-full border-2 border-im-ink px-2 text-[0.625rem] font-medium leading-4 tabular-nums text-im-ink ${
              atLimit ? "bg-im-accent" : "bg-im-paper"
            }`}
          >
            <span aria-hidden>
              {value.length} / {MAX_MESSAGE_CHARS}
            </span>
            <span className="sr-only">
              {value.length} de {MAX_MESSAGE_CHARS} caracteres
            </span>
          </span>
        )}
        {/* Solo se anuncia el tope, que es cuando deja de entrar texto. */}
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
          aria-describedby={showCounter ? hintId + " " + counterId : hintId}
          // 30dvh: con poca altura (móvil en horizontal, zoom), un campo de
          // 200px se comería la conversación y empujaría el botón fuera.
          className="im-scroll max-h-[min(200px,30dvh)] min-h-9 flex-1 resize-none bg-transparent px-2.5 py-[5px] text-base leading-relaxed text-im-ink outline-none placeholder:text-im-ink-muted"
        />

        {/* Un solo botón que cambia de función: enviar en reposo, detener
            mientras responde. Siendo dos, el foco se perdería al pasar de uno
            a otro. Por lo mismo, sin texto no lleva 'disabled', que le haría
            soltar el foco: aria-disabled lo anuncia como no disponible y
            submit() no hace nada. */}
        <motion.button
          type={isStreaming ? "button" : "submit"}
          onClick={
            isStreaming
              ? () => {
                  returnFocus();
                  onStop();
                }
              : undefined
          }
          aria-label={isStreaming ? "Detener la respuesta" : "Enviar mensaje"}
          aria-disabled={!isStreaming && !canSend ? true : undefined}
          whileTap={!isStreaming && canSend ? { scale: 0.94 } : undefined}
          // Sobre papel, el anillo amarillo no se vería: va en azul de tinta.
          className={`im-comic im-comic-press flex size-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-im-ink-accent ${
            isStreaming
              ? "bg-im-paper text-im-ink"
              : canSend
                ? "bg-im-accent text-im-ink hover:brightness-105"
                : "cursor-not-allowed bg-im-paper text-im-ink-muted shadow-none"
          }`}
        >
          <motion.span
            key={isStreaming ? "stop" : "send"}
            // El cuadrado de detener entra con un pequeño salto, como antes
            // entraba el botón entero; la flecha aparece sin más.
            initial={isStreaming ? { opacity: 0, scale: 0.85 } : false}
            animate={{ opacity: 1, scale: 1 }}
            className="flex"
          >
            {isStreaming ? (
              <span className="size-2.5 rounded-[2px] bg-current" />
            ) : (
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
            )}
          </motion.span>
        </motion.button>
      </div>

      {/* En móvil, solo para lectores de pantalla: sin teclado físico la
          indicación estorba a la vista, pero sigue describiendo el campo.
          Mientras responde, cuenta lo único que se puede hacer: detenerla. */}
      <p
        id={hintId}
        className="mt-3 px-1 text-[0.6875rem] text-im-faint max-sm:sr-only"
      >
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
