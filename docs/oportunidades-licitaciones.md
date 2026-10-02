# Licitaciones y Compra Ágil (Plan 8, fase 3, PR-3d)

## Qué hace

La página «Oportunidades» suma la pestaña «Licitaciones y Compra Ágil»: compras públicas abiertas que nombran lo que ofrece la organización, con su calce de 0 a 100, el organismo, el monto y el plazo.

Hay una sincronización diaria a las 08:15 de Chile (11:15 UTC):
- trae las licitaciones;
- trae los avisos de Google for Jobs (JSearch) de las empresas contratando.

## Fuentes (gratis, con `MERCADO_PUBLICO_TICKET`)

| Fuente | Archivo | Cómo se consulta |
|---|---|---|
| Compra Ágil, API v2 (beta desde mayo de 2026) | `src/lib/server/commercial-opportunities/compra-agil.ts` | `GET https://api2.mercadopublico.cl/v2/compra-agil` por palabra clave (`q`), publicadas en las últimas dos semanas, 2 páginas de 50. El ticket va en el encabezado `ticket` |
| Licitaciones de Mercado Público, API v1 | `src/lib/server/commercial-opportunities/mercado-publico.ts` | `licitaciones.json?estado=activas` en una consulta. Después, el detalle (`codigo=`) solo de las que nombran una palabra, hasta 40 |

**El ticket es el mismo para las dos:**
- se pide gratis en chilecompra.cl/api con Clave Única;
- tiene una cuota diaria: Compra Ágil responde 429 al agotarla; Mercado Público permite 10.000 consultas al día.

**Al agotarse la cuota o rechazarse el ticket,** la búsqueda deja de consultar esa fuente y lo registra.

**En la URL:** la API v1 recibe el ticket en la dirección, así que la URL nunca se registra ni va en un mensaje de error.

**Del comprador se guardan solo el organismo y su unidad,** nunca el funcionario que publicó.

## Cómo calza (`src/lib/commercial-opportunities/tenders.ts`)

Una compra calza cuando una palabra de la búsqueda está en su nombre, su descripción o sus productos, o cuando un producto tiene un código UNSPSC de la búsqueda. Un código corto incluye a toda su familia (801116 incluye 80111600).

Las cerradas, desiertas o con plazo vencido nunca calzan.

| Qué | Puntos |
|---|---|
| La palabra está en el nombre | 45 |
| La palabra está solo en la descripción o los productos | 30 |
| Un producto tiene un código UNSPSC de la búsqueda | 20 |
| Monto: 50 millones o más, 10 millones o más, o informado | 15, 10 o 5 |
| Plazo: 5 días o más, o 2 días o más | 10 o 5 |
| Región del perfil | 10 |

**Palabras del piloto** (`GRUPOEXPRO_TENDER_KEYWORDS`, editables en «Editar búsqueda»):
- suministro de personal, servicios transitorios, personal transitorio y personal de reemplazo;
- outsourcing, externalización, contact center y call center;
- reclutamiento, selección de personal y remuneraciones.

## Guardado

- **Una fila por compra** en `commercial_opportunities`:
  - tipo `tender` (licitación) o `compra_agil`;
  - la clave es su código.
- **La evidencia** va en `commercial_opportunity_signals`, con fuente `mercado_publico` o `compra_agil`.
- **El estado y el dueño** («Me interesa», «Descartar») nunca se pisan.
- **La lista muestra solo las abiertas,** por calce y luego por el plazo más cercano.
- **Enlace:** la licitación enlaza a su ficha de Mercado Público. Compra Ágil no tiene un enlace público estable que se pueda citar, así que la tarjeta copia su código.

## Sincronización diaria

**Disparo:**
- `commercialOpportunitiesTick` en `functions/index.ts` llama a `POST /api/cron/commercial-opportunities` con el secreto del programador;
- el mismo patrón que las demás tareas (`docs/deployment.md`).

**Para cada organización con un perfil de búsqueda activo:**
- **Con `MERCADO_PUBLICO_TICKET`:** licitaciones y Compra Ágil.
- **Con `JSEARCH_API_KEY`:** avisos de Google for Jobs, dentro del tope mensual de gasto.
- **LinkedIn queda en «Buscar ahora»,** donde la persona ve su costo antes.

## Pruebas

- **`src/lib/commercial-opportunities/tenders.test.ts`:**
  - las dos fuentes en la misma forma, sin el funcionario;
  - la fecha chilena;
  - el calce por nombre, texto o código;
  - las vencidas y cerradas fuera;
  - filas y evidencia, y el enlace solo de licitación.
- **`src/lib/server/commercial-opportunities/tender-clients.test.ts`:**
  - el ticket solo en el encabezado de Compra Ágil;
  - la paginación;
  - la cuota;
  - los errores de Mercado Público sin el ticket, aunque la API responda 200.
- **`src/lib/server/commercial-opportunities/tender-sync.test.ts`:**
  - el detalle solo de las candidatas;
  - lo nuevo y lo actualizado por fuente;
  - la cuota agotada detiene Compra Ágil sin detener Mercado Público;
  - sin ticket o sin palabras, no parte;
  - si guardar falla, se cierran las dos búsquedas;
  - el plan diario, una vez por organización.
