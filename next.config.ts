import type { NextConfig } from "next";

/**
 * Quién puede embeber ImaginarIA en un iframe.
 *
 * Por defecto, solo el propio origen: cualquier otra web que la embeba estaría
 * poniendo a sus visitantes a gastar tu cuota de API. Para el panel del
 * portfolio, añade su origen en FRAME_ANCESTORS (separados por espacios o
 * comas):
 *
 *   FRAME_ANCESTORS=https://tudominio.com https://www.tudominio.com
 *
 * Se lee al compilar: cambiarla exige volver a desplegar. Solo se aceptan
 * orígenes http(s) completos; cualquier otra cosa se descarta en lugar de
 * acabar escrita tal cual dentro de la cabecera.
 */
const frameAncestors = [
  "'self'",
  ...(process.env.FRAME_ANCESTORS ?? "")
    .split(/[\s,]+/)
    .filter((origin) => /^https?:\/\/[^\s;,'"]+$/.test(origin)),
].join(" ");

const nextConfig: NextConfig = {
  // Anunciar el framework no le sirve a nadie más que a quien busca versiones
  // vulnerables.
  poweredByHeader: false,

  // Sin el botón "N" de Next abajo a la izquierda en desarrollo: tapaba la
  // esquina del diseño. Los errores de compilación y de ejecución se siguen
  // mostrando igual.
  devIndicators: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors " + frameAncestors,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
