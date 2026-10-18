"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useImaginaria } from "@/components/chat/useImaginaria";
import { usePaleta } from "@/components/palette";
import { BrandMark } from "@/components/BrandMark";
import {
  getClientSuggestions,
  getServerSuggestions,
  subscribeSuggestions,
} from "@/lib/suggestions";

interface ChatContainerProps {
  className?: string;
  autoFocus?: boolean;
  /**
   * Nivel del título "ImaginarIA": 1 en la página propia, 2 cuando va dentro
   * de otra (el panel del portfolio), que ya tiene su h1.
   */
  headingLevel?: 1 | 2;
  /** Id del título, para que el diálogo que lo contenga se nombre con él. */
  headingId?: string;
  /** Controles al final de la cabecera, como el "Cerrar" del panel. */
  headerEnd?: ReactNode;
}

/**
 * Lo que la app manda a la página que la tiene en un iframe para pedirle que
 * cierre el panel. Con el foco dentro del iframe, las teclas no llegan a la
 * página de fuera, y su Escape no se entera. Lo escucha ImaginariaDrawer.
 */
export const CLOSE_MESSAGE = "imaginaria:cerrar";

/** 'smooth' salvo con prefers-reduced-motion: desplazarse también es moverse. */
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

/**
 * Orquesta la conversacion: estado (delegado en useImaginaria), scroll y
 * composicion de los tres bloques de la interfaz.
 */
export function ChatContainer({
  className = "",
  autoFocus,
  headingLevel = 1,
  headingId,
  headerEnd,
}: ChatContainerProps) {
  const { messages, status, error, canRetry, send, retry, stop, rate, reset } =
    useImaginaria();
  // null cuando no hay PaletaProvider por encima: el boton simplemente no sale.
  const paleta = usePaleta();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);

  /**
   * Para los controles que desaparecen al pulsarlos: una sugerencia, "Empezar
   * de cero", "Reintentar", "Ir al final". Sin esto, el foco cae al <body> y
   * quien navega con teclado o lector de pantalla vuelve al principio de la
   * página. Aquí siempre, también en táctil: el foco tiene que ir a algún
   * sitio, y lo siguiente que se hace es escribir.
   */
  const focusInput = () => inputRef.current?.focus();

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
    const show = !pinnedRef.current && messages.length > 0;
    // "Ir al final" también desaparece al bajar a mano. Si tenía el foco, que
    // no caiga con él.
    if (!show && document.activeElement === jumpRef.current) {
      inputRef.current?.focus();
    }
    setShowJump(show);
  }, [messages.length]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({
      // 'auto' durante el streaming: un 'smooth' por token encola cientos de
      // animaciones de scroll y la vista se queda por detras del texto.
      behavior: status === "streaming" ? "auto" : scrollBehavior(),
      block: "end",
    });
  }, [messages, status]);

  const jumpToBottom = () => {
    pinnedRef.current = true;
    setShowJump(false);
    focusInput();
    bottomRef.current?.scrollIntoView({
      behavior: scrollBehavior(),
      block: "end",
    });
  };

  const restart = () => {
    reset();
    focusInput();
  };

  const retryTurn = () => {
    focusInput();
    retry();
  };

  const pickSuggestion = (suggestion: string) => {
    focusInput();
    send(suggestion);
  };

  // Escape, esté donde esté el foco: con una respuesta en curso la detiene,
  // como en el campo del mensaje; si no, y la app va dentro de un iframe,
  // pide a la página de fuera que cierre el panel (ver CLOSE_MESSAGE).
  // El escuchador se registra una vez y lee el estado de una ref que se
  // actualiza con el DOM: si se volviera a registrar en un efecto tras cada
  // cambio, un Escape justo al acabar la respuesta leería el estado viejo y
  // volvería a detener en vez de cerrar.
  const escapeState = useRef({ status, stop });
  useLayoutEffect(() => {
    escapeState.current = { status, stop };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (escapeState.current.status === "streaming") {
        // Que el mismo Escape no cierre además el diálogo que contenga el chat.
        event.preventDefault();
        escapeState.current.stop();
      } else if (window.parent !== window) {
        window.parent.postMessage({ type: CLOSE_MESSAGE }, "*");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Avisos breves para lectores de pantalla: "Copiado", o que no se ha
  // podido. Una sola región para todos los bocadillos.
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announce = useCallback((text: string) => {
    clearTimeout(noticeTimer.current);
    // Se vacía antes de escribir: dos copias seguidas dicen lo mismo y, sin
    // un cambio de por medio, la segunda no se anunciaría.
    setNotice("");
    noticeTimer.current = setTimeout(() => {
      setNotice(text);
      noticeTimer.current = setTimeout(() => setNotice(""), 3_000);
    }, 100);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const isEmpty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  const streamingId =
    status === "streaming" && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;

  const Heading = headingLevel === 2 ? "h2" : "h1";

  return (
    <div className={`relative flex h-full flex-col ${className}`}>
      {/* Cabecera. Con wrap: en el panel del portfolio a 320px, con "Cerrar"
          al final, los controles no caben en la línea del título y bajan a
          una segunda en vez de salirse. */}
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-im-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <Heading
            id={headingId}
            className="text-sm font-semibold tracking-tight text-im-text"
          >
            Imaginar<span className="text-im-accent">IA</span>
          </Heading>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {!isEmpty && (
            <button
              type="button"
              onClick={restart}
              className="rounded-full px-3 py-1 text-xs text-im-faint transition-colors hover:text-im-text"
            >
              Empezar de cero
            </button>
          )}

          {/* Las figuras del fondo se mueven sin parar mientras se lee: aquí
              se pueden detener (WCAG 2.2.2). Con prefers-reduced-motion ya
              están quietas y el botón no sale, porque no habría nada que
              pausar ni reanudar. */}
          {paleta && !paleta.movimientoReducido && (
            <button
              type="button"
              onClick={paleta.alternarPausa}
              aria-label={
                paleta.enPausa ? "Reanudar animación" : "Pausar animación"
              }
              title={paleta.enPausa ? "Reanudar animación" : "Pausar animación"}
              className="im-comic im-comic-press ml-1 flex size-7 items-center justify-center rounded-full bg-im-paper text-im-ink"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-3"
                fill="currentColor"
                aria-hidden
              >
                {paleta.enPausa ? (
                  <path d="M7 4.5v15L19.5 12Z" />
                ) : (
                  <path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" />
                )}
              </svg>
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
              className="im-comic im-comic-press ml-1 flex size-7 items-center justify-center rounded-full bg-im-paper"
            >
              <span
                aria-hidden
                className="size-3 rounded-full transition-colors duration-500"
                style={{ backgroundColor: paleta.siguienteColor }}
              />
            </button>
          )}

          {headerEnd}
        </div>
      </header>

      {/* Conversacion */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="im-scroll relative flex-1 overflow-y-auto overscroll-contain px-5"
      >
        <div className="relative z-[1] mx-auto flex w-full max-w-2xl flex-col gap-4 py-7">
          {isEmpty ? (
            <EmptyState onPick={pickSuggestion} headingLevel={headingLevel} />
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
                    onFeedback={rate}
                    onAnnounce={announce}
                  />
                ))}
            </AnimatePresence>
          )}

          {/* Espera antes del primer token: sin esto, el envio parece no hacer
              nada durante medio segundo largo. */}
          {status === "streaming" && lastMessage?.content === "" && <Thinking />}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="flex items-center justify-between gap-3 rounded-im-sm border border-im-danger/30 bg-im-danger/10 px-4 py-3 text-sm text-im-danger"
            >
              <p>{error}</p>
              {canRetry && (
                <button
                  type="button"
                  onClick={retryTurn}
                  className="im-comic im-comic-press shrink-0 rounded-full bg-im-paper px-3 py-1 text-xs font-medium text-im-ink"
                >
                  Reintentar
                </button>
              )}
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Para lectores de pantalla: mientras responde, que está escribiendo;
          al terminar, la respuesta entera. Como región viva, la lista la
          leería a trozos, token a token, en decenas de avisos. Siempre
          montada y cambiando de texto: una región que aparece ya con el
          texto dentro (como el indicador de espera) NVDA y JAWS no suelen
          anunciarla. */}
      <p className="sr-only" aria-live="polite">
        {status === "streaming"
          ? "ImaginarIA está escribiendo…"
          : lastMessage?.role === "assistant"
            ? spokenText(lastMessage.content)
            : ""}
      </p>
      <p role="status" className="sr-only">
        {notice}
      </p>

      {/* Volver al final */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            ref={jumpRef}
            type="button"
            onClick={jumpToBottom}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="im-comic im-comic-press absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full bg-im-paper px-3.5 py-1.5 text-xs font-medium text-im-ink"
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
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * La respuesta sin las marcas de Markdown, para el anuncio en voz alta: un
 * lector de pantalla leería "asterisco asterisco" antes de cada negrita, y un
 * guion o una barra vertical en cada línea de una lista o una tabla. De los
 * enlaces se queda el texto; de una tabla, sus celdas separadas por comas.
 */
const spokenText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    // Fuera las filas que solo separan la cabecera de una tabla (|---|:-:|)
    // y las rayas horizontales (---, ***).
    .filter(
      (line) =>
        !(line.includes("|") && /^[\s|:-]*-[\s|:-]*$/.test(line)) &&
        !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line),
    )
    .map((line) =>
      line
        // Viñetas al principio de la línea: "- ", "* ", "+ ".
        .replace(/^(\s*)[-*+]\s+/, "$1")
        // Tuberías de una tabla: las de los extremos sobran; entre celdas,
        // una coma hace la pausa.
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .replace(/\s*\|\s*/g, ", "),
    )
    .join("\n")
    .replace(/[*_`#>~]/g, "");

function EmptyState({
  onPick,
  headingLevel,
}: {
  onPick: (value: string) => void;
  headingLevel: 1 | 2;
}) {
  // Cuatro de una lista larga, sorteadas en cada carga de la página.
  //
  // useSyncExternalStore y no un efecto: el servidor necesita un HTML
  // determinista para que la hidratación no falle, y este hook está pensado
  // justo para eso. Da la muestra fija al renderizar en servidor y cambia a la
  // sorteada en cuanto hidrata, sin setState dentro de un efecto ni el render
  // en cascada que eso arrastra.
  const suggestions = useSyncExternalStore(
    subscribeSuggestions,
    getClientSuggestions,
    getServerSuggestions,
  );

  // Un nivel por debajo del título de la cabecera.
  const Heading = headingLevel === 2 ? "h3" : "h2";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-7 pt-10"
    >
      <div className="space-y-3">
        <Heading className="text-2xl font-semibold leading-snug tracking-tight text-im-text">
          ¿Qué te ronda la cabeza?
        </Heading>
        <p className="max-w-md text-[0.9375rem] leading-relaxed text-im-muted">
          Cuéntamelo como te salga y le damos vueltas juntos. Te llevaré la
          contraria alguna vez, pero siempre a favor de la idea.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + index * 0.06, duration: 0.35 }}
            className="im-comic im-comic-press rounded-full bg-im-paper px-3.5 py-2 text-left text-[0.8125rem] font-medium text-im-ink hover:bg-im-accent"
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
    // Solo para la vista: a los lectores de pantalla se lo cuenta la región
    // viva del contenedor, que ya existía antes de cambiar de texto.
    <div aria-hidden className="flex items-center gap-1.5">
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
