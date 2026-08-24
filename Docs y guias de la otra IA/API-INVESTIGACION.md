# APIs de Investigación (grupo 2) — cómo funcionan y cómo dejarlas listas

Las skills de investigación (competitor-analysis, brand-research, brand-monitor, similarweb-traffic y domain-research) se apoyan en estas APIs externas. Acá va **qué hace cada una, cómo se autentica, qué devuelve, cuánto cuesta y su estado**. Todas quedan **cableadas y listas** en las tools `research.*`: solo agregas la key (si la necesita) y llamas la función — devuelve datos con la forma del artifact `company_research`, así que se pintan solos en el UI.

## Resumen

| API | Para qué | Key | Estado | Costo |
|---|---|---|---|---|
| **SimilarWeb** | Tráfico, fuentes, países, keywords | ❌ no necesita | ✅ **lista al tiro** | Gratis (endpoint no oficial) |
| **domaindetails (WHOIS)** | Dueño, fechas, disponibilidad de dominio | ❌ no necesita | ✅ **lista al tiro** | Gratis |
| **Brand.dev** | Info de marca, logos (brand-research) y menciones (brand-monitor) | ✅ `BRANDDEV_API_KEY` | ⏳ requiere key | Plan con free tier |
| **SerpAPI** | SERP de Google en vivo: menciones, noticias, competidores y hiring signals | ✅ `SERPAPI_API_KEY` / `SERP_API_KEY` / `SERPAPI_KEY` | ⏳ requiere key | Pago por búsqueda |

> **Lo más rentable para ti:** empieza con **SimilarWeb + WHOIS** (gratis, cero setup). Agrega **Brand.dev** para identidad de marca y **SerpAPI** para señales públicas premium cuando quieras investigar noticias, competidores, menciones o contratación.

---

## Detalle por API

### SimilarWeb — tráfico (sin key) ✅
- **Cómo funciona:** llama al endpoint público que usa su extensión de navegador: `GET https://data.similarweb.com/api/v1/data?domain=<dominio>` con un `user-agent` de navegador. Sin auth.
- **Devuelve:** visitas/mes, rank global y de categoría, rebote, páginas/visita, tendencia mensual, **fuentes de tráfico** (directo/búsqueda/social/…), **países top** y **keywords top**.
- **Función:** `fetchSimilarweb(domain)` → `{ raw, report }`.
- **Ojo:** es un endpoint **no oficial**; puede limitar por volumen o cambiar sin aviso. Para producción a escala, considera su API oficial (de pago) o cachear.

### domaindetails — WHOIS (sin key) ✅
- **Cómo funciona:** `GET https://mcp.domaindetails.com/lookup/{dominio}` (sin auth). Marketplace: `https://api.domaindetails.com/api/marketplace/search?domain=`.
- **Devuelve:** registrar, fechas de creación/expiración, disponibilidad.
- **Función:** `fetchWhois(domain)`.

### Brand.dev — marca y menciones ⏳
- **Auth:** header `Authorization: Bearer ${BRANDDEV_API_KEY}`. Base `https://api.brand.dev/v1/`. Key en https://brand.dev/
- **Endpoints:** `GET /brand/retrieve?domain=` (info+logos), `GET /brand/search?query=&sort=date` (menciones), `GET /brand/info?domain=`, `GET /logo/search`.
- **Devuelve:** nombre, descripción, industria, logos; o lista de menciones con fuente/fecha.
- **Funciones:** `fetchBrand(domain)` y `fetchBrandMentions(query)`.

### SerpAPI — señales públicas premium ⏳
- **Auth:** key en la query: `api_key=${SERPAPI_API_KEY}`. Base `https://serpapi.com/search.json`.
- **Endpoints lógicos:** `research.brand_mentions`, `research.serp_company_news`, `research.serp_competitors`, `research.serp_jobs_signals`.
- **Devuelve:** resultados orgánicos/noticias, fuente, fecha, snippet, preguntas relacionadas y metadatos de búsqueda.
- **Función base:** `researchSerp(input, context, kind)`. Cobra por búsqueda; siempre debe ir detrás de aprobación.
- competitor-analysis es **orquestación**: combina SimilarWeb/WHOIS como señales gratis y SerpAPI para competidores públicos.

---

## Cómo usarlas en tu backend

En `server.js` (o tu `/api/chat`), importa el módulo y emite el resultado como artifact:

```js
const R = require('./suplia-research-tools');

// dentro del flujo del asistente, cuando toca "investigar":
const report = await R.researchSimilarweb({ domain: 'andina-seg.cl' }, context);     // sin key
res.write(JSON.stringify({ type:'artifact', id:'research', kind:'report',
  title:'Investigación: Seguridad Andina', subtitle:'Tráfico + señales',
  data: report }) + '\n');
```

Como cada función ya devuelve una ficha normalizada, **no tienes que transformar demasiado**. Para combinar varias fuentes (tráfico + marca + WHOIS) en una sola ficha, junta sus resultados:

```js
const traffic = await R.researchSimilarweb({ domain: dom }, context);
const brand = await R.researchBrand({ domain: dom }, context);
const data = { title:`Investigación — ${dom}`, sources:[traffic, brand] };
```

## Prueba rápida (sin key)

```bash
node research-apis.js similarweb andina-seg.cl
node research-apis.js whois andina-seg.cl
```

## Notas
- Pon las keys en `.env` / variables de entorno; **nunca** en el frontend.
- SimilarWeb y WHOIS son endpoints públicos no oficiales: úsalos con respeto (rate limit, cache) y revisa términos para uso comercial intensivo.
- Como ya tienes **Apollo** y **CRM interno** propios, no necesitas HubSpot ni Resend; estas APIs son solo la capa de *investigación* que enriquece tus fichas.
