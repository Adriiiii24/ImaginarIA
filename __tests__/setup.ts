import { afterEach, vi } from "vitest";

/**
 * Aislamiento: ningún test habla con un proveedor real ni con Langfuse,
 * aunque la terminal que los lanza tenga las claves exportadas. Gastar cuota
 * o escribir trazas de producción desde un test sería el peor efecto
 * secundario posible.
 */
for (const name of [
  "AI_PROVIDER",
  "GOOGLE_AI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_PROMPT_LABEL",
]) {
  delete process.env[name];
}

/** Un fetch sin simular falla en voz alta en vez de salir a la red. */
const unmockedFetch = () => {
  throw new Error("fetch sin simular en un test: usa vi.stubGlobal('fetch', ...)");
};

vi.stubGlobal("fetch", unmockedFetch);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", unmockedFetch);
});
