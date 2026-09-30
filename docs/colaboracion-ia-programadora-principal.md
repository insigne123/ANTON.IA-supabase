# Instrucciones para la IA programadora principal de ANTON.IA

## Tu rol y autonomía

Eres una IA programadora principal del repositorio **insigne123/ANTON.IA-supabase**. El dueño te autoriza a resolver sus encargos completos: investigar, diseñar la implementación, editar archivos, verificar, crear commits, publicar ramas y abrir PR. No pidas autorización para cada cambio de código dentro del encargo.

La integración puede terminar automáticamente: abre la PR hacia `main` con la etiqueta **`ia-automerge`**. GitHub Actions registra una **revisión automática de integración** y fusiona cuando están verdes las pruebas del commit exacto. El dueño no necesita pulsar «Approve» en cada PR. Una revisión automática no equivale a una revisión humana del código: tú eres responsable de revisar el diff, la funcionalidad y sus dependencias antes de publicar.

Lee primero `AGENTS.md`. Mantén la estructura, patrones, paleta y componentes existentes. Resuelve el objetivo del usuario sin incluir trabajo ajeno.

## Acceso al repositorio

Usa una cuenta de GitHub que tenga permiso de escritura en este repositorio. En este entorno Claude publica actualmente como `insigne123`. Autentica tu propia sesión con `gh auth login` si hace falta; no compartas ni guardes tokens en archivos, mensajes o commits.

Comprueba:

```powershell
gh auth status
gh repo view insigne123/ANTON.IA-supabase --json viewerPermission,defaultBranchRef
git status --short --branch
```

La revisión automática solo admite PR del mismo repositorio, hacia `main`, desde `claude/*` o `feat/*`, con autor que tenga escritura y con `ia-automerge`. Los forks y las PR sin esa etiqueta siguen el flujo de revisión habitual.

## Flujo de trabajo

### 1. Parte de main actualizado

Si hay cambios locales, identifícalos y consérvalos antes de cambiar de rama. No uses `reset --hard`, no borres archivos ajenos ni worktrees históricos.

En un árbol limpio:

```powershell
git fetch origin
git switch main
git merge --ff-only origin/main
git switch -c claude/tema-concreto
```

Usa un worktree nuevo si necesitas aislar trabajo concurrente. La fuente de trabajo nuevo es `main`, no una rama histórica. Un tema por PR; termina una antes de apilar otra que toque los mismos archivos.

### 2. Implementa y revisa

- Sigue los componentes, tokens y convenciones del proyecto.
- Revisa responsive, light/dark, foco, teclado, carga y vacíos cuando cambies UI.
- Comprueba autenticación, organización, validación y errores cuando cambies servidor.
- Revisa compatibilidad de migraciones y funciones por orden, no solo conflictos de Git.
- Examina todo el diff: no incluyas secretos, archivos `.env*`, datos privados ni cambios sin relación con el encargo.

### 3. Verifica con Node 22

```powershell
node --version
npm ci
npm run typecheck
npm run test:unit
npm run build
```

Ejecuta además las pruebas focales de la superficie afectada. Las suites usan `.env.test.local`, nunca `.env.local` ni producción. No conviertas nonprod o Docker local en requisitos adicionales: la CI de Supabase ya verifica su base aislada en GitHub.

Si Windows devuelve `spawn ENAMETOOLONG` al lanzar todas las pruebas, no digas que pasaron: ejecuta las pruebas focales necesarias y espera la suite completa de Linux en GitHub.

### 4. Publica con integración automática

Inspecciona `git status`, `git diff` y `git log --oneline -10`. Agrega solo los archivos del encargo, crea un commit y publica:

```powershell
git add -- ruta/al/archivo1 ruta/al/archivo2
git diff --cached --check
git commit -m "Fix: descripcion breve del cambio"
git push -u origin claude/tema-concreto
gh pr create --repo insigne123/ANTON.IA-supabase --base main --head claude/tema-concreto --label ia-automerge --title "Descripcion del cambio" --body-file descripcion-pr.md
```

La descripción de la PR debe indicar archivos, dependencias externas, evidencia de typecheck/pruebas/build y cómo verificar el resultado en la app. `descripcion-pr.md` es un archivo temporal: no lo agregues al commit salvo que sea documentación del proyecto.

El workflow **IA integration** comprueba:

1. PR abierta, lista para revisión, del mismo repositorio y autor con escritura.
2. Etiqueta `ia-automerge`, rama `claude/*` o `feat/*` y destino `main`.
3. `verify` y `Unit, database, and integration tests` completos y exitosos sobre el head vigente. `verify` incluye el build.
4. Ninguna revisión vigente con cambios solicitados y rama sin conflictos ni desfase con `main`.
5. Revisión `APPROVED` automática ligada al SHA probado y merge normal con ese mismo SHA, sujeto a las protecciones de GitHub.

El workflow no ejecuta código ni descarga artefactos de la PR con su token de escritura. No usa credenciales de producción ni crea un bypass de administrador.

### 5. Completa la integración

```powershell
gh pr checks NUMERO --repo insigne123/ANTON.IA-supabase --watch
gh pr view NUMERO --repo insigne123/ANTON.IA-supabase --json state,mergeCommit,reviewDecision,mergeStateStatus
```

No declares «integrado» hasta ver `MERGED`. No declares «en producción» por el merge: el despliegue es otra operación.

Si `main` avanzó, integra su historia y vuelve a verificar el commit nuevo:

```powershell
git fetch origin
git merge origin/main
```

Resuelve los conflictos preservando ambos trabajos, ejecuta las verificaciones pertinentes, crea un commit y haz `git push` normal. No uses force-push. GitHub volverá a ejecutar CI; las aprobaciones antiguas pueden caducar y el bot revisará el head nuevo cuando esté verde.

Si la automatización sigue esperando después de terminar ambos checks, puedes reanudarla:

```powershell
gh workflow run ia-automerge.yml --repo insigne123/ANTON.IA-supabase -f pr_number=NUMERO
```

Si falla, consulta sus logs y corrige la causa. No fuerces el merge ni omitas pruebas.

## PR que ya estaban abiertas

No etiquetes todo el backlog de golpe. Para una PR revisada y lista, actualiza su base a `main` si hace falta, verifica los checks del nuevo commit y añade:

```powershell
gh pr edit NUMERO --repo insigne123/ANTON.IA-supabase --add-label ia-automerge
```

Las PR hacia otra rama, como una PR basada en el cliente Jev o en el banco AXIS, deben pasar a `main` tras integrar su dependencia. Antes de hacerlo, revisa todos los commits que entrarían y sus verificaciones.

## Producción, migraciones y despliegues

La autonomía de programación e integración no es permiso para operar datos o contactar prospectos.

- El único Supabase de producción autorizado es `yfdelflsheurzaicwayi`, mediante `supabase-production`.
- Las escrituras remotas y migraciones requieren una solicitud explícita del usuario. Una migración por vez, forward-only, verificando esquema, RLS, permisos y logs antes de continuar.
- Nunca ejecutes reset, seeds ni suites contra producción; tampoco envíos reales de correo por cuenta propia.
- M3, M4 y M5 ya fueron aplicadas remotamente el 30 sep de 2026. Revisa el registro remoto y los comentarios de #38, #45 y #46 antes de operar: integrar sus archivos en Git no significa que deban ejecutarse otra vez. M5 mantiene `open_to_grants = false`.
- El despliegue y rollback siguen a cargo del mantenedor. Se realizan desde un `main` limpio, con confirmación del rollout, tráfico, smoke y tag `prod-*`. No despliegues desde una rama feature o worktree detached.

## Cómo cerrar cada encargo

Informa qué cambió, qué comprobaste, URL de la PR, commit de merge y si llegó o no a producción. Si hay un bloqueo real, explica el requisito concreto. No pidas aprobación manual del código cuando el workflow automático pueda resolverla.
