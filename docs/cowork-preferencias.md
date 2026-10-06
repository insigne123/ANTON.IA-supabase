# Cowork recuerda preferencias (Plan 12, 5)

Cuando el usuario pide que Cowork recuerde algo para los próximos trabajos, Cowork lo propone con una tarjeta. Al aprobarla, lo tiene en cuenta desde el pedido siguiente. Algunos ejemplos:

- «recuerda que no le escribo a empresas de seguridad privada»;
- «de ahora en adelante, en todo el equipo tuteamos a los prospectos».

## Cómo funciona

1. **El coordinador propone `preference.save`** con `preference {text, scope}`.
   - **`text`:** la preferencia en una frase, como se va a recordar.
   - **`scope`:** `personal` u `organization` (solo si dice que vale para su equipo).
2. **El servidor la deja en `suplia_memories` como `proposed`** (`server/cowork/preference.ts`).
   - Ningún turno la lee todavía: `user-context.ts` solo lee las `approved`.
   - Si el turno se reintenta, encuentra la misma memoria y no guarda otra.
3. **La tarjeta** («Recordar preferencia») muestra la frase y para quién vale: «Recordar solo para ti: «…»».
   - Siempre pide revisión humana, incluso en modo autónomo.
4. **Al aprobarla, pasa a `approved`.** El turno siguiente la lee en `memories`, como las demás preferencias aprobadas.
   - **Una personal:** solo la lee su autor.
   - **Una de la organización:** la lee todo el equipo.
   - No abre un turno más: la respuesta de la tarjeta dice qué quedó.

## Las salvaguardas

- **Lo que ya recuerda no se propone de nuevo:** el ciclo lo compara con `memories` y le devuelve la decisión al modelo.
  - Compara las palabras y también el sentido: «ahora sí le escribo a…» es un cambio, no una repetición.
  - Si aun así la respuesta dice que «propone» o que «espera aprobación» sin tarjeta, el ciclo quita esa frase y dice lo cierto: que ya lo tiene presente.
- **Con otra tarea en el mismo pedido,** como «escríbeme un correo… y recuerda que firmo como Nico»:
  - Cowork hace la tarea aplicando ya la preferencia: la Redactora firma «Nico»;
  - y deja la respuesta sugerida «Recordarlo para la próxima».
- **La firma:** la Redactora firma con el nombre que el usuario pidió («firmo como Nico») si lo dice el pedido, el encargo o una preferencia guardada (`coworkSignerPreference`). Antes, la revisión automática lo devolvía al nombre del Perfil.
- **«Esta vez…»** no es una preferencia y no se propone recordarla.

## Para encenderlo

1. **Aplicar la migración `20261006160000_cowork_memory_save_effect.sql`.** Agrega `memory_save` al vocabulario de efectos y no cambia nada más.
2. **Poner `COWORK_PREFERENCES_ENABLED=true`.** Sin el flag, la decisión vuelve al modelo con «todavía no está disponible».

## Medición (6 oct 2026)

Coordinador `gpt-6-luna` con la Redactora; juez `gpt-6-sol`.

| | Resultado |
|---|---|
| `pref-*` (5 casos × 3) | 15 de 15, 138/138 verificaciones |
| Juez de `pref-*` | buena 11, mejorable 2, mala 2. Las dos «mejorable» y una «mala» eran de «ya recordada», que después del último arreglo da buena 3 de 3. La otra «mala» es «esta vez»: propuso buscar prospectos en vez de escribir |
| Uso real (`ur-*`) con el flag encendido en todos | 0 propuestas de recordar en las dos corridas; 168/171 verificaciones con las instrucciones finales (167/171 con las primeras) |

Se mide con:

```bash
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --cases='pref-*' --repeat=3 --output=pref.json
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --preferences --cases='ur-*' --output=ur.json
```
