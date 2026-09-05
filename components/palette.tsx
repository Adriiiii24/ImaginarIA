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
 * Hay cinco colores y cinco huecos: el fondo y las cuatro figuras. Cada
 * pulsación gira la asignación, así que siempre están los cinco colores en
 * juego y nunca se repite ninguno.
 *
 * El salto es de dos posiciones y no de una. Con cinco colores, 2 y 5 son
 * primos entre sí, de modo que el fondo recorre los cinco antes de repetirse
 * -igual que con un salto de uno-, pero el recorrido empieza por magenta y
 * sigue por verde, que es la secuencia pedida.
 */
const PALETA = [
  "#0007ff", // azul    — fondo inicial
  "#fd5959", // coral   — círculo
  "#e26af5", // magenta — triángulo
  "#f4de5e", // amarillo — cuadrado
  "#88f95d", // verde   — rombo
] as const;

/** Orden de los huecos. El índice 0 es el fondo; el resto, las figuras. */
const HUECOS = [
  "--im-bg",
  "--im-shape-1",
  "--im-shape-2",
  "--im-shape-3",
  "--im-shape-4",
] as const;

const SALTO = 2;

interface PaletaContextValue {
  /** Cuántas veces se ha girado. */
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

const colorDelHueco = (indiceHueco: number, paso: number): string =>
  PALETA[(indiceHueco + paso * SALTO) % PALETA.length];

export function PaletaProvider({ children }: { children: ReactNode }) {
  const [paso, setPaso] = useState(0);

  // Las variables se escriben en <html> y no en un contenedor porque el fondo
  // de la página lo pinta <body>: si se quedaran en un div interior, el color
  // no llegaría a los bordes de la ventana.
  useEffect(() => {
    const raiz = document.documentElement;
    HUECOS.forEach((hueco, indice) => {
      raiz.style.setProperty(hueco, colorDelHueco(indice, paso));
    });
  }, [paso]);

  // Al desmontar se devuelven los valores de la hoja de estilos, para no dejar
  // estilos en línea pegados a <html> si el widget se cierra.
  useEffect(() => {
    const raiz = document.documentElement;
    return () => {
      HUECOS.forEach((hueco) => raiz.style.removeProperty(hueco));
    };
  }, []);

  const girar = useCallback(() => setPaso((actual) => actual + 1), []);

  return (
    <PaletaContext.Provider
      value={{ paso, siguienteColor: colorDelHueco(0, paso + 1), girar }}
    >
      {children}
    </PaletaContext.Provider>
  );
}
