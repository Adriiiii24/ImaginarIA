"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
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

interface PaletaContextValue {
  paso: number;
  /** Color al que pasará el fondo en la siguiente pulsación. */
  siguienteColor: string;
  girar: () => void;
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

  // Al desmontar se devuelven los valores de la hoja de estilos, para no dejar
  // estilos en línea pegados a <html> si el widget se cierra.
  useEffect(() => {
    const raiz = document.documentElement;
    return () => {
      raiz.style.removeProperty("--im-bg");
      BASE.forEach((_, indice) =>
        raiz.style.removeProperty("--im-shape-" + (indice + 1)),
      );
    };
  }, []);

  const girar = useCallback(
    () => setPaso((actual) => (actual + 1) % TOTAL_PASOS),
    [],
  );

  return (
    <PaletaContext.Provider
      value={{
        paso,
        siguienteColor: fondoEnPaso((paso + 1) % TOTAL_PASOS),
        girar,
      }}
    >
      {children}
    </PaletaContext.Provider>
  );
}
