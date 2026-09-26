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

- Usa Node 22. Ejecuta `npm run doctor` solo cuando el problema dependa del stack local.
- Las pruebas usan `.env.test.local`; nunca cargues `.env.local` en una suite.
- Produccion `yfdelflsheurzaicwayi` es el destino principal. Usa el MCP `supabase-production`, limitado a ese project ref.
- Escribe en produccion solo con solicitud explicita del usuario. No uses nonprod ni Docker como gates obligatorios salvo que el usuario los pida.
- Antes de escribir, revisa el SQL y ejecuta las validaciones proporcionales disponibles. No repitas suites ya aprobadas si el cambio posterior no afecta su superficie.
- Aplica una sola migracion pequena y forward-only por vez. Verifica inmediatamente esquema, RLS y logs antes de continuar con app, Functions o feature flags.
- Nunca ejecutes `reset`, seeds ni suites de prueba contra produccion.
- Si falta autenticacion del MCP, usa `opencode mcp auth supabase-production`; nunca guardes tokens en el repositorio.

## Git y releases

- `main` es la unica rama canonica para integrar, verificar y desplegar cambios.
- `main` esta protegida: todo cambio entra por PR desde ramas `claude/*` o `feat/*`, con 1 revision y CI en verde. Sin push directo, sin force-push, sin borrar ramas.
- Inicia todo cambio desde `main`; no abras ramas `release/*` ni despliegues desde worktrees detached.
- Usa un worktree temporal solo para aislar trabajo concurrente. Antes de verificar o desplegar, integra el resultado probado de vuelta en `main`.
- No borres ramas o worktrees historicos sin una solicitud explicita; nunca deben ser fuente de cambios nuevos ni de un despliegue.
- Antes de actualizar `main`, revisa `git status`, `git diff`, la historia entrante y las pruebas pertinentes.
- Cada deploy bueno se etiqueta `prod-YYYY-MM-DD`. Rollback: `git revert` del cambio + redeploy + smoke (`/api/onboarding/tour` 401, `/cowork` 200, `POST /api/cowork/wake` 401).

## Colaboracion externa (Claude)

- Trabaja en ramas `claude/<tema>`, un tema por PR, PRs chicos, siempre desde `main` al dia.
- Cada PR describe: archivos tocados, dependencias fuera del PR, evidencia de `typecheck` + `test:unit` + `build` en verde y como verificarlo en la app.
- Si tu base no es este `main`, dilo en el PR y lista que asumiste como base.
- Prohibido: secretos o tokens en codigo, logs o issues; archivos `.env*`; migraciones sin solicitud explicita; escrituras en produccion; envios reales de correo; force-push; borrar ramas; deployar (el deploy lo hace el mantenedor tras el merge).
- Las pruebas usan `.env.test.local`; jamas `.env.local` en una suite ni credenciales en el repo.
- El deploy a produccion y el rollback los ejecuta el mantenedor. Punto de retorno: ultimo tag `prod-*`.

## Limites del estilo Apple-like

- Inspira decisiones en Apple HIG, pero no copies branding, iconografia, tipografias propietarias ni assets de Apple.
- En web, busca una sensacion de system UI y simplicidad, no una imitacion literal.

## Fuentes del repo

- `docs/ui-ux/README.md`
- `docs/ui-ux/apple-inspired-methodology.md`
- `docs/ui-ux/visual-system.md`
- `docs/ui-ux/reference-workflow.md`
- `docs/ui-ux/release-audit-checklist.md`
