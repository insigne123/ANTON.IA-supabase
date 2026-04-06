# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Búsqueda de Leads

La búsqueda de leads utiliza un webhook de n8n para orquestar la obtención de datos desde Apollo.io.

### Configuración (n8n - por defecto)

1.  Crea o usa un workflow de n8n que acepte un `POST` con los filtros de búsqueda.
2.  El workflow debe realizar la búsqueda en Apollo y devolver un JSON con la estructura `{ count: number, leads: Lead[] }`.
3.  Copia la URL del webhook de producción de n8n.
4.  Crea un archivo `.env` en la raíz del proyecto y añade la siguiente línea:

```
N8N_LEADS_WEBHOOK_URL="https://tu-workflow.n8n.cloud/webhook/..."
```

Opcionalmente, puedes configurar el timeout y los reintentos:
```
LEADS_N8N_TIMEOUT_MS=60000
LEADS_N8N_MAX_RETRIES=2
```

### Configuración (Apify - Legacy)

Para usar el flujo antiguo basado en Apify (no recomendado):

1.  Establece la variable de entorno `USE_APIFY="true"`.
2.  Ve a tu [Consola de Apify](https://console.apify.com/).
3.  Navega a `Settings` > `Integrations`.
  4.  Copia tu `Personal API token`.
5.  Añade la siguiente línea a tu archivo `.env`:

```
APIFY_TOKEN=tu_token_de_apify
```

**Importante**: El endpoint unificado `/api/leads/search` ahora redirige (307) a `/api/leads/apify` si `USE_APIFY` está activo. El flujo de Apify sigue siendo asíncrono y depende de polling.

## Trial PDL (reemplazo gradual de Apollo)

El backend soporta proveedor dual para búsqueda/enriquecimiento:

- `LEADS_PROVIDER_DEFAULT="apollo|pdl|auto"`
- `ENRICHMENT_PROVIDER_DEFAULT="apollo|pdl|auto"`
- `PDL_TRIAL_ENABLED=true|false`
- `PDL_ALLOWED_ORG_IDS="org_uuid_1,org_uuid_2"`
- `PDL_FALLBACK_TO_APOLLO=true|false`

Con esta combinación puedes habilitar PDL solo para una organización (allowlist) y mantener Apollo para el resto.

### Probar por API

Las respuestas incluyen metadatos de proveedor para auditoría:

- `providerRequested`
- `providerUsed`
- `fallbackApplied`
- `fallbackReason`

Ejemplo de búsqueda principal (`/api/leads/search`) forzando PDL:

```bash
curl -X POST "http://localhost:9003/api/leads/search" \
  -H "Content-Type: application/json" \
  -H "x-user-id: <USER_UUID>" \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>" \
  -d '[{
    "industry_keywords": ["technology"],
    "company_location": ["chile"],
    "employee_ranges": ["11-50"],
    "titles": "CEO,Founder",
    "provider": "pdl",
    "max_results": 50
  }]'
```

Ejemplo de oportunidades (`/api/opportunities/leads-apollo`) con proveedor PDL:

```bash
curl -X POST "http://localhost:9003/api/opportunities/leads-apollo" \
  -H "Content-Type: application/json" \
  -b "<cookie_de_sesion>" \
  -d '{
    "companyNames": ["Acme"],
    "personTitles": ["CTO"],
    "personLocations": ["Chile"],
    "perPage": 25,
    "maxPages": 2,
    "provider": "pdl"
  }'
```

Ejemplo de enriquecimiento (`/api/opportunities/enrich-apollo`) con PDL:

```bash
curl -X POST "http://localhost:9003/api/opportunities/enrich-apollo" \
  -H "Content-Type: application/json" \
  -H "x-user-id: <USER_UUID>" \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>" \
  -d '{
    "provider": "pdl",
    "revealEmail": true,
    "revealPhone": false,
    "tableName": "enriched_leads",
    "leads": [{
      "fullName": "Jane Doe",
      "companyName": "Acme",
      "linkedinUrl": "https://www.linkedin.com/in/janedoe"
    }]
  }'
```

Rollback inmediato: `PDL_TRIAL_ENABLED=false` o quitar la org de `PDL_ALLOWED_ORG_IDS`.
# Leadflowai-21-11

## UI/UX Workflow

Para trabajo visual, revisar primero:

- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/README.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
