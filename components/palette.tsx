"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Rotación de la paleta.
 *
 * El azul del fondo VIAJA de figura en figura. En cada pulsación:
 *
 *   - el fondo toma el color de la figura que toca,
 *   - esa figura se queda con el azul,
 *   - y las demás mantienen su color de siempre.
 *
 * Así solo cambia una figura por pulsación (la que recibe el azul), y la que
 * lo tenía antes vuelve a su color. A la quinta se cierra el ciclo y todo
 * regresa al reparto inicial.
 *
 *   inicio    fondo azul     · círculo coral · triángulo magenta
 *                            · cuadrado amarillo · rombo verde
 *   paso 1    fondo magenta  · triángulo AZUL
 *   paso 2    fondo verde    · rombo AZUL       (el triángulo vuelve a magenta)
 *   paso 3    fondo amarillo · cuadrado AZUL
 *   paso 4    fondo coral    · círculo AZUL
 *   paso 5    vuelta al inicio
 */

const AZUL = "#0007ff";

/** Color propio de cada figura, por posición. */
const BASE = [
  "#fd5959", // 1 · círculo,   arriba izquierda
  "#e26af5", // 2 · triángulo, arriba derecha
  "#f4de5e", // 3 · cuadrado,  abajo izquierda
  "#88f95d", // 4 · rombo,     abajo derecha
] as const;

/**
 * Orden en que las figuras reciben el azul: un recorrido en el sentido de las
 * agujas del reloj empezando por el triángulo, arriba a la derecha.
 */
const RECORRIDO = [1, 3, 2, 0] as const;

const TOTAL_PASOS = RECORRIDO.length + 1; // los cuatro relevos y el reposo

/** Color de fondo en un paso dado. En el paso 0 es el azul de partida. */
const fondoEnPaso = (paso: number): string =>
  paso === 0 ? AZUL : BASE[RECORRIDO[paso - 1]];

/** Color de una figura en un paso dado: el azul si le toca, si no el suyo. */
const figuraEnPaso = (indiceFigura: number, paso: number): string =>
  paso !== 0 && RECORRIDO[paso - 1] === indiceFigura ? AZUL : BASE[indiceFigura];

/* -------------------------------------------------------------------------- */
/* Pausa de las figuras                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Las figuras flotan en bucle durante toda la visita, a la vez que el chat:
 * WCAG 2.2.2 pide poder pararlas desde la propia página, sin depender de la
 * preferencia del sistema. La elección se recuerda entre visitas.
 *
 * El estado vive fuera de React, como la muestra de sugerencias: el servidor
 * pinta siempre "en marcha" y el cliente pasa a lo guardado al hidratar, sin
 * setState dentro de un efecto. Y vive en memoria además de en localStorage:
 * si el navegador lo bloquea (modo privado estricto, iframe sin permisos), el
 * botón sigue funcionando durante la visita aunque no se recuerde.
 */
const CLAVE_PAUSA = "imaginaria:animacion-en-pausa";

let enPausaActual: boolean | null = null; // null: aún sin leer
const oyentesPausa = new Set<() => void>();

const leerPausa = (): boolean => {
  if (enPausaActual === null) {
    try {
      enPausaActual = localStorage.getItem(CLAVE_PAUSA) === "1";
    } catch {
      enPausaActual = false;
    }
  }
  return enPausaActual;
};

const guardarPausa = (enPausa: boolean) => {
  enPausaActual = enPausa;
  try {
    if (enPausa) localStorage.setItem(CLAVE_PAUSA, "1");
    else localStorage.removeItem(CLAVE_PAUSA);
  } catch {
    // Sin almacenamiento: vale para esta visita y no se recuerda.
  }
  oyentesPausa.forEach((oyente) => oyente());
};

const suscribirPausa = (oyente: () => void) => {
  oyentesPausa.add(oyente);
  return () => {
    oyentesPausa.delete(oyente);
  };
};

/** Con prefers-reduced-motion el CSS ya tiene las figuras quietas. */
const CONSULTA_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

const leerMovimientoReducido = () =>
  window.matchMedia(CONSULTA_MOVIMIENTO).matches;

const suscribirMovimientoReducido = (oyente: () => void) => {
  const consulta = window.matchMedia(CONSULTA_MOVIMIENTO);
  consulta.addEventListener("change", oyente);
  return () => consulta.removeEventListener("change", oyente);
};

/** Instantánea del servidor para los dos: ni en pausa ni reducido. */
const nunca = () => false;

/* -------------------------------------------------------------------------- */

interface PaletaContextValue {
  paso: number;
  /** Color al que pasará el fondo en la siguiente pulsación. */
  siguienteColor: string;
  girar: () => void;
  /** Las figuras están en pausa porque así lo ha pedido quien mira. */
  enPausa: boolean;
  alternarPausa: () => void;
  /**
   * prefers-reduced-motion activo: las figuras ya están quietas, no hay nada
   * que pausar ni reanudar y el botón no debe aparecer (diría que se mueven).
   */
  movimientoReducido: boolean;
}

const PaletaContext = createContext<PaletaContextValue | null>(null);

/**
 * Devuelve null si no hay proveedor por encima, para que el botón
 * sencillamente no aparezca donde la rotación no tiene sentido.
 */
export function usePaleta(): PaletaContextValue | null {
  return useContext(PaletaContext);
}

export function PaletaProvider({ children }: { children: ReactNode }) {
  const [paso, setPaso] = useState(0);
  const enPausa = useSyncExternalStore(suscribirPausa, leerPausa, nunca);
  const movimientoReducido = useSyncExternalStore(
    suscribirMovimientoReducido,
    leerMovimientoReducido,
    nunca,
  );

  // Las variables se escriben en <html> y no en un contenedor porque el fondo
  // de la página lo pinta <body>: si se quedaran en un div interior, el color
  // no llegaría a los bordes de la ventana.
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.style.setProperty("--im-bg", fondoEnPaso(paso));
    BASE.forEach((_, indice) => {
      raiz.style.setProperty(
        "--im-shape-" + (indice + 1),
        figuraEnPaso(indice, paso),
      );
    });
  }, [paso]);

  // La pausa, también en <html>: las figuras son CSS puro (BackgroundShapes es
  // un componente de servidor) y es el CSS el que las detiene.
  useEffect(() => {
    const raiz = document.documentElement;
    if (enPausa) raiz.dataset.imAnimacion = "en-pausa";
    else delete raiz.dataset.imAnimacion;
  }, [enPausa]);

  // Al desmontar se devuelven los valores de la hoja de estilos, para no dejar
  // estilos en línea pegados a <html> si el widget se cierra.
  useEffect(() => {
    const raiz = document.documentElement;
    return () => {
      raiz.style.removeProperty("--im-bg");
      BASE.forEach((_, indice) =>
        raiz.style.removeProperty("--im-shape-" + (indice + 1)),
      );
      delete raiz.dataset.imAnimacion;
    };
  }, []);

  const girar = useCallback(
    () => setPaso((actual) => (actual + 1) % TOTAL_PASOS),
    [],
  );

  const alternarPausa = useCallback(() => guardarPausa(!leerPausa()), []);

  return (
    <PaletaContext.Provider
      value={{
        paso,
        siguienteColor: fondoEnPaso((paso + 1) % TOTAL_PASOS),
        girar,
        enPausa,
        alternarPausa,
        movimientoReducido,
      }}
    >
      {children}
    </PaletaContext.Provider>
  );
}
