# Plan 13, segunda ronda: Cowork hace en vez de ofrecer (7 oct 2026)

Continúa el Plan 13 (`docs/cowork-plan13-final.md`) con el mismo objetivo del dueño: que Cowork se comporte como
Claude Cowork, sea proactivo, razone bien y se use como un chat de IA de toda la vida.

Seis PR, sin migraciones ni flags nuevos:

| PR | Qué cambia para el usuario |
|---|---|
| #228 Títulos automáticos | Cada conversación recibe un nombre corto («Leads de selección en retail») en vez del primer mensaje cortado. Un nombre que el usuario puso siempre manda. |
| #229 Hace en vez de ofrecer | Cowork deja de cerrar con «¿Te muestro…?» o «¿Reviso…?»: hace la consulta, o quita la oferta y deja las sugerencias. El resumen de contactos ya no se rechaza por «falta el argumento». |
| #230 Correo a un grupo | Mejorar un correo «Estimados Marcela, Romualdo y Verónica» entrega un mejor correo para ese grupo, no una plantilla de campaña con «{{nombre}}». |
| #231 Chat sin llamada extra | Una respuesta de chat que ya trae sugerencias no paga otra llamada al modelo para agregar una pregunta que las repetía. |
| #232 Juez con los hechos del producto | Solo medición: el juez ya no marca como inventados el cupo diario de búsquedas, la guía «¿Qué puedes hacer?» ni la extensión de LinkedIn. |
| #233 Atajos de teclado | ⌘⇧O nueva conversación, ⌘K buscar conversaciones, ⌘/ ver los atajos (Ctrl en Windows), y escribir sin estar en un campo va directo al mensaje. |

## Medición

Todo con `gpt-6-luna` y el estado de la cuenta, igual que en producción; el juez usa `gpt-6.1-sol` y no se usó astra.
Cada comparación usa el mismo corpus en ambos brazos.

**#229, hace en vez de ofrecer** (`ur-*` y `chat-*`, 27 casos × 2):
- Respuestas que terminan ofreciendo una consulta: 5 → 0.
- Rechazos por «falta el argumento»: 4 → 0.
- Checks: 466 → 466 de 476.
- En los 8 casos con más ofertas (× 3): ofertas 4 → 0 y casos OK 21 → 23 de 24.
- Juez (27 respuestas por brazo): fricción 4,26 → 4,52 y «mala» 5 → 2. Las cuatro «mala» por ofrecer una consulta desaparecen.

**#230, correo a un grupo** (`ur-mejorar-correo` × 5): casos OK 0/5 → 5/5.

**#231, chat sin llamada extra** (`ur-*` y `chat-*`, 27 casos × 2, sobre #229):
- Casos OK: 47 → 52 de 54.
- Checks: 467 → 474 de 476.
- Llamadas al modelo: 129 → 108.
- Tiempo por caso P50: 10,5 → 8,9 s.
- Juez: todas las dimensiones igual o mejor. Utilidad 4,33 → 4,48, claridad 4,52 → 4,67 y «mala» 4 → 3.

**#232, juez con los hechos del producto** (las mismas 27 respuestas, juez anterior → actual):
- Veracidad: 4,44 → 4,59.
- Respuestas con quejas falsas sobre esos hechos: 3 → 0.
- Las demás dimensiones quedan dentro del ruido.

**Descartado: sugerencias que no repiten lo ya pedido.** Medido sobre 199 respuestas con sugerencias, el filtro habría
quitado una sola, que además era la única sugerencia de su respuesta. No se publicó.

## Para el mantenedor

1. **Desplegar `main`** como siempre, con su tag `prod-AAAA-MM-DD`. No hay migraciones ni variables nuevas.
2. **Pruebas de humo** habituales:
   - `/api/onboarding/tour` debe responder 401;
   - `/cowork` debe responder 200;
   - `POST /api/cowork/wake` debe responder 401.
3. **Qué mirar en producción**:
   - **Títulos**: las conversaciones nuevas muestran un nombre corto después del primer turno.
   - **Feedback**: el 👎 con motivo «Poco útil» o «No hizo lo que pedí» en `cowork_run_events` (`kind = 'answer.feedback'`). Debería bajar el que se refiere a preguntas de más.
4. **Rollback**: `git revert` del PR, redeploy y pruebas de humo. Ninguno deja datos que limpiar.
   - #228 solo agrega `memory.title` a la memoria que ya se guardaba, y es opcional.

## Lo que queda

- **Tareas largas (4c)**: requiere una migración que el dueño debe autorizar.
- **«Otra versión» del primer mensaje** sigue sin ‹ 1/2 ›. Necesita guardar el vínculo entre la conversación nueva y la anterior, es decir, una migración.
- **Casos que siguen débiles por razonamiento**, no por forma:
  - `ur-invitar-semana`: no puede saber quién tiene LinkedIn y propone preparar a todos.
  - `ur-tarea-larga`: a veces pide elegir los 10 mejores en vez de elegirlos.
