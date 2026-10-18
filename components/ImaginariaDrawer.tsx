"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BackgroundShapes } from "@/components/BackgroundShapes";
import { PaletaProvider } from "@/components/palette";
import { ChatContainer } from "@/components/chat/ChatContainer";

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
 */
export function ImaginariaDrawer({
  src,
  label = "Abrir ImaginarIA",
  side = "right",
}: ImaginariaDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Escape para cerrar y bloqueo del scroll de fondo. Sin el bloqueo, el
  // scroll del panel "atraviesa" y mueve la pagina que hay detras.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const offscreen = side === "right" ? "100%" : "-100%";

  return (
    <>
      <button
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

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"
            />

            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="ImaginarIA"
              initial={{ x: offscreen }}
              animate={{ x: 0 }}
              exit={{ x: offscreen }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className={`fixed inset-y-0 z-50 flex w-full max-w-[min(34rem,100vw)] flex-col border-im-border bg-im-bg shadow-2xl ${
                side === "right" ? "right-0 border-l" : "left-0 border-r"
              }`}
            >
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar"
                className="absolute right-4 top-3.5 z-20 flex size-7 items-center justify-center rounded-full text-im-faint transition-colors hover:text-im-text"
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

              {src ? (
                <iframe
                  src={src}
                  title="ImaginarIA"
                  className="size-full border-0"
                  // El iframe apunta a nuestro propio despliegue: le damos lo
                  // justo para funcionar y nada mas. Las popups son para los
                  // enlaces de las respuestas, que abren en pestana nueva;
                  // sin ellas, pulsarlos no haria nada.
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  // El boton de copiar respuesta, desde otro origen, necesita
                  // permiso explicito para escribir en el portapapeles.
                  allow="clipboard-write"
                />
              ) : (
                // Misma composicion que la pagina completa, para que el panel
                // no parezca otra aplicacion: azul, figuras y cristal.
                <PaletaProvider>
                  <div className="relative flex flex-1 overflow-hidden">
                    <BackgroundShapes />
                    <div className="relative z-10 flex flex-1 flex-col">
                      <ChatContainer autoFocus />
                    </div>
                  </div>
                </PaletaProvider>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
