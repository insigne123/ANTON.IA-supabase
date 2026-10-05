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

## Estado

- **6a, el proveedor y la comparación:** sin pantalla ni efecto en producción.
- **6b, la bóveda `lead_search_vault`:** migración aparte.
- **6c, el selector en «Buscar prospectos»:** detrás de `LEADS_FINDER_ENABLED` y solo para `LEADS_FINDER_ALLOWED_EMAILS`.
