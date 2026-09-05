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
   Gemini a Groq —o encadenar ambos con failover— es una variable de entorno,
   no una refactorización.
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
# {"status":"ok","provider":"google","model":"gemini-3.7-flash","tracing":false}
```

`status: "unconfigured"` significa que falta la clave del proveedor; la ruta
`POST` devolverá entonces `503`, no `500`.

> Los identificadores de modelo de ambos proveedores rotan con frecuencia y se
> retiran sin aviso: `gemini-2.5-flash` ya devuelve 404 a las claves nuevas.
> Lista los que admite tu clave antes de fijar `GEMINI_MODEL`:
>
> ```bash
> curl -H "x-goog-api-key: $GOOGLE_AI_API_KEY" \
>   https://generativelanguage.googleapis.com/v1beta/models
> ```

### Dos trampas del nivel gratuito de Gemini

**20 peticiones por minuto, y el contador es POR MODELO.** Es la cuota de
`generate_content_free_tier_requests`. Al superarla la API responde `429` y el
chat muestra "Se ha agotado la cuota del modelo". Para una demo pública es el
límite que vas a tocar primero, mucho antes que el de facturación.

Que sea por modelo tiene una consecuencia práctica: cambiar `GEMINI_MODEL`
-de `gemini-3.7-flash` a `gemini-3.1-flash-lite`, por ejemplo- te da un
contador limpio de inmediato, con la misma clave y dentro de los términos.
Sirve para salir del paso, no como estrategia: acabarás agotando los dos.

**Los tokens de razonamiento se descuentan de `AI_MAX_OUTPUT_TOKENS`.** No son
un presupuesto aparte: en una petición típica el modelo gasta entre 500 y 1000
tokens pensando, y esos tokens salen del mismo bolsillo que la respuesta
visible. Con el valor por defecto anterior (1200) las respuestas se cortaban a
media palabra. De ahí que ahora sea 4000. Se facturan aunque nunca se vean, así
que van contabilizados en el coste que reporta Langfuse.

---

## Cadena de proveedores (failover)

`AI_PROVIDER` acepta una lista separada por comas:

```bash
AI_PROVIDER=google,groq
GOOGLE_AI_API_KEY=...
GROQ_API_KEY=...
```

El primero atiende. Si devuelve `429` (cuota agotada) o `5xx` (saturado o
caído), la petición pasa al siguiente **de forma transparente para el
usuario**. Un proveedor sin su clave se omite en silencio, así que añadir un
respaldo es pegar una clave más.

Comprueba la cadena activa sin gastar un token:

```bash
curl http://localhost:3000/api/chat
# {"status":"ok","chain":[{"vendor":"google","model":"gemini-3.7-flash"},
#                         {"vendor":"groq","model":"llama-3.3-70b-versatile"}],
#  "fallback":true,"tracing":true}
```

Tres reglas que hacen que esto sea seguro y no un parche:

- **Solo se cambia de proveedor antes del primer token.** Si el cliente ya está
  leyendo texto, reempezar con otro modelo produciría una respuesta con dos
  comienzos pegados. Emitido un solo carácter, el error se propaga.
- **Solo por fallos de disponibilidad** (`429` y `5xx`). Un `400` o un `404` son
  bugs nuestros —payload mal formado, modelo inexistente— y reintentarlos en
  otro proveedor solo los esconde.
- **La traza registra quién atendió de verdad.** El evento `done` y los
  metadatos de Langfuse llevan el modelo real, no el previsto, para que el
  coste se calcule con la tarifa correcta.

> **Sobre encadenar cuentas del mismo proveedor:** no. Rotar varias cuentas
> gratuitas de Google o Groq para esquivar la cuota infringe sus términos y
> acaba con las claves canceladas. Esta cadena es entre proveedores distintos,
> con una cuenta legítima en cada uno.

### Qué poner en la cadena

Ningún proveedor ofrece una API gratuita sin límites. Estos son los niveles
gratuitos permanentes que compensan como respaldo (**los números cambian y
casi todos los han movido detrás del login de su consola: contrasta antes de
construir sobre ellos**):

| Proveedor | Nivel gratuito | Notas |
| --- | --- | --- |
| **Groq** | ~30 req/min, hasta 14.400/día en modelos pequeños | Rapidísimo. El respaldo más directo: ya está implementado. |
| **Cerebras** | ~30 req/min, ~1M tokens/día | API compatible con OpenAI, implementada aquí. |
| **Google AI Studio** | Publicado solo en tu consola | Es el primario actual. Mira el tuyo en [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit). |
| **Mistral** | Muy generoso en la capa Experiment | Exige aceptar que entrenen con tus datos. Piénsalo si el chat es público. |
| **OpenRouter** | ~20 req/min en los modelos `:free` | Agrega muchos modelos tras una sola clave. |

Para añadir uno compatible con OpenAI que no esté implementado, reutiliza el
adaptador existente apuntándolo a su URL base:

```bash
AI_PROVIDER=google,groq
GROQ_BASE_URL=https://la-pasarela-compatible/v1
```

### La alternativa que probablemente deberías tomar antes

Vincular una cuenta de facturación en Google AI Studio **no tiene gasto mínimo**
y sube los límites de inmediato. Con el coste medido en las trazas de este
proyecto —unos 0,005 $ por respuesta completa con `gemini-3.7-flash`— un
portfolio con 200 conversaciones al mes cuesta alrededor de 1 $, y con
`gemini-3.1-flash-lite` un tercio de eso.

La cadena de failover sigue mereciendo la pena por resiliencia: durante el
desarrollo de este proyecto, `gemini-3.7-flash` devolvió `503` por saturación
varias veces en una misma tarde. Pero como solución al problema de cuota, la
tarjeta es más barata que la complejidad.

---

## El protocolo de streaming

`POST /api/chat` responde `200` con **NDJSON**: un objeto JSON por línea.

```jsonc
{"type":"meta","traceId":"…","model":"gemini-3.7-flash"}
{"type":"delta","text":"Tratas tu landing como si fuera "}
{"type":"delta","text":"un folleto persuasivo cuando…"}
{"type":"done","finishReason":"STOP"}
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

### Prompt Management: Langfuse manda, el repositorio es la red

El system prompt real vive en Langfuse, bajo el nombre `imaginaria-system` y la
etiqueta `production`. La aplicación lo pide en cada petición (con caché de 60s)
y lo usa tal cual. El de [lib/ai/system-prompt.ts](lib/ai/system-prompt.ts) solo
entra si Langfuse no está configurado, no responde a tiempo o no encuentra esa
etiqueta.

Activarlo son dos cosas:

```bash
npm run prompt:publish          # publica el prompt del repo como versión nueva
# y en .env:
LANGFUSE_PROMPT_LABEL=production
```

Sin `LANGFUSE_PROMPT_LABEL` no se consulta siquiera: el SDK escribe su propio
"Prompt not found" en cada petición aunque capturemos el error, y ese ruido
acaba tapando los fallos que importan.

**Cada traza registra de dónde salió el prompt.** En los metadatos verás
`promptSource: "langfuse" | "local"` y `promptVersion` (`lf-3` para la versión 3
de Langfuse, `2.0.0` para la del repositorio). Si un día la calidad cae, lo
primero que quieres saber es qué texto estaba leyendo el modelo. Además, la
generación se enlaza con la versión exacta del prompt, que es lo que habilita
las métricas por versión de Langfuse: latencia, coste y puntuaciones agregadas
por cada iteración.

**Dos formas de iterar, y conviene elegir una:**

- *Desde el repositorio* — editas `system-prompt.ts`, subes
  `SYSTEM_PROMPT_VERSION`, commiteas y lanzas `npm run prompt:publish`. El
  cambio queda revisado y en el historial de git.
- *Desde la interfaz de Langfuse* — cambias el texto y publicas. Está en
  producción en menos de un minuto, sin desplegar. A cambio, el repositorio
  deja de reflejar lo que corre de verdad: tráete el cambio de vuelta.

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
