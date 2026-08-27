# Proyecto

La direccion visual por defecto de esta app es Apple-like: claridad, foco, superficies silenciosas y motion sutil.

## UI y UX

- Prioriza una accion principal por superficie.
- Reduce densidad antes de agregar mas cards, badges o texto.
- Reutiliza primero `src/components/ui/*`, tokens y patrones existentes.
- Mantiene light y dark con la misma jerarquia y el mismo nivel de claridad.
- Antes de cerrar una pantalla revisa responsive, focus states, loading states, empty states y contraste.

## OpenCode

- Usa `premium-layout-composer`, `form-ux-patterns`, `empty-states-microcopy`, `component-api-consistency` y `wcag-remediator` cuando aplique.

## Supabase y pruebas

- Usa Node 22 y ejecuta `npm run doctor` antes de diagnosticar el stack local.
- Las pruebas usan `.env.test.local`; nunca cargues `.env.local` en una suite.
- Produccion `yfdelflsheurzaicwayi` es solo lectura. No ejecutes migraciones, seeds ni pruebas contra ese proyecto.
- Nonprod `htketmmhsfmucevvqmxi` admite escrituras solo con peticion explicita y despues de reset, lint, pgTAP e integracion local.
- Prefiere `npm run test:reset` para reconstruir identidades y fixtures sinteticos.

## Limites del estilo Apple-like

- Inspira decisiones en Apple HIG, pero no copies branding, iconografia, tipografias propietarias ni assets de Apple.
- En web, busca una sensacion de system UI y simplicidad, no una imitacion literal.

## Fuentes del repo

- `docs/ui-ux/README.md`
- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
