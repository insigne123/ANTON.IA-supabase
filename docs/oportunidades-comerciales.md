# Oportunidades comerciales (Plan 8, fase 3)

## Qué es

Además de buscar personas, la app busca oportunidades:
- **empresas que están contratando:** avisos de empleo agrupados por empresa;
- **licitaciones públicas:** Mercado Público y Compra Ágil;
- **proyectos de inversión:** SEIA.

**Piloto:**
- primero para GrupoExpro (servicios transitorios, outsourcing, selección y nómina);
- la sección la ve solo la cuenta del piloto: `OPPORTUNITIES_ALLOWED_EMAILS`, comprobado en el servidor.

## La sección es nueva

La sección «Oportunidades» anterior no sirve de base:
- gira en torno a un aviso de LinkedIn: buscar avisos y después, a mano, empresas y personas;
- es por usuario, sin organización y de una sola fuente;
- está apagada desde nov 2025.

Sus tablas (`opportunities` y `enriched_opportunities`) quedan como están.

**Lo nuevo:**
- gira en torno a la empresa y la oportunidad;
- varias fuentes, actualizadas a diario;
- un puntaje según la oferta y sus motivos;
- estados y Cowork.

## Tablas (PR-3a)

Migración `supabase/migrations/20261002170000_commercial_opportunities.sql`, aditiva:

| Tabla | Qué guarda |
|---|---|
| `commercial_opportunity_profiles` | Qué buscar: la oferta, cargos, regiones, mínimo de avisos, palabras clave, códigos UNSPSC, sectores del SEIA, inversión mínima y fuentes activas |
| `commercial_opportunities` | Una fila por empresa que contrata, licitación o proyecto: tipo, clave única por organización y tipo, empresa o comprador, región, monto, plazo, enlace, puntaje y motivos, estado (nueva, interesa, descartada o convertida) y quién la tomó |
| `commercial_opportunity_signals` | La evidencia de cada una: un aviso, una licitación o un proyecto, con fuente, id externo único, título, lugar, portal, fecha y enlace |
| `commercial_opportunity_runs` | Cada búsqueda o sincronización: fuente, lo traído, lo nuevo, el costo estimado y el error. De aquí sale el tope mensual |

**Acceso:**
- RLS encendido en las cuatro tablas;
- los miembros no tienen permisos: solo el servidor lee y escribe, después de comprobar el correo;
- abrir la sección al equipo es cambiar la lista de correos, sin migrar.

**Datos:**
- solo de empresas: del aviso no se guarda al reclutador;
- el crudo de cada fuente va recortado (16 KB por oportunidad y 8 KB por señal).

## Fuentes

| Señal | Fuente | Costo |
|---|---|---|
| Empresas contratando | JSearch (principal) y LinkedIn Job Search API de Fantastic Jobs | JSearch: gratis hasta 200 consultas al mes, luego US$25 al mes por 10.000. Fantastic Jobs en Apify: US$5 por 1.000 avisos en los planes gratis y Bronze, 3,5 en Silver y 1,5 desde Gold |
| Licitaciones | Mercado Público y Compra Ágil (oficiales) | Gratis, con ticket |
| Proyectos | SEIA (oficial): el archivo exportado del mapa, subido cada mes (`docs/oportunidades-proyectos.md`) | Gratis |
| Decisores y datos de la empresa | Apollo (ya integrado) | Los créditos de siempre, con el costo visible antes |

- **Jooble queda de reserva:** solo si JSearch no cubre bien Chile.
- **LinkedIn lo recolecta el proveedor, sin cuenta ni sesión.** No arriesga la cuenta de nadie, pero puede cortarse: por eso es una fuente más, y reemplazable.

### Evaluación de las herramientas propuestas (2 oct 2026)

**Se usan:**

| Herramienta | Decisión |
|---|---|
| JSearch (RapidAPI) | **Principal.** Avisos de Google for Jobs con `country=cl`: empresa, sitio, portal, fecha y enlace |
| LinkedIn Job Search API de Fantastic Jobs | **Para LinkedIn.** Base actualizada cada hora, con dotación, industria, tamaño y sede de la empresa, y un filtro que saca a las agencias de empleo. Por Apify, con `APIFY_TOKEN` |
| `curious_coder/linkedin-jobs-scraper` (Apify) | **De reserva.** 98,5 % de corridas OK, US$1 a 2 por 1.000. Raspa en vivo: el cambio del buscador de LinkedIn de agosto de 2026 le quitó filtros |

**No se usan:**

| Herramienta | Por qué no |
|---|---|
| `cheap_scraper/linkedin-job-scraper` (Apify) | Hace lo mismo que el de reserva, con menos uso y peor valoración (4,1 de 5) |
| Búsqueda en LinkedIn API (Zyla) | US$49,99 al mes por 5.000 consultas, sin filtro de país ni fuente declarada |
| JOA (Zyla) | Avisos de sistemas de postulación, fuertes en Europa; US$0,065 por consulta |
| JobScout (Zyla) | No documenta Chile; JSearch cubre lo mismo |
| Real-Time LinkedIn Scraper (RapidAPI) | Datos de personas, no oportunidades |
| AeroLeads (Pipedream) | Busca correos y teléfonos; para eso está Apollo |
| `harvestapi/linkedin-profile-scraper` (Apify) | Perfiles de personas, no oportunidades |
| `code_crafter/leads-finder` (Apify) | Origen de datos no declarado, 3,5 de 5 en 546 reseñas. La Ley 21.719 (vigente desde dic 2026) pide origen claro |
| `pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe` (Apify) | 3,0 de 5 y origen poco claro |

## Orden

1. **PR-3a:** las tablas (este documento).
2. **PR-3b:** fuentes de «contratando», agrupación por empresa, puntaje y medición con las claves.
3. **PR-3c:** la página nueva, con el acceso por correo.
4. **PR-3d:** Mercado Público, Compra Ágil y la sincronización diaria.
5. **PR-3e:** proyectos SEIA.
6. **PR-3f:** Cowork lee las oportunidades (`docs/oportunidades-cowork.md`).
7. **PR-3g:** retirar la sección vieja, con visto bueno.

## Lo que necesita el mantenedor

- **Clave de RapidAPI suscrita a JSearch** (`JSEARCH_API_KEY`): crearla en Secret Manager y declararla en `apphosting.yaml`.
- **`APIFY_TOKEN`:** hoy no está declarado en `apphosting.yaml`. Hay que declararlo como secreto para que la app use Fantastic Jobs.
- **Ticket de Mercado Público:** desde el Plan 10, cada persona conecta el suyo en Oportunidades, gratis en chilecompra.cl/api con Clave Única. El `MERCADO_PUBLICO_TICKET` de Secret Manager queda solo para las cuentas de `MERCADO_PUBLICO_SHARED_TICKET_EMAILS`. Lo usan licitaciones y Compra Ágil (`docs/oportunidades-licitaciones.md`).
- **Deploy de las funciones programadas** para la sincronización diaria (`commercialOpportunitiesTick`).
- **Un tope de gasto mensual en Apify,** que paga Fantastic Jobs. La app además se detiene en `OPPORTUNITIES_MONTHLY_USD_CAP`.
- **`OPPORTUNITIES_ALLOWED_EMAILS`:** ya va en `apphosting.yaml` con el PR-3c; ver `docs/oportunidades-pagina.md`.
