/**
 * Lectura del entorno tolerante a variables vacías.
 *
 * Existe por un fallo que solo aparece al desplegar. Los paneles de Vercel,
 * Netlify o Railway detectan las claves de .env.example y las crean con el
 * valor en blanco. Una variable vacía NO es una variable ausente:
 *
 *   process.env.GEMINI_MODEL ?? "gemini-3.7-flash"   -> ""  (?? solo cubre null)
 *   Number("")                                        -> 0   (y 0 es finito)
 *
 * Con lo cual el modelo se queda sin nombre, la temperatura baja a 0 y el
 * límite de peticiones pasa a 0, que rechaza absolutamente todo. Y nada de
 * eso lanza un error: la aplicación arranca y se comporta mal en silencio,
 * que es la peor manera de fallar.
 *
 * Aquí una cadena vacía o de solo espacios cuenta como "no definida".
 */

/** Valor de la variable, o undefined si falta o está en blanco. */
export function env(nombre: string): string | undefined {
  const valor = process.env[nombre]?.trim();
  return valor ? valor : undefined;
}

/** Igual, pero numérico y con valor por defecto si falta o no es un número. */
export function envNum(nombre: string, porDefecto: number): number {
  const valor = env(nombre);
  if (valor === undefined) return porDefecto;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : porDefecto;
}
