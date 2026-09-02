# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Búsqueda de Leads

La busqueda y el enriquecimiento de leads usan Apollo a traves de un gateway autenticado. Configura `APOLLO_API_KEY` solo en `backend-antonia` y comparte `ENRICHMENT_SERVICE_SECRET` entre el BFF Next y el gateway.

## Proveedor de Leads

Las rutas activas fuerzan Apollo y responden `providerUsed: "apollo"`. Los identificadores de proveedores retirados se conservan unicamente en registros historicos.
# Leadflowai-21-11

## UI/UX Workflow

Para trabajo visual, revisar primero:

- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/README.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
