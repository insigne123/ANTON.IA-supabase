---
name: wcag-remediator
description: Corrige problemas comunes de accesibilidad en contraste, labels, foco, teclado y semantica.
license: MIT
compatibility: opencode
metadata:
  audience: frontend
---
## Checklist

- labels visibles y asociadas
- headings en orden logico
- focus visible y consistente
- navegacion por teclado sin trampas
- contraste suficiente en texto, bordes y controles
- hit targets utilizables
- respeto por `prefers-reduced-motion`

## Reglas

- usa semantica nativa antes que aria extra
- no conviertas `div` en boton si un `button` resuelve el caso
- dialogs, sheets y popovers deben manejar foco correctamente
- el estado disabled debe seguir siendo entendible visualmente
