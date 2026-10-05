# Leads Finder (Apify) como alternativa a Apollo

Plan 11, sección 6. **Objetivo:** probar si la búsqueda por filtros de Apify «Leads Finder» (`code_crafter/leads-finder`) sirve igual que Apollo para «Buscar prospectos».

## Por qué

- **Apollo:** su búsqueda devuelve personas con el apellido oculto, y el correo y el teléfono cuestan créditos al enriquecer.
- **Leads Finder:** devuelve en una sola corrida el nombre completo, el correo (con su estado de validación), el móvil (en planes pagados de Apify), el LinkedIn y unos 20 datos de la empresa. Cuesta desde US$1,50 por 1.000 leads.

## Cómo se ve para el usuario (igual que hoy)

1. **La búsqueda muestra a cada persona como Apollo:**
   - nombre con el apellido oculto («Ana Pé***z»);
   - cargo, empresa y ubicación;
   - marcas «tiene correo» y «tiene teléfono».

   El navegador **nunca** recibe el correo, el teléfono, el correo personal ni el LinkedIn de la persona antes de enriquecer.
2. **Lo que trajo Apify se guarda en el servidor**, cifrado, en `lead_search_vault` (PR 6b): solo `service_role` y vence a los 30 días.
3. **«Enriquecer» toma esos datos de la bóveda**, sin otra consulta externa. Descuenta los mismos créditos que hoy y el lead queda igual que uno enriquecido con Apollo.

## Piezas

- **`src/lib/server/leads-finder/input.ts`** traduce los filtros de la app a la entrada del actor:

  | Filtro de la app | Campo del actor |
  |---|---|
  | cargos | `contact_job_title` |
  | seniority | `seniority_level` (`intern` → `trainee`) |
  | ubicación | `contact_location` (países y las 7 regiones chilenas que conoce el actor) y `contact_city` (ciudades, más la capital de las regiones que no conoce) |
  | tamaño | `size` (todos los tramos que se cruzan con el rango) |
  | industria | `company_industry` (alias en español; lo que no calza va como palabra clave) |
  | palabras | `company_keywords` |
  | sitio web | `company_domain` |

  - Siempre pide `email_status: validated`.
  - Los valores permitidos son una copia del esquema publicado del actor (`actor-enums.ts`). Lo que no calza se avisa en `notApplied`; nunca se envía tal cual, porque Apify rechazaría la corrida.
- **`src/lib/server/leads-finder/client.ts`:**
  - corre el actor con `run-sync-get-dataset-items`, con tope de ítems, de 110 s y de US$0,50 por corrida;
  - el token va en un encabezado;
  - separa cada resultado en `lead` (público) y `contact` (oculto);
  - lee el `error.type` de Apify para saber si la corrida pudo cobrar, igual que Fantastic Jobs.
- **`scripts/compare-lead-providers.ts`:** misma búsqueda en Apollo y en Leads Finder. Mide:
  - cuántos encuentra cada uno;
  - cuántos son las mismas personas (nombre + dominio);
  - correo validado, teléfono y LinkedIn;
  - calce del cargo;
  - empresas distintas;
  - tiempo y costo.

  No imprime correos ni teléfonos. Sin `--live` solo muestra la entrada que recibiría cada proveedor.

## Probarlo

```bash
# Sin red: la entrada que recibiría el actor
node --loader ./scripts/ts-test-loader.mjs scripts/compare-lead-providers.ts
# Real (necesita APOLLO_API_KEY y APIFY_TOKEN en el entorno; nunca en .env del repo)
node --loader ./scripts/ts-test-loader.mjs scripts/compare-lead-providers.ts --live --max=50 --output=comparacion.json
```

## La búsqueda en la app (6c)

Detrás de `LEADS_FINDER_ENABLED=true` y solo para los correos de `LEADS_FINDER_ALLOWED_EMAILS`, separados por coma. Con la lista vacía no entra nadie, y para el resto las rutas responden 404 y la pantalla no cambia.

**En «Buscar prospectos»**, modo «Filtros», aparece «Fuente de los contactos: Apollo · Leads Finder (prueba)». Cada visita empieza en Apollo.

- **Con Leads Finder se buscan personas directo**, con los mismos filtros (cargo, nivel, ubicación, industria, palabras clave y tamaño) y sin el paso de empresas.
- **Un aviso explica la prueba**, lo que no se pudo aplicar y cuántas personas ya estaban guardadas.
- **Los resultados se ven como los de Apollo:**
  - el apellido oculto («Ana Pé***z»; en las listas, «Ana P.»);
  - cargo, empresa y ubicación;
  - «Tiene correo: se ve al buscar su correo».
- **El navegador no recibe** correo, teléfono, correo personal ni LinkedIn de la persona.
- **Volver a Apollo** deja su última búsqueda (empresas y contactos) tal como estaba. Leads Finder no la sobrescribe.

**Guardar y enriquecer**
- Guardar deja a la persona en «Por completar», con `source_provider = leads_finder` y su id `lf_…`.
- **«Buscar correo»** (`POST /api/leads/leads-finder/enrich`) la saca de la bóveda, sin otra llamada a Apify:
  - **Cobro:** el mismo cupo que Apollo (`enrich`, o `investigate` si se pide el teléfono), una vez por persona revelada.
  - **Reintentos:** es idempotente por `Idempotency-Key`; un reintento repite la respuesta sin volver a cobrar.
  - **El resultado:** deja la fila de `enriched_leads` igual que Apollo, con `leads_finder` como proveedor. Solo trae el correo de trabajo, nunca el personal; el teléfono, solo si se pidió.
  - **La bóveda:** borra a la persona revelada.
- **Si el resultado venció** (pasaron más de 30 días), se avisa «búscalo de nuevo» y no se cobra.
- En «Por completar», una misma selección puede mezclar personas de Apollo y de Leads Finder: cada una va a su proveedor.

**Búsqueda** (`POST /api/leads/leads-finder/search`):
- **Cupo:** el mismo cupo diario de búsquedas que Apollo.
- **Tope:** como máximo 100 resultados por búsqueda y `LEADS_FINDER_MAX_RUN_USD` por corrida (US$0,50 por defecto).
- **Orden:** primero guarda el contacto cifrado en la bóveda y después muestra; si la bóveda no responde, no muestra nada que luego no se pueda enriquecer.

**Piezas:**
- `src/lib/server/leads-finder/access.ts`: el flag y la lista.
- `src/lib/server/leads-finder/vault.ts`: la bóveda cifrada; borra lo vencido de la organización al escribir.
- `src/lib/server/leads-finder/reveal.ts`: de la bóveda a la fila enriquecida.
- `src/app/api/leads/leads-finder/{status,search,enrich}/route.ts`.
- `src/lib/leads-finder-client.ts`, `src/app/(app)/search/page.tsx` y `src/app/(app)/saved/leads/page.tsx`.

## Estado

- **6a, el proveedor y la comparación:** en `main`.
- **6b, la bóveda `lead_search_vault`:** en `main`; se aplica en producción aparte.
- **6c, la búsqueda en la app:** apagada hasta que el mantenedor aplique 6b y encienda el flag. Para la prueba, se enciende solo para quien la hace.
