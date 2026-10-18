"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { BackgroundShapes } from "@/components/BackgroundShapes";
import { PaletaProvider } from "@/components/palette";
import { ChatContainer, CLOSE_MESSAGE } from "@/components/chat/ChatContainer";

interface ImaginariaDrawerProps {
  /**
   * URL del despliegue independiente de ImaginarIA. Si se indica, el panel
   * carga la app en un iframe (integracion entre repositorios separados). Si
   * se omite, monta ChatContainer directamente (mismo proyecto o monorepo).
   */
  src?: string;
  label?: string;
  /** Lado por el que entra el panel. */
  side?: "right" | "left";
}

/**
 * Panel lateral desplegable: el envoltorio pensado para el portfolio.
 *
 * El proyecto se despliega como aplicacion independiente y ademas se embebe
 * aqui, de modo que el visitante prueba la herramienta sin salir de la web.
 *
 * Es un <dialog> abierto con showModal(), no un div con role="dialog": el
 * navegador deja inerte el resto de la página (ni el tabulador ni un lector
 * de pantalla se escapan por detrás del panel) y convierte Escape en una
 * petición de cierre. Al cerrarse, el foco vuelve al botón que lo abrió.
 */
export function ImaginariaDrawer({
  src,
  label = "Abrir ImaginarIA",
  side = "right",
}: ImaginariaDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const titleId = useId();

  const close = () => setIsOpen(false);

  // Modal en cuanto se monta, y el foco dentro, en "Cerrar". En un efecto de
  // layout para ir antes que los efectos normales del chat: el autoFocus del
  // campo, que solo actúa con teclado físico, necesita el diálogo ya abierto
  // y se queda con el foco. En táctil se queda en "Cerrar".
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
  }, [isOpen]);

  // Bloqueo del scroll de fondo. Sin él, el scroll del panel "atraviesa" y
  // mueve la pagina que hay detras.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Con la app en un iframe, Escape se queda dentro de él: es la app la que
  // pide el cierre con un mensaje. Solo se atiende si llega de nuestro iframe
  // y desde el origen de src.
  useEffect(() => {
    if (!isOpen || !src) return;
    const origin = new URL(src, window.location.href).origin;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === origin &&
        event.source === iframeRef.current?.contentWindow &&
        event.data?.type === CLOSE_MESSAGE
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isOpen, src]);

  // Terminada la salida, el foco vuelve al botón que abrió el panel; si no,
  // cae al <body> y quien navega con teclado vuelve al principio de la
  // página. close() primero: mientras el diálogo siga en la capa superior, el
  // resto de la página está inerte y el botón no puede recibir el foco.
  const restoreFocus = () => {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };

  const offscreen = side === "right" ? "100%" : "-100%";

  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      onClick={close}
      aria-label="Cerrar"
      className="ml-1 flex size-7 items-center justify-center rounded-full text-im-faint transition-colors hover:text-im-text"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );

  return (
    // Como en la página: framer-motion respeta prefers-reduced-motion solo si
    // se le pide. Con él, el panel aparece sin deslizarse.
    <MotionConfig reducedMotion="user">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="group inline-flex items-center gap-2 rounded-full border border-im-border-strong bg-im-glass px-4 py-2.5 text-sm font-medium text-im-text transition-colors duration-200 hover:border-im-accent"
      >
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-im-accent"
        />
        {label}
      </button>

      <AnimatePresence onExitComplete={restoreFocus}>
        {isOpen && (
          <dialog
            key="panel"
            ref={dialogRef}
            // Dentro del iframe el título no se puede referenciar desde aquí.
            aria-labelledby={src ? undefined : titleId}
            aria-label={src ? "ImaginarIA" : undefined}
            // Escape: que se cierre con la animación de salida, no de golpe.
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
            // Por si el navegador lo cierra sin dejar cancelar.
            onClose={close}
            // Transparente y a pantalla completa: el velo y el panel son
            // hijos suyos, para poder animarlos.
            className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-im-text backdrop:bg-transparent"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={close}
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            />

            <motion.div
              initial={{ x: offscreen }}
              animate={{ x: 0 }}
              exit={{ x: offscreen }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className={`absolute inset-y-0 flex w-full max-w-[min(34rem,100vw)] flex-col border-im-border bg-im-bg shadow-2xl ${
                side === "right" ? "right-0 border-l" : "left-0 border-r"
              }`}
            >
              {src ? (
                <>
                  {/* La cabecera de la app vive dentro del iframe y desde aquí
                      no se le puede hacer sitio: "Cerrar" va en una barra
                      propia, en vez de flotar encima de sus botones. */}
                  <div className="flex shrink-0 justify-end border-b border-im-border px-4 py-2">
                    {closeButton}
                  </div>
                  <iframe
                    ref={iframeRef}
                    src={src}
                    title="ImaginarIA"
                    className="min-h-0 w-full flex-1 border-0"
                    // El iframe apunta a nuestro propio despliegue: le damos lo
                    // justo para funcionar y nada mas. Las popups son para los
                    // enlaces de las respuestas, que abren en pestana nueva;
                    // sin ellas, pulsarlos no haria nada.
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                    // El boton de copiar respuesta, desde otro origen, necesita
                    // permiso explicito para escribir en el portapapeles.
                    allow="clipboard-write"
                  />
                </>
              ) : (
                // Misma composicion que la pagina completa, para que el panel
                // no parezca otra aplicacion: azul, figuras y cristal. Sin el
                // cristal, el texto quedaba directamente sobre el color de la
                // paleta y las figuras (blanco sobre verde: 1.3:1).
                <PaletaProvider>
                  <div className="relative flex flex-1 overflow-hidden p-3">
                    <BackgroundShapes />
                    <div className="im-glass relative z-10 flex flex-1 flex-col overflow-hidden rounded-im-lg">
                      <ChatContainer
                        autoFocus
                        headingLevel={2}
                        headingId={titleId}
                        headerEnd={closeButton}
                      />
                    </div>
                  </div>
                </PaletaProvider>
              )}
            </motion.div>
          </dialog>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
