<div align="center">

# 💡 ImaginarIA

### El colega con el que piensas en voz alta

**No te da la respuesta obvia. Te discute la premisa.**

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Langfuse](https://img.shields.io/badge/Langfuse-LLMOps-0A0A0A?style=flat-square)](https://langfuse.com)
[![CI](https://github.com/Adriiiii24/imaginaria/actions/workflows/ci.yml/badge.svg)](https://github.com/Adriiiii24/imaginaria/actions/workflows/ci.yml)

</div>

---

## ✨ Qué es esto

Un chat que **construye ideas contigo**, turno a turno, hasta cerrarlas. Sirve
igual para desatascar una novela en el capítulo dos que para ponerle nombre a
tu perro. 🐕

No es un asistente genérico. El comportamiento está definido por un system
prompt riguroso que le obliga a:

| | |
|---|---|
| 🎯 | **Un movimiento por turno.** Nada de ensayos: 30-70 palabras y te devuelve la pelota |
| 🔪 | **Cuestionar la premisa** que das por buena sin darte cuenta |
| 🌍 | **Cruzar disciplinas lejanas** — de la piroecología al derecho procesal |
| 🤝 | **Llevarte la contraria** cuando toca. Un colega que asiente a todo no ayuda |

> *«La palabra "diferente" es una trampa. ¿Y si la cafetería no gira en torno
> al café, sino al tiempo? ¿Te ves gestionando un espacio o prefieres que la
> diferenciación vaya por el producto?»*

---

## 🎨 El diseño

Azul eléctrico a página completa, **cuatro figuras geométricas flotando** y el
chat en el centro sobre una lámina de cristal ahumado. Dentro, todo es cómic:
bocadillos de papel con trazo grueso, sombra dura y cola. 💬

```
🔴 círculo   🔺 triángulo   🟨 cuadrado   🟩 rombo
```

**Un botón en la cabecera pasa el azul de figura en figura.** Cada pulsación:
el fondo toma el color de la figura que toca, esa figura se queda el azul, y la
anterior vuelve al suyo. A la quinta se cierra el ciclo. 🔄

Todo el reparto de colores salió de medir contraste sobre `#0007FF`:

| Color | Contraste | Uso |
|---|---|---|
| ⬜ Blanco | `8.49:1` | ✅ Texto |
| 🟡 Amarillo | `6.25:1` | ✅ Acento y acción |
| 🟢 Verde | `6.37:1` | 🔸 Solo figura |
| 🟣 Magenta | `3.08:1` | 🔸 Solo decoración |
| 🔴 Coral | `2.73:1` | ❌ **Nunca** texto |

Y con el fondo girando, el cristal es **azul casi negro y no blanco**: un velo
claro sobre la figura amarilla dejaría el texto en 2:1. Medido sobre los cinco
estados renderizados, el peor caso es `8.09:1`. 📏

> 🎨 **Retematizable:** todo vive en variables CSS con prefijo `--im-`. El
> portfolio que lo embeba puede reescribirlas sin tocar una sola clase.

---

## 🚀 Puesta en marcha

```bash
npm install
cp .env.example .env.local   # 🔑 pega GOOGLE_AI_API_KEY o GROQ_API_KEY
npm run dev
```

Comprueba la configuración **sin gastar un token**:

```bash
curl http://localhost:3000/api/chat
```
```json
{"status":"ok","chain":[{"vendor":"groq","model":"openai/gpt-oss-120b"}],
 "fallback":false,"tracing":true}
```

`"unconfigured"` significa que falta la clave, y `problem` dice cuál; el `POST`
devolverá `503`, no `500`, con un mensaje para el visitante (el detalle técnico
va al log, no a la pantalla). ✅

> ⚠️ **Los identificadores de modelo se retiran sin aviso.** `gemini-2.5-flash`
> ya devuelve `404` a las claves nuevas, y `llama-3.3-70b-versatile` desapareció
> de Groq. Lista los que admite tu clave antes de fijar nada:
>
> ```bash
> curl -H "x-goog-api-key: $GOOGLE_AI_API_KEY" \
>   https://generativelanguage.googleapis.com/v1beta/models
> ```

---

## 🆓 Dos trampas del nivel gratuito de Gemini

### ⏱️ 20 peticiones por minuto — y el contador es **por modelo**

Es la cuota de `generate_content_free_tier_requests`. Al superarla la API
responde `429`. Para una demo pública es el límite que tocarás primero, mucho
antes que el de facturación.

Que sea por modelo tiene truco: cambiar `GEMINI_MODEL` te da un contador limpio
al instante, con la misma clave y dentro de los términos. **Sirve para salir del
paso, no como estrategia** — acabarás agotando los dos. 🙃

### 🧠 Los tokens de razonamiento salen de `AI_MAX_OUTPUT_TOKENS`

No son un presupuesto aparte. En una petición típica el modelo gasta **500-1000
tokens pensando**, del mismo bolsillo que la respuesta visible. Con el valor
anterior (1200) las respuestas se cortaban a media palabra. Por eso ahora son
4000. Se facturan aunque nunca se vean, así que van contabilizados en el coste
que reporta Langfuse. 💸

### 💳 La alternativa que probablemente deberías tomar antes

Vincular facturación en Google AI Studio **no tiene gasto mínimo** y sube los
límites de inmediato. Con el coste medido en las trazas de este proyecto —unos
**0,005 $ por respuesta**— un portfolio con 200 conversaciones al mes cuesta
**~1 $**.

La tarjeta es más barata que la complejidad. 🤷

---

## 🔌 Cadena de proveedores (failover)

`AI_PROVIDER` acepta una lista separada por comas:

```bash
AI_PROVIDER=groq,google
GROQ_API_KEY=...
GOOGLE_AI_API_KEY=...
```

El primero atiende. Si devuelve `429` o `5xx`, no contesta en 20 segundos o
cierra el stream sin decir una palabra, la petición **pasa al siguiente sin que
el usuario se entere**. Un proveedor sin clave se omite en silencio, así que
añadir respaldo es pegar una clave más. 🔗

**Cuatro reglas que lo hacen seguro y no un parche:**

- 🚦 **Solo se cambia antes del primer token.** Si el cliente ya lee texto,
  reempezar produciría una respuesta con dos comienzos pegados.
- 🎯 **Solo por indisponibilidad** (`429`, `5xx`, timeout) **o silencio**
  (respuesta vacía: filtro de seguridad, tokens agotados razonando). Un `400` o
  `404` es bug nuestro y reintentarlo en otro proveedor solo lo esconde.
- ⏳ **Nada de esperas largas con el usuario delante.** Un `503` se reintenta
  contra el mismo proveedor con backoff, pero si pide un `Retry-After` de más de
  4 segundos se cede el turno al siguiente.
- 📝 **La traza registra quién atendió de verdad**, no quién se preveía, para
  que el coste se calcule con la tarifa correcta. Y quién falló antes
  (`failovers` en los metadatos): un principal que vive agotado no pasa
  desapercibido detrás de un respaldo que contesta bien.

### 🧩 Qué poner en la cadena

Ningún proveedor ofrece una API gratuita sin límites. **Ninguno.** Estos son los
niveles gratuitos permanentes que compensan:

| Proveedor | Nivel gratuito | Notas |
|---|---|---|
| ⚡ **Groq** | ~30 req/min, hasta 14.400/día | Rapidísimo. El respaldo más directo — ya implementado |
| 🧬 **Cerebras** | ~30 req/min, ~1M tokens/día | Compatible con OpenAI — ya implementado |
| 🔵 **Google AI Studio** | Solo en tu consola | [Mira el tuyo](https://aistudio.google.com/rate-limit) |
| 🟠 **Mistral** | Muy generoso (capa Experiment) | ⚠️ Exige aceptar que entrenen con tus datos |
| 🌐 **OpenRouter** | ~20 req/min en modelos `:free` | Muchos modelos tras una clave |

> 📌 Los números cambian y casi todos los han movido detrás del login. Contrasta
> antes de construir sobre ellos.

> 🚫 **Sobre rotar cuentas del mismo proveedor:** no. Infringe sus términos y
> acaba con las claves canceladas. Esta cadena es entre proveedores **distintos**,
> con una cuenta legítima en cada uno.

---

## 📡 El protocolo de streaming

`POST /api/chat` responde `200` con **NDJSON** — un objeto JSON por línea:

```jsonc
{"type":"meta","traceId":"…","model":"openai/gpt-oss-120b"}
{"type":"delta","text":"La palabra \"diferente\" "}
{"type":"delta","text":"es una trampa…"}
{"type":"done","finishReason":"stop","vendor":"groq"}
```

¿Por qué NDJSON y no texto plano? Porque **una vez enviada la cabecera `200` ya
no puedes expresar un fallo con un código HTTP**. Un error a mitad de generación
llega como `{"type":"error"}` y el cliente conserva el texto parcial en lugar de
romperse. 🛟

Los errores **previos** al stream sí son códigos normales: `400` (validación),
`413` (cuerpo de más de 256 KB), `429` (rate limit, con `Retry-After`), `503`
(sin configurar).

Y un stream que se cierra sin `done` ni `error` —la plataforma mató la función
en `maxDuration`, se cayó la red— el cliente lo trata como **respuesta
cortada** y ofrece reintentar, en lugar de darla por buena. ✂️

### 🪟 Qué ve el modelo

El historial viaja entero en cada turno, así que se acota: los últimos **40
mensajes y 24.000 caracteres**. Una conversación más larga no se rechaza —antes
devolvía `400` y se quedaba bloqueada—: sigue, y el modelo deja de ver lo más
antiguo. Por el camino se descartan los turnos vacíos (una respuesta detenida
antes del primer token) y se funden dos turnos seguidos del mismo rol (un
mensaje que falló y el siguiente), que algunos proveedores rechazan.

---

## 📊 Langfuse (LLMOps)

Opcional. Con las dos claves definidas se traza cada conversación: entrada,
salida, modelo, parámetros, tokens y time-to-first-token. **Sin ellas la
aplicación funciona idéntica** y solo pierde las trazas. 🎛️

Tres detalles que evitan los fallos habituales:

- 🚿 **Flush con `after()`, después de cerrar la respuesta.** El SDK encola
  eventos; en serverless el proceso se congela al cerrar la respuesta y sin
  flush las trazas se pierden **en silencio** (el error nº 1 al integrar
  Langfuse). Pero vaciar *antes* de cerrar dejaba al usuario esperando la ida y
  vuelta a Langfuse con la respuesta ya completa. `after()` lo hace después, y
  en Vercel mantiene viva la función con `waitUntil`; donde no existe, se vacía
  en línea como antes.
- 🐢 **Import dinámico.** El SDK solo se carga si hay credenciales, para no
  pagarlo en el arranque en frío.
- 🧵 **`sessionId`.** Uno por conversación, así los turnos se agrupan en el
  dashboard en vez de aparecer sueltos.

### 👍 Valoraciones: la otra mitad de la traza

Cada respuesta lleva dos pulgares junto a la firma. El voto va a
`POST /api/feedback` y queda como score `user-feedback` (`BOOLEAN`) en la traza
de esa respuesta, con un id estable: cambiar de opinión **sustituye** el voto,
no lo suma.

Como cada generación está enlazada a su versión del prompt, Langfuse agrega los
votos **por versión**. «¿La 3.0.0 ayuda más que la 2.0.0?» deja de ser una
impresión y pasa a ser un dato. 📈

Sin trazas no hay pulgares: la respuesta no trae `traceId` y no habría a qué
enlazar el voto. Copiar la respuesta, en cambio, está siempre.

### 📝 Prompt Management: Langfuse manda, el repo es la red

El system prompt real vive en Langfuse (`imaginaria-system`, etiqueta
`production`). El de [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) solo
entra si Langfuse no responde, no está configurado o no encuentra la etiqueta.

```bash
npm run prompt:publish               # 📤 publica el prompt del repo, si ha cambiado
npm run prompt:publish -- --dry-run  # 👀 dice qué publicaría, sin tocar nada
# y en .env:
LANGFUSE_PROMPT_LABEL=production
```

Es **idempotente**: si la etiqueta ya apunta a ese mismo texto, no crea una
versión gemela. Relanzarlo «por si acaso» ya no ensucia el historial de
versiones ni reparte las métricas entre copias idénticas.

**Cada traza registra de dónde salió el prompt:** `promptSource` y
`promptVersion` (`lf-3` para Langfuse, `3.0.0` para el repo). Si un día la
calidad cae, lo primero que quieres saber es qué texto leía el modelo. 🔍

**Dos formas de iterar — elige una:**

| | Ventaja | Coste |
|---|---|---|
| 📦 **Desde el repo** | Queda revisado y en el historial de git | Requiere desplegar |
| 🖥️ **Desde la UI de Langfuse** | En producción en menos de un minuto | El repo deja de reflejar lo que corre |

---

## 🧩 Integración en el portfolio

### Opción A — despliegues separados *(recomendada)*

```tsx
import { ImaginariaDrawer } from "@/components/ImaginariaDrawer";

<ImaginariaDrawer src="https://imaginaria.tudominio.com" />;
```

⚠️ Para que el iframe funcione, declara el origen del portfolio en el
despliegue **de ImaginarIA**:

```bash
FRAME_ANCESTORS=https://tudominio.com https://www.tudominio.com
```

Por defecto solo el propio origen puede embeber la app (`frame-ancestors
'self'`, ya configurado en [`next.config.ts`](next.config.ts)). 🔒 Es lo que
impide que cualquier web meta tu chat en un iframe y te consuma la cuota de API.
Se lee al compilar: cambiarla exige redesplegar.

### Opción B — mismo proyecto

Copia `components/`, `lib/` y `app/api/chat/`, y monta el panel sin `src`:

```tsx
<ImaginariaDrawer />
```

---

## 🗺️ Mapa de ficheros

**🧠 Cerebro**

| Fichero | Responsabilidad |
|---|---|
| [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) | El system prompt y su versión |
| [`lib/ai/provider.ts`](lib/ai/provider.ts) | Adaptadores Gemini / OpenAI-compatibles + parser SSE + failover |
| [`lib/ai/types.ts`](lib/ai/types.ts) | Contratos compartidos cliente ↔ servidor |
| [`lib/observability/langfuse.ts`](lib/observability/langfuse.ts) | Trazas y Prompt Management tolerantes a fallo |
| [`app/api/chat/route.ts`](app/api/chat/route.ts) | Valida, limita, traza y hace streaming |
| [`app/api/feedback/route.ts`](app/api/feedback/route.ts) | Valoraciones → scores de Langfuse |
| [`lib/chat/history.ts`](lib/chat/history.ts) | Ventana de historial: qué ve el modelo |
| [`lib/chat/validate.ts`](lib/chat/validate.ts) | Validación de los cuerpos de la API |
| [`lib/rate-limit.ts`](lib/rate-limit.ts) | Rate limiting en memoria |
| [`lib/http.ts`](lib/http.ts) | Cuerpo con tope de bytes, errores y `after()` |

**💬 Chat**

| Fichero | Responsabilidad |
|---|---|
| [`components/chat/useImaginaria.ts`](components/chat/useImaginaria.ts) | Estado de conversación: enviar, detener, reintentar, valorar |
| [`lib/chat/stream-client.ts`](lib/chat/stream-client.ts) | Lectura del NDJSON en el navegador, cortes incluidos |
| [`components/chat/ChatContainer.tsx`](components/chat/ChatContainer.tsx) | Composición, scroll y estado vacío |
| [`components/chat/MessageBubble.tsx`](components/chat/MessageBubble.tsx) | Un turno, como bocadillo de cómic, con copiar y valorar |
| [`components/chat/ChatInput.tsx`](components/chat/ChatInput.tsx) | Composer autoajustable, con tope y `Esc` para detener |
| [`lib/suggestions.ts`](lib/suggestions.ts) | Repertorio de ideas, 4 sorteadas por visita |

**🎨 Aspecto**

| Fichero | Responsabilidad |
|---|---|
| [`app/globals.css`](app/globals.css) | Tokens de diseño, cristal, figuras y lenguaje cómic |
| [`components/BackgroundShapes.tsx`](components/BackgroundShapes.tsx) | Las cuatro figuras flotantes (CSS puro, sin JS) |
| [`components/palette.tsx`](components/palette.tsx) | Rotación de la paleta |
| [`components/BrandMark.tsx`](components/BrandMark.tsx) | La marca, dibujada con las mismas figuras |
| [`components/ImaginariaDrawer.tsx`](components/ImaginariaDrawer.tsx) | Panel lateral para el portfolio |

**🧪 Calidad**

| Fichero | Responsabilidad |
|---|---|
| [`__tests__/`](__tests__/) | Vitest: streaming, failover, validación y el hook del chat, con proveedores y Langfuse simulados. Ni un token gastado: un `fetch` sin simular falla en vez de salir a la red |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Lint, tipos, tests y build en cada push |

---

## ⚠️ Límites conocidos

| | |
|---|---|
| 🧯 | **Rate limiting en memoria y por instancia.** Frena el abuso trivial, pero en serverless el límite efectivo se multiplica por instancias. Para algo real: `@upstash/ratelimit` con Redis |
| 💾 | **Sin persistencia.** Recargar vacía la conversación. Deliberado para una demo; añadir historial implica base de datos y decisiones de privacidad |
| 🪟 | **Memoria acotada.** El modelo ve los últimos 40 mensajes / 24.000 caracteres. Una conversación más larga sigue, pero olvida el principio |
| 🔓 | **Sin autenticación.** Cualquiera con la URL consume tu cuota. El rate limit y la CSP son la única contención |

---

## 📜 Scripts

```bash
npm run dev              # 🔧 desarrollo
npm run build            # 📦 build de producción
npm start                # ▶️  servir el build
npm run lint             # 🧹 ESLint
npm run typecheck        # 🔍 tipos (genera antes los de las rutas)
npm test                 # 🧪 tests, una pasada
npm run test:watch       # 👀 tests en modo watch
npm run prompt:publish   # 📤 publicar el prompt en Langfuse
```

<div align="center">

---

Hecho con demasiadas iteraciones del prompt 🔁

</div>
