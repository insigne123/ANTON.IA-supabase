---
name: component-api-consistency
description: Mantiene consistencia en props, variantes, slots y composicion de componentes del design system.
license: MIT
compatibility: opencode
metadata:
  audience: frontend
---
## Reglas

- Reutiliza nombres conocidos como `variant`, `size`, `className` y `asChild` cuando encajen.
- No inventes props nuevas si el comportamiento puede expresarse con una variante existente.
- Mantiene estados y variantes alineados entre componentes similares.
- Si el repo ya usa CVA o wrappers de shadcn, sigue ese patron.
- La API debe ser facil de adivinar sin leer toda la implementacion.

## Revision

- nombres consistentes
- defaults razonables
- slots claros
- estados disabled, loading, error y active cuando apliquen
