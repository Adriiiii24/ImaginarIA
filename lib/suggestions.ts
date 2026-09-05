/**
 * El repertorio de ideas sugeridas.
 *
 * Deliberadamente variado y en su mayoría fuera del mundo del producto: la
 * mitad del valor de estas píldoras es decirle al visitante, sin explicarlo,
 * que ImaginarIA no es una herramienta de trabajo. Sirve igual para desatascar
 * una novela que para ponerle nombre a un perro, y la lista tiene que
 * demostrarlo antes de que nadie escriba nada.
 *
 * Están escritas en primera persona y en el tono en que se lo contarías a un
 * amigo, no como categorías de un menú.
 */
export const SUGGESTION_POOL = [
  // Proyectos y oficios
  "Quiero montar un proyecto de mecánica y no se me ocurre nada",
  "Tengo un trastero enorme y ni idea de qué hacer con él",
  "Quiero hacer un huerto en el balcón y no sé por dónde empezar",
  "Me han pedido una charla de veinte minutos y no tengo tema",
  "Mi TFG tiene que ser original y voy en blanco",

  // Ponerle nombre a las cosas
  "Tengo que ponerle nombre a mi perro y no me convence ninguno",
  "Necesito un nombre para mi grupo que no suene a los noventa",
  "Necesito un nombre que no suene a startup de 2015",

  // Bloqueos creativos
  "Llevo tres meses atascado en el capítulo dos de mi novela",
  "Quiero pintar algo pero llevo semanas mirando el lienzo",
  "Le he prometido un cuento a mi sobrino y no se me ocurre ninguno",
  "Quiero grabar un pódcast pero no sé de qué",

  // Vida cotidiana
  "Me toca organizar la cena de Navidad y quiero salirme de lo típico",
  "Quiero regalarle algo a mi hermana que no sea otra vela",
  "Necesito un plan para el sábado que no sea cine y cena",
  "Quiero aprender algo este año y no sé el qué",

  // Producto y negocio
  "Tengo otra app de hábitos y no sé en qué se diferencia",
  "Mi landing convierte fatal y no sé por qué",
  "Tengo una idea de negocio y no sé si es una tontería",

  // Desafiar al usuario
  "Llévame la contraria en algo que doy por hecho",
] as const;

/** Cuántas píldoras se muestran a la vez. */
export const SUGGESTIONS_SHOWN = 4;

/**
 * Toma una muestra sin repeticiones.
 *
 * Baraja solo los primeros `count` elementos (Fisher-Yates parcial) sobre una
 * copia, así que no toca el original ni recorre la lista entera.
 */
export function pickSuggestions(
  pool: readonly string[] = SUGGESTION_POOL,
  count: number = SUGGESTIONS_SHOWN,
): string[] {
  const copia = [...pool];
  const total = Math.min(count, copia.length);

  for (let i = 0; i < total; i++) {
    const j = i + Math.floor(Math.random() * (copia.length - i));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }

  return copia.slice(0, total);
}

/* -------------------------------------------------------------------------- */
/* Muestra estable por carga de página                                        */
/* -------------------------------------------------------------------------- */

/**
 * La muestra se calcula una sola vez por carga y se guarda aquí.
 *
 * useSyncExternalStore exige que getSnapshot devuelva SIEMPRE la misma
 * referencia mientras no haya cambios; sortear en cada llamada provocaría un
 * bucle infinito de renders.
 */
let muestraCliente: string[] | null = null;

/** Instantánea en el cliente: la muestra sorteada de esta carga. */
export const getClientSuggestions = (): string[] =>
  (muestraCliente ??= pickSuggestions());

/**
 * Instantánea en el servidor: siempre las mismas.
 *
 * El HTML del servidor tiene que ser determinista o la hidratación falla.
 * useSyncExternalStore acepta que ambas instantáneas difieran y se encarga de
 * volver a renderizar con la del cliente en cuanto termina de hidratar, que es
 * exactamente el comportamiento que queremos.
 */
const MUESTRA_SERVIDOR: string[] = SUGGESTION_POOL.slice(0, SUGGESTIONS_SHOWN);
export const getServerSuggestions = (): string[] => MUESTRA_SERVIDOR;

/** No hay fuente externa que escuche: la muestra no cambia en toda la sesión. */
export const subscribeSuggestions = (): (() => void) => () => {};
