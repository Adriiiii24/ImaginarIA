/**
 * Publica en Langfuse Prompt Management el system prompt del repositorio.
 *
 *   npm run prompt:publish               publica, si el texto ha cambiado
 *   npm run prompt:publish -- --dry-run  dice que haria, sin tocar nada
 *
 * Flujo de trabajo previsto: el prompt se edita y se revisa en el repositorio
 * (queda en el historial de git, con su diff y su revision), y este script lo
 * publica como una version nueva en Langfuse con la etiqueta "production".
 * A partir de ahi la aplicacion lo sirve desde Langfuse y el del repositorio
 * queda como red de seguridad.
 *
 * Es idempotente: si la version con esa etiqueta ya tiene exactamente este
 * texto, no publica nada. Relanzarlo "por si acaso" creaba versiones
 * identicas, y el historial de Langfuse dejaba de decir cuando cambio algo de
 * verdad (y las metricas por version se repartian entre gemelas).
 *
 * Para ajustes rapidos en caliente puedes editarlo directamente en la interfaz
 * de Langfuse, pero entonces el repositorio deja de reflejar lo que corre en
 * produccion: recuerda traerte el cambio de vuelta.
 */
import { readFileSync } from "node:fs";
import { Langfuse } from "langfuse";

const dryRun = process.argv.includes("--dry-run");

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(
      readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [
            l.slice(0, i).trim(),
            l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
};

// .env.local gana sobre .env, igual que hace Next.js.
const env = { ...leerEnv(".env"), ...leerEnv(".env.local"), ...process.env };

if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
  console.error("Faltan LANGFUSE_PUBLIC_KEY y/o LANGFUSE_SECRET_KEY.");
  process.exit(1);
}

// Extraemos el prompt del fichero fuente sin necesidad de compilar TypeScript:
// es una constante con un literal de plantilla, y asi el script no arrastra
// ninguna cadena de build.
const fuente = readFileSync("lib/ai/system-prompt.ts", "utf8");
const texto = fuente
  .split("IMAGINARIA_SYSTEM_PROMPT = `")[1]
  ?.split("`.trim();")[0]
  ?.trim();
const version = fuente.match(/SYSTEM_PROMPT_VERSION = "([^"]+)"/)?.[1];
const nombre = fuente.match(/SYSTEM_PROMPT_NAME = "([^"]+)"/)?.[1];

if (!texto || !version || !nombre) {
  console.error("No se ha podido extraer el prompt de lib/ai/system-prompt.ts.");
  process.exit(1);
}

// La extraccion copia el texto TAL CUAL esta escrito en el fichero. Con una
// interpolacion o una secuencia de escape, lo publicado no seria lo que la
// aplicacion ve al evaluar el literal: mejor negarse que publicar otra cosa.
if (texto.includes("${") || texto.includes("\\")) {
  console.error(
    "El prompt usa ${...} o secuencias de escape (\\). Este script no las " +
      "evalua y publicaria un texto distinto del que usa la aplicacion.",
  );
  process.exit(1);
}

const etiqueta = env.LANGFUSE_PROMPT_LABEL || "production";

const lf = new Langfuse({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
});

let actual = null;
// El SDK escribe su propio "Error while fetching prompt", con la traza entera,
// aunque el error se capture. Aqui un 404 es lo normal en la primera
// publicacion, asi que se silencia solo mientras dura esta consulta.
const consoleError = console.error;
console.error = () => {};
try {
  actual = await lf.getPrompt(nombre, undefined, {
    label: etiqueta,
    type: "text",
    // Siempre la version real del servidor, nunca una copia en cache.
    cacheTtlSeconds: 0,
  });
} catch (error) {
  console.error = consoleError;
  // "No encontrado" es la primera publicacion, o una etiqueta que todavia no
  // apunta a ninguna version. Cualquier otra cosa (credenciales, red) no:
  // seguir diria "no hay nada publicado" cuando en realidad no se sabe.
  const mensaje = error instanceof Error ? error.message : String(error);
  if (!/not found/i.test(mensaje)) {
    console.error("No se ha podido consultar el prompt actual en Langfuse:", mensaje);
    process.exit(1);
  }
} finally {
  console.error = consoleError;
}

if (actual?.prompt === texto) {
  console.log(
    "Sin cambios: la version " + actual.version + " de " + nombre +
      " (" + etiqueta + ") ya tiene este texto. No se publica nada.",
  );
  await lf.shutdownAsync();
  process.exit(0);
}

if (dryRun) {
  console.log("--dry-run: se publicaria una version nueva.");
  console.log("  nombre    :", nombre);
  console.log("  etiqueta  :", etiqueta);
  console.log(
    "  ahora     :",
    actual
      ? "version " + actual.version + ", " + actual.prompt.length + " caracteres"
      : "(ninguna version con esta etiqueta)",
  );
  console.log("  nuevo     : v" + version + ", " + texto.length + " caracteres");
  await lf.shutdownAsync();
  process.exit(0);
}

const prompt = await lf.createPrompt({
  name: nombre,
  type: "text",
  prompt: texto,
  labels: [etiqueta],
  commitMessage: "Publicado desde el repositorio, v" + version,
});

console.log("Publicado en Langfuse:");
console.log("  nombre   :", prompt.name);
console.log("  version  :", prompt.version);
console.log("  etiquetas:", prompt.labels.join(", "));
console.log("  caracteres:", prompt.prompt.length);
console.log("");
console.log("Para que la aplicacion lo use, en .env:");
console.log("  LANGFUSE_PROMPT_LABEL=" + etiqueta);

await lf.shutdownAsync();
