# ImaginarIA

Chat de generación de ideas disruptivas y desbloqueo creativo. Aplicación
autónoma pensada además para embeberse en un portfolio como panel lateral.

No es un asistente genérico: el comportamiento está definido por un system
prompt riguroso que obliga al modelo a desafiar la premisa del usuario, cruzar
disciplinas lejanas y aterrizar en ideas concretas.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Framer Motion ·
Google AI Studio (Gemini) o Groq · Langfuse.

---

## Arquitectura

```
Navegador                    Servidor (Next.js)              Externo
─────────                    ──────────────────              ───────
ChatContainer
  ├─ MessageBubble
  ├─ ChatInput
  └─ useImaginaria ──POST──► app/api/chat/route.ts
       (lee NDJSON)           ├─ rate limit
                              ├─ validación
                              ├─ system prompt ──────────────► Langfuse
                              │                                (prompt mgmt)
                              ├─ lib/ai/provider.ts ─────────► Gemini / Groq
                              │    (SSE → ProviderChunk)        (SSE)
                              └─ traza + flush ──────────────► Langfuse
       ◄──────NDJSON stream───┘
```

Tres decisiones que sostienen el resto:

1. **La clave de API nunca sale del servidor.** El navegador solo habla con
   `/api/chat`. Ninguna variable lleva prefijo `NEXT_PUBLIC_`.
2. **El proveedor está detrás de una interfaz** (`ChatProvider`). Cambiar de
   Gemini a Groq es una variable de entorno, no una refactorización.
3. **La observabilidad es opcional por diseño.** Sin credenciales de Langfuse
   la aplicación funciona idéntica y solo pierde las trazas.

### Mapa de ficheros

| Fichero | Responsabilidad |
| --- | --- |
| `lib/ai/system-prompt.ts` | El system prompt y su versión |
| `lib/ai/provider.ts` | Adaptadores Gemini/Groq + parser SSE |
| `lib/ai/types.ts` | Contratos compartidos cliente/servidor |
| `lib/observability/langfuse.ts` | Trazas y Prompt Management tolerantes a fallo |
| `app/api/chat/route.ts` | Route Handler: valida, limita, traza, hace streaming |
| `components/chat/useImaginaria.ts` | Estado de conversación y lectura del stream |
| `components/chat/ChatContainer.tsx` | Composición, scroll y estado vacío |
| `components/chat/MessageBubble.tsx` | Un turno, con Markdown y cursor de escritura |
| `components/chat/ChatInput.tsx` | Composer autoajustable |
| `components/ImaginariaDrawer.tsx` | Panel lateral para el portfolio |
| `app/globals.css` | Tokens de diseño en variables CSS nativas |

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # rellena GOOGLE_AI_API_KEY o GROQ_API_KEY
npm run dev
```

Comprueba la configuración sin gastar un token:

```bash
curl http://localhost:3000/api/chat
# {"status":"ok","provider":"google","model":"gemini-2.5-flash","tracing":false}
```

`status: "unconfigured"` significa que falta la clave del proveedor; la ruta
`POST` devolverá entonces `503`, no `500`.

> Los identificadores de modelo de ambos proveedores rotan con frecuencia.
> Verifica en la consola correspondiente cuáles están disponibles antes de
> fijar `GEMINI_MODEL` o `GROQ_MODEL`.

---

## El protocolo de streaming

`POST /api/chat` responde `200` con **NDJSON**: un objeto JSON por línea.

```jsonc
{"type":"meta","traceId":"…","model":"gemini-2.5-flash"}
{"type":"delta","text":"**La Grieta.** "}
{"type":"delta","text":"Asumes que…"}
{"type":"done","finishReason":"stop"}
```

Se eligió NDJSON sobre texto plano por un motivo concreto: una vez enviada la
cabecera `200` ya no se puede expresar un fallo con un código HTTP. Un error a
mitad de generación llega como `{"type":"error", …}` y el cliente conserva el
texto parcial en lugar de romperse.

Los errores **previos** al stream sí son códigos HTTP normales: `400`
(validación), `429` (rate limit, con `Retry-After`), `503` (sin configurar).

---

## Integración en el portfolio

### Opción A — despliegues separados (recomendada)

ImaginarIA se despliega como aplicación independiente y el portfolio la carga
en un iframe dentro del panel lateral. Sin acoplar dependencias ni compartir
build.

```tsx
// En el portfolio
import { ImaginariaDrawer } from "@/components/ImaginariaDrawer";

<ImaginariaDrawer src="https://imaginaria.tudominio.com" />;
```

Para que el iframe funcione, añade en `next.config.ts` **de ImaginarIA**:

```ts
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            // Reemplaza el dominio por el de tu portfolio. Es lo que sustituye
            // al antiguo X-Frame-Options y lo único que impide que cualquier
            // web embeba tu chat y consuma tu cuota de API.
            value: "frame-ancestors 'self' https://tudominio.com",
          },
        ],
      },
    ];
  },
};
```

### Opción B — mismo proyecto

Copia `components/`, `lib/` y `app/api/chat/` al portfolio y monta el panel sin
`src`:

```tsx
<ImaginariaDrawer />
```

### Retematizado

Todo el aspecto visual vive en variables CSS con prefijo `--im-`. El sitio
anfitrión puede reescribirlas sin tocar una sola clase:

```css
:root {
  --im-accent: #22d3ee;
  --im-bg: #06121a;
  --im-radius: 0.5rem;
}
```

---

## Langfuse (LLMOps)

Opcional. Con `LANGFUSE_PUBLIC_KEY` y `LANGFUSE_SECRET_KEY` definidas se traza
cada conversación: entrada, salida, modelo, parámetros, tokens y
time-to-first-token. Sin ellas, `getObservability()` devuelve un objeto no-op
con la misma forma y nadie se entera.

Tres detalles de la implementación que evitan los fallos habituales:

- **`flushAsync()` antes de cerrar el stream.** El SDK encola los eventos y los
  envía por lotes; en serverless el proceso se congela al cerrar la respuesta y
  sin el flush las trazas se pierden en silencio. Es el error número uno al
  integrar Langfuse.
- **Import dinámico.** El SDK solo se carga si hay credenciales, para no
  pagarlo en el arranque en frío cuando la observabilidad está desactivada.
- **`sessionId`.** El cliente genera uno por conversación, así los turnos se
  agrupan en el dashboard en lugar de aparecer sueltos.

### Prompt Management

El prompt vive en `lib/ai/system-prompt.ts` y su versión (`SYSTEM_PROMPT_VERSION`)
viaja en cada traza, de modo que una caída de calidad en producción se puede
atribuir a una versión concreta.

Si además creas en Langfuse un prompt de texto llamado `imaginaria-system` con
la etiqueta `production`, `fetchManagedSystemPrompt()` lo servirá y podrás
iterarlo sin redesplegar. Si no existe, falla o Langfuse está caído, se usa el
prompt local. Empieza siempre por el prompt en código: el repositorio sigue
siendo la referencia auditable.

---

## Límites conocidos

- **El rate limiting es en memoria y por instancia.** Frena el abuso trivial,
  pero en serverless el límite efectivo se multiplica por el número de
  instancias y se reinicia en cada arranque en frío. Para un límite real,
  sustituye el mapa de `route.ts` por `@upstash/ratelimit` con Redis.
- **No hay persistencia.** Recargar la página vacía la conversación. Es
  deliberado para una demo de portfolio; añadir historial implica base de datos
  y, con ella, decisiones de privacidad.
- **Sin autenticación.** Cualquiera con la URL consume tu cuota de API. El rate
  limit y la CSP `frame-ancestors` son la única contención.

---

## Scripts

```bash
npm run dev     # desarrollo
npm run build   # build de producción
npm start       # servir el build
npm run lint    # ESLint
```
