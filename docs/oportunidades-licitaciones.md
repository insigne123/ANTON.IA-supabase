# Licitaciones y Compra Ágil (Plan 8, fase 3, PR-3d)

## Qué hace

La página «Oportunidades» suma la pestaña «Licitaciones y Compra Ágil»: compras públicas abiertas que nombran lo que ofrece la organización, con su calce de 0 a 100, el organismo, el monto y el plazo.

Hay una sincronización diaria a las 08:15 de Chile (11:15 UTC):
- trae las licitaciones;
- trae los avisos de Google for Jobs (JSearch) de las empresas contratando.

## Fuentes (gratis, con el ticket de Mercado Público de cada persona)

| Fuente | Archivo | Cómo se consulta |
|---|---|---|
| Licitaciones de Mercado Público, API v1 | `src/lib/server/commercial-opportunities/mercado-publico.ts` | `licitaciones.json?estado=activas` en una consulta. Después, el detalle (`codigo=`) de las abiertas cuyo nombre dice una palabra completa, con cierre más cercano primero y hasta 40. Las que ya están guardadas con su detalle no se vuelven a pedir |
| Compra Ágil, API v2 (beta desde mayo de 2026) | `src/lib/server/commercial-opportunities/compra-agil.ts` | `GET https://api2.mercadopublico.cl/v2/compra-agil` por la palabra más distintiva de cada frase (`q`), publicadas en las últimas dos semanas, 20 por página. El ticket va en el encabezado `ticket` |

**Una consulta a la vez (Plan 10).** Primero Mercado Público y después Compra Ágil, con 0,5 s entre consultas:
- dos consultas simultáneas con el mismo ticket reciben HTTP 429 con `Codigo 10500` («peticiones simultáneas»);
- ese código se espera y se reintenta a los 2, 5 y 10 s, y nunca se presenta como cuota diaria.

**Lo que se midió en la API el 5 oct 2026:**
- Compra Ágil busca cualquiera de las palabras: «servicios transitorios» trajo 538 resultados, todos de «servicios».
- Las frases con «de» responden 500. Por eso se pregunta por la palabra más distintiva («selección de personal» → «selección») y `matchTender` se queda con lo que dice la frase completa.
- 50 por página pasa el límite de 29 s del gateway (504). Con 20 por página responde en unos 15 s.
- 5xx, 429 y timeouts se reintentan a los 2 y 5 s. Si falla la página 2, se conserva la 1.

**Tiempo máximo de 140 s** por búsqueda (la ruta manual tiene 180):
- los detalles se cortan a la mitad del tiempo;
- lo pendiente queda para la próxima búsqueda, con el aviso «N detalles quedan para la próxima búsqueda»;
- las palabras de Compra Ágil cambian de orden cada día.

**El ticket (Plan 10):**
- cada persona conecta el suyo en Oportunidades;
- se guarda cifrado (`token-crypto`, `enc:v1`) en `commercial_opportunity_tickets`, una tabla que solo lee el servidor;
- la página solo recibe los últimos 4 caracteres y la fecha de verificación;
- el `MERCADO_PUBLICO_TICKET` global de Secret Manager queda solo para las cuentas confirmadas de `MERCADO_PUBLICO_SHARED_TICKET_EMAILS` (`apphosting.yaml`).

**Cómo se consigue** (verificado en chilecompra.cl/api el 5 oct 2026):
1. En chilecompra.cl/api, «Pide tu ticket».
2. Aceptar los términos de uso e iniciar sesión con Clave Única.
3. Completar el formulario con nombre, RUT y correo, y elegir «Solicitud de Ticket».
4. El código llega al correo. Es un ticket por persona, con 10.000 consultas al día.

**Qué ticket se usa:**
- **«Buscar licitaciones»:** el de quien pulsa (el propio, o el compartido si está en la lista). Sin ticket, responde 409 y pide conectarlo.
- **La búsqueda diaria:** el ticket propio de quien creó «Qué buscamos»; si no tiene, el ticket verificado más reciente de otro miembro con acceso a Oportunidades; si nadie tiene, el compartido, solo si quien creó el perfil está en su lista. Sin ninguno, las dos fuentes quedan como omitidas, sin costo, con «Nadie de la organización ha conectado su ticket de Mercado Público».
- **Un ticket propio que Mercado Público rechaza** queda marcado: la página pide reemplazarlo y la búsqueda diaria deja de usarlo.

**Al probarlo** (`PUT /api/commercial-opportunities/ticket`):
- se hace una sola consulta liviana: `codigo=1000-1-L126`, un código bien formado que no existe, que con un ticket válido responde 200 con el listado vacío;
- un ticket desconocido responde HTTP 203 con `Codigo 203`;
- un 10500 cuenta como ticket válido, porque solo un ticket real tiene consultas en curso.

**En la URL:** la API v1 recibe el ticket en la dirección, así que la URL nunca se registra ni va en un mensaje de error. Tampoco el mensaje de la API, que puede repetirlo.

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
- **Con el ticket de un miembro** (ver «Qué ticket se usa»): licitaciones y Compra Ágil. Sin ninguno, quedan omitidas con el motivo.
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
  - el ticket solo en el encabezado de Compra Ágil, 20 por página;
  - 500, 504 y timeout reintentados, y la página 1 conservada;
  - la palabra distintiva de cada frase;
  - 203, 10500 y cuota distinguidos, sin el ticket en los errores.
- **`src/lib/server/commercial-opportunities/tender-sync.test.ts`:**
  - Mercado Público y después Compra Ágil, con el detalle solo de las candidatas;
  - el 10500 reintentado, y un ticket que sigue ocupado deja el resto para la próxima;
  - un detalle guardado no se pide de nuevo ni se borra;
  - palabra completa, cierre más cercano y tope de 40;
  - el tiempo máximo;
  - sin ticket o sin palabras, no parte; si guardar falla, se cierran las dos búsquedas.
- **`src/lib/server/commercial-opportunities/tickets.test.ts`:**
  - el formato del ticket y su pista;
  - el compartido solo para la lista;
  - propio, compartido o ninguno, y la página sin el ticket;
  - guardado cifrado, rechazo y borrado;
  - el ticket de la búsqueda diaria por organización;
  - la prueba liviana del ticket.
- **`src/lib/server/commercial-opportunities/daily.test.ts`:** el plan diario, la búsqueda con el ticket de un miembro, las omitidas sin ticket y el ticket rechazado.
