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
- Produccion `yfdelflsheurzaicwayi` admite migraciones solo con solicitud explicita del usuario y un release preparado.
- Antes de escribir en produccion: completar reset, lint, pgTAP e integracion local; validar nonprod; revisar el dry-run; y confirmar backup o ventana de cambio.
- En produccion usa solo migraciones pequenas, forward-only y una familia de tablas por vez. Verifica esquema, RLS y logs antes de activar un feature flag o ampliar el rollout.
- Nunca ejecutes `reset`, seeds ni suites de prueba contra produccion.
- Nonprod `htketmmhsfmucevvqmxi` admite escrituras solo con peticion explicita y despues de reset, lint, pgTAP e integracion local.
- Prefiere `npm run test:reset` para reconstruir identidades y fixtures sinteticos.

## Git y releases

- `main` es la unica rama canonica para integrar, verificar y desplegar cambios.
- Inicia todo cambio desde `main`; no abras ramas `release/*` ni despliegues desde worktrees detached.
- Usa un worktree temporal solo para aislar trabajo concurrente. Antes de verificar o desplegar, integra el resultado probado de vuelta en `main`.
- No borres ramas o worktrees historicos sin una solicitud explicita; nunca deben ser fuente de cambios nuevos ni de un despliegue.
- Antes de actualizar `main`, revisa `git status`, `git diff`, la historia entrante y las pruebas pertinentes.

## Limites del estilo Apple-like

- Inspira decisiones en Apple HIG, pero no copies branding, iconografia, tipografias propietarias ni assets de Apple.
- En web, busca una sensacion de system UI y simplicidad, no una imitacion literal.

## Fuentes del repo

- `docs/ui-ux/README.md`
- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
