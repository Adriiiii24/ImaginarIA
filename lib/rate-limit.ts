/**
 * Rate limiting de ventana fija, en memoria.
 *
 * ADVERTENCIA HONESTA: esto es por instancia. En serverless con varias
 * instancias activas el limite efectivo se multiplica por el numero de
 * instancias, y se reinicia en cada arranque en frio. Es suficiente para
 * frenar el abuso trivial de un chat de portfolio -y evitar que alguien te
 * funda la cuota de la API en una tarde-, pero si el trafico crece, sustituye
 * este mapa por @upstash/ratelimit con Redis, que es lo unico que da un
 * limite real y distribuido.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Segundos hasta que se abre la ventana siguiente. 0 si ok. */
  retryAfter: number;
}

export interface RateLimiter {
  /** Registra un intento. `now` solo existe para poder probarlo. */
  hit(key: string, now?: number): RateLimitResult;
}

export function createRateLimiter({
  max,
  windowMs,
  maxKeys = 10_000,
}: {
  max: number;
  windowMs: number;
  /** A partir de cuantas claves se purgan las ventanas caducadas. */
  maxKeys?: number;
}): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    hit(key, now = Date.now()) {
      const entry = hits.get(key);

      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        // Purga barata: sin esto el mapa crece indefinidamente en una
        // instancia de larga vida.
        if (hits.size > maxKeys) {
          for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
        }
        return { ok: true, retryAfter: 0 };
      }

      entry.count += 1;
      const ok = entry.count <= max;
      return {
        ok,
        retryAfter: ok ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
      };
    },
  };
}

/**
 * Identifica al cliente por su IP.
 *
 * En Vercel, x-forwarded-for lo escribe la propia plataforma y el primer valor
 * es el cliente real. Detras de otro proxy, asegurate de que este sobrescribe
 * la cabecera: si solo la reenvia, el cliente puede inventarsela.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "anonymous";
}
