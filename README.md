# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Búsqueda de Leads

La búsqueda y el enriquecimiento de leads usan Apollo. Configura `APOLLO_API_KEY`, `ENRICHMENT_SERVICE_URL` y `ENRICHMENT_SERVICE_SECRET` para los flujos que corresponda.

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

## Proveedor de Leads

La búsqueda y el enriquecimiento de leads usan Apollo. Configura `APOLLO_API_KEY`, `ENRICHMENT_SERVICE_URL` y `ENRICHMENT_SERVICE_SECRET` para los flujos que corresponda.

Las rutas conservan `providerRequested` y `providerUsed` para auditoría. Los valores heredados de proveedor se normalizan de forma segura a Apollo y la respuesta siempre informa `providerUsed: "apollo"`.
# Leadflowai-21-11

## UI/UX Workflow

Para trabajo visual, revisar primero:

- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/README.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
