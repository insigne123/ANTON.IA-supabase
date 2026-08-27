# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Búsqueda de Leads

La busqueda y el enriquecimiento de leads usan FullEnrich. Configura `FULLENRICH_API_KEY` y `ENRICHMENT_SERVICE_SECRET` en los runtimes server-only correspondientes.

## Proveedor de Leads

Las rutas conservan `providerRequested` y `providerUsed` para auditoria. Los valores heredados se normalizan de forma segura a FullEnrich y la respuesta informa `providerUsed: "fullenrich"`.
# Leadflowai-21-11

## UI/UX Workflow

Para trabajo visual, revisar primero:

- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/README.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
