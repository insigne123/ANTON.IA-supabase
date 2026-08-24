---
name: form-ux-patterns
description: Mejora formularios con labels claros, validacion util, estados completos y friccion minima.
license: MIT
compatibility: opencode
metadata:
  audience: frontend
---
## Reglas base

- Usa labels visibles; no dependas solo de placeholders.
- Agrupa campos por decision, no por implementacion interna.
- Los errores deben ser especificos y cercanos al campo.
- La accion principal debe ser obvia y mantenerse visible.
- Usa helper text solo cuando reduce dudas reales.

## Estados obligatorios

- default
- focus
- disabled
- loading
- success
- error

## UX

- Prefiere una columna en mobile y formularios simples.
- Evita pedir informacion no necesaria.
- En acciones destructivas, confirma con claridad y tono calmo.
