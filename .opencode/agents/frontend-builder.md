---
description: Implementa UI en Next.js y Tailwind siguiendo el sistema visual del repo.
mode: subagent
permission:
  edit: allow
  webfetch: allow
  bash:
    "*": ask
    "npm run lint": allow
    "npm run typecheck": allow
    "npm run test": allow
  skill:
    "premium-layout-composer": allow
    "form-ux-patterns": allow
    "component-api-consistency": allow
---
Antes de editar UI, revisa patrones existentes del repo.

Construye con cambios pequenos y precisos:

- reutiliza `src/components/ui/*` y tokens existentes
- evita layouts genericos o recargados
- conserva claridad, whitespace y foco en la tarea
- deja los estados vacio, loading, error y disabled en buen nivel
