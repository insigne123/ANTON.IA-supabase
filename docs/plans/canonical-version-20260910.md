# Versión canónica — 10 de septiembre de 2026

## Fuente única

- Aplicación: `C:\Users\nicol\Desktop\ANTON.IA`, repositorio `insigne123/ANTON.IA-supabase`, rama `main`.
- Gateway Apollo: repositorio `insigne123/Backend-leads`, rama `main`, commit `a63bd7d`. Es un servicio complementario; `backend/` en la app es un espejo, no otra aplicación desplegable.
- Publicación app: Firebase `leadflowai-3yjcy`, backend `studio`.
- Publicación gateway: Firebase `backend-apollo-leads-prod`, backend `backend-antonia`.
- No usar exportaciones parciales, ramas release ni worktrees históricos como fuente de desarrollo o despliegue.

## Reconciliación

Se inventariaron 20 worktrees históricos, ramas locales/remotas, cambios sin commit y equivalencias de parches. Base: `4fccafe`, sincronizada con `origin/main`.

| Superficie | Resolución |
| --- | --- |
| Investigación / reportes | Mantener Report V2, preguntas, presupuestos por profundidad, evidencia pública, checkpoints de síntesis y proyección con IDs canónicos de main. El worktree `informe-local-20260910` contiene versiones anteriores; la política de reintento ya está extraída en `research-synthesis-retry-policy.ts`. |
| Narrativa de investigación | `66126c7` es equivalente por parche a contenido integrado en main (`git cherry`), no falta un merge. |
| Borradores | Mantener validación factual, estilos, versiones atómicas y propuestas de reescritura. Recuperar indicaciones personales de `ai-enrichment-reliability`, adaptadas al selector de estilos actual y separadas de instrucciones de campaña. |
| Campañas | Mantener audiencia enriquecida, ranking, perfiles, revisión, historial y editor de secuencias de main; los worktrees bulk son versiones parciales anteriores. |
| Dashboard / administración | Mantener créditos personales y administración de personas/equipos integrados en `ae247ec`, `7d84848`, `e32a198` y `91e7cd5`. |
| Enriquecimiento | Mantener Apollo actual. Las ramas de reemplazo por FullEnrich no se reactivan; sus cambios de proveedor pertenecen a una línea sustituida. El presupuesto CTA antiguo está incorporado en la implementación actual. |
| n8n / migración local | No reintroducir configuración ni supresiones de archivos de builds parciales. Main conserva investigación nativa y migraciones reconciliadas. |
| Búsqueda / extensión / Email Studio | Mantener el conjunto publicado en `91e7cd5`, más espejo gateway `4fccafe`. |

## Respaldo antes de retirar copias

Archivo local fuera del árbol de trabajo:
`C:\Users\nicol\AppData\Local\Temp\opencode\antonia-consolidation-20260910-archive`

Incluye bundle Git de todas las referencias y HEADs detached, 20 archivos tar.gz de los worktrees (con cambios sin commit y archivos no versionados) y manifiesto con SHA-256. Se verificaron el bundle y la lectura de todos los tar. Se excluyeron dependencias y cachés regenerables (`node_modules`, `.next`, `.firebase`, `.cache`) y metadatos `.git`. Es respaldo de recuperación, no una copia de trabajo ni fuente de release. Puede contener configuración local privada; no subirlo a GitHub.

## Validación de la integración

- Node 22; suite principal: 1.204 pruebas aprobadas, cero fallos/skips.
- Compilación Next.js completa, lint y tipos aprobados.
- Chrome con API simulada: campañas y búsqueda por empresas aprobadas.
- Nueva prueba funcional: instrucción directa separada de campaña, longitud máxima e identidad distinta de borrador.
- App consolidada `d729c0c` publicada desde main limpio con `firebase deploy --only apphosting:studio --project leadflowai-3yjcy --non-interactive`. Firebase confirmó rollout completo; backend actualizado a `2026-09-10T16:09:50Z`, `reconciling: false`.
- Verificación HTTP: `/login` 200; `/api/native-drafts` (POST), `/api/campaigns/bulk` y `/api/leads/search/checkpoint` 401 sin sesión; pantalla protegida redirige al login. No equivale a prueba autenticada de proveedores reales. La consulta complementaria de revisión Cloud Run por gcloud no estuvo disponible por autenticación vencida.

## Limpieza completada

- Eliminados los 20 worktrees históricos y sus carpetas, después del respaldo y verificación de HEAD/estado.
- Eliminadas 12 ramas locales alternativas y 7 ramas remotas alternativas de la app.
- `git worktree list`: solo `C:/Users/nicol/Desktop/ANTON.IA` en main.
- `git branch -avv`: solo main, origin/main y el alias origin/HEAD.
- La documentación final se registra en un commit posterior sin cambios de código respecto del artefacto desplegado `d729c0c`.

## Trabajo futuro

Abrir únicamente la carpeta canónica. Antes de editar: `git status --short --branch`, `git fetch origin` y revisar cambios entrantes. Coordinar las IA por archivos; todas integran en main antes de verificar y publicar. El historial Git conserva las versiones anteriores sin mantener ramas o carpetas de trabajo paralelas.
