import { after } from "next/server";
import type { ErrorCode } from "@/lib/ai/types";

/**
 * Utilidades HTTP compartidas por los Route Handlers.
 */

export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  headers: HeadersInit = {},
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; error: "too_large" | "invalid_json" };

/**
 * Lee un cuerpo JSON sin pasar de `maxBytes`.
 *
 * request.json() lo lee entero antes de que podamos validar nada: un cuerpo
 * de cien megas se carga en memoria solo para acabar rechazado por el primer
 * limite. Aqui se corta en cuanto se pasa del tope, se anuncie o no el tamano
 * en Content-Length (con transfer-encoding chunked no viene).
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: "too_large" };
  }
  if (!request.body) return { ok: false, error: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    // El cliente corto la subida a medias.
    return { ok: false, error: "invalid_json" };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

/**
 * Programa una tarea para cuando la respuesta ya se ha enviado entera.
 *
 * Es after() de Next: en Vercel extiende la vida de la funcion con waitUntil,
 * asi que la tarea termina aunque el cliente ya tenga su respuesta. Devuelve
 * false si la plataforma no ofrece waitUntil (after() lanza en ese caso), y
 * entonces es el llamante quien debe ejecutarla antes de responder.
 */
export function runAfterResponse(task: () => Promise<void>): boolean {
  try {
    after(task);
    return true;
  } catch {
    return false;
  }
}
