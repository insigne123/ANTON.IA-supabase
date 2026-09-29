# Cowork · ver trabajar a Cowork (28 sep 2026)

Segundo PR de la Ola V del plan 2 de Cowork (punto V1): que mientras Cowork trabaja se entienda qué está haciendo, qué encontró y qué viene.

## Qué cambia para el usuario

Mientras Cowork trabaja con un plan, la tarjeta del plan ahora muestra:

- **«Ahora»:** el paso en curso, con las palabras del plan («Reviso tus contactos de RR. HH.…»). Cuando cambia de paso, el texto se reemplaza con un fundido.
- **Una barra de avance** que crece con cada paso terminado.
- **El paso terminado se marca solo:** su check se dibuja al terminar y al lado aparece lo que encontró:
  - «4 contactos», «sin envíos», «8 filas» o «2 fuentes»;
  - los números de más de 9 cuentan hacia su valor; los chicos aparecen de una vez con el chip;
  - si la consulta no deja nada que contar (por ejemplo, métricas), no hay chip.
- **«Siguiente»** junto al paso que viene después del actual.
- **Al terminar,** la tarjeta cierra su espacio y queda la línea de siempre: «Siguió un plan de 3 pasos y hizo 2 consultas». Al abrirla, el plan y las consultas se despliegan, con lo que encontró cada paso.
- **El panel lateral «Progreso»:** cada paso cambia de ícono con una transición, en vez de saltar.

Con «reducir movimiento» del sistema:
- los números aparecen completos;
- el check aparece dibujado;
- la barra y los cambios de paso no se desplazan.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Lo que encontró una consulta, en palabras: número y qué cuenta, o una frase corta | `coworkReadFinding` y `coworkFindingText` en `src/lib/cowork/presentation.ts` |
| Cada paso del plan con lo que encontró su consulta | `found` en `coworkPlanProgress` (mismo archivo) |
| Tarjeta del plan, marcador animado, chip, «Siguiente» y plegado | `src/components/cowork/CoworkActivity.tsx` |
| Número que cuenta hasta su valor, sin anunciar los intermedios | `CwCount` en `src/components/cowork/motion.tsx` |
| Íconos del «Progreso» que cambian con transición | `StepIcon` en `src/components/cowork/CoworkSidePanel.tsx` |

**Accesibilidad:**
- un solo `role="status"` anuncia el paso en curso y cuántos van;
- los chips y el número animado no se leen dos veces: cada paso dice su estado y lo que encontró en texto oculto («hecho: 4 contactos»).

Sin migraciones ni dependencias nuevas: usa `framer-motion` del PR anterior.

## Validación

**Pruebas sin modelo:**
- `presentation.test.ts`: qué encontró cada consulta, en palabras («4 contactos», «sin envíos», «8 filas», «no lo encontró», «2 fuentes»); las métricas no dan chip; cada paso del plan lleva lo que encontró su consulta.
- `verify-cowork` completo en verde, con la prueba de interfaz en jsdom.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local que hace avanzar un turno cada 4 s: plan, contactos, envíos y respuesta):
- **Escritorio claro y oscuro (1440 px) y teléfono (390 px):**
  - al empezar, «Ahora» dice el primer paso, marca el siguiente como «Siguiente» y la barra muestra el avance del paso en curso;
  - al llegar los contactos, el check se dibuja (unos 18 cuadros distintos del trazo), aparece «3 contactos» y el titular pasa al paso siguiente;
  - la barra avanza de 0,12 a 0,45 y luego a 0,78;
  - al llegar los envíos, «sin envíos», y el paso de redactar queda en curso;
  - al terminar, la tarjeta se va y queda «Siguió un plan de 3 pasos y hizo 2 consultas»; al abrirla aparecen el plan con «3 contactos» y «sin envíos», y las consultas;
  - la respuesta aparece;
  - sin errores de página y sin scroll horizontal.
- **Con reducción de movimiento:** los mismos estados, con el check ya dibujado (un solo trazo) y los números completos.
- **Peso:** `/cowork` queda en 242 KB de carga inicial (1 KB más que el PR anterior).
