import { validateFeedback } from "@/lib/chat/validate";
import { envNum } from "@/lib/env";
import { errorResponse, readJsonBody, runAfterResponse } from "@/lib/http";
import { getObservability } from "@/lib/observability/langfuse";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

/**
 * POST /api/feedback
 *
 * La valoracion del usuario sobre una respuesta, como score de Langfuse
 * enlazado a su traza. Es la mitad que le faltaba al LLMOps del proyecto: las
 * trazas ya decian que version del prompt contesto; con esto dicen tambien si
 * la respuesta sirvio, y Langfuse lo agrega por version.
 *
 * Responde 204 tanto si se registra como si las trazas estan desactivadas: el
 * cliente no tiene nada que hacer con la diferencia (y sin trazas ni siquiera
 * muestra los botones, porque no recibe traceId).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mas holgado que el chat: votar es barato, pero sigue siendo escritura.
const limiter = createRateLimiter({
  max: envNum("FEEDBACK_RATE_LIMIT_REQUESTS", 30),
  windowMs: 60_000,
});

export async function POST(request: Request): Promise<Response> {
  const limit = limiter.hit(clientKey(request));
  if (!limit.ok) {
    return errorResponse(
      "rate_limited",
      "Demasiadas valoraciones seguidas.",
      429,
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  const body = await readJsonBody(request, 1024);
  if (!body.ok) {
    return body.error === "too_large"
      ? errorResponse("payload_too_large", "Cuerpo demasiado grande.", 413)
      : errorResponse("bad_request", "JSON inválido.", 400);
  }

  const feedback = validateFeedback(body.value);
  if (typeof feedback === "string") {
    return errorResponse("bad_request", feedback, 400);
  }

  const observability = await getObservability();
  if (observability.enabled) {
    observability.score(feedback);
    const flush = () => observability.flush();
    if (!runAfterResponse(flush)) await flush();
  }

  return new Response(null, { status: 204 });
}
