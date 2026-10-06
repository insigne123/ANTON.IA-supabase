# Plan 13: Cowork como asistente personal (6 oct 2026)

Objetivo del dueño: «que se comporte y comunique como Claude Cowork, que sea inteligente y proactivo, que razone
correctamente y que le sea sencillo al usuario usarlo como un chat IA de toda la vida».

Seis PR integrados en `main` y uno con este documento. Ninguno tiene migraciones. Solo uno tiene flag (`COWORK_WORKSPACE_ENABLED`).

| PR | Qué cambia para el usuario |
|---|---|
| #222 Cowork conversa como un colega | Sabe el estado de tu cuenta en cada turno, avisa una vez de lo que no se te puede pasar («Por cierto, Marcela pidió una reunión hace 4 días»), ajusta el largo a lo que pediste, reconoce errores en una frase, dice con respeto lo que no conviene y responde preguntas generales de ventas sin consultar. |
| #220 Gestos de chat | Editar tu último mensaje, «Otra versión», ‹ 1/2 › entre versiones, 👍/👎 con motivo. |
| #224 «Otra versión» sabe qué falló | La nueva versión recibe las anteriores y el 👎 con su motivo; el 👎 de un turno da forma al siguiente. |
| #223 Panel con el plan real | «Progreso» es el plan del turno como lista de tareas con lo que encontró cada paso; menos ruido (cupo solo si quedan ≤10); «Nueva conversación» en vez de «Nuevo trabajo». |
| #221 Lo que Cowork recuerda | Ver y olvidar (con confirmación) los recuerdos tuyos y de tu equipo. |
| #225 «Ver todos» | Una búsqueda de tus contactos cortada en 20 trae la lista completa (hasta 500) al panel y a la descarga. |

## Medición

Hecha con `gpt-6-luna`, con el juez en `gpt-6.1-sol` y sin astra. El detalle está en `docs/cowork-plan13-medicion.md`.

Casos `ur-*` y `chat-*` (27), main contra la configuración final (estado de cuenta y esfuerzo bajo):
- Casos OK: 20 → 24–25.
- Checks: 226/237 → 234/235.
- Corridas fallidas: 1 → 0.
- Tiempo total P50: 5,9 → 5,4 s.
- Tiempo total P90: 13,7 → 9,6 s.

Juez:
- comprensión 4,63 → 4,78;
- veracidad 4,41 → 4,37;
- claridad 4,56 → 4,67;
- fricción 3,96 → 4,11;
- explica 4,15 → 4,33;
- «mala» 6 → 6.

AXIS ★: 186 → 183 de 262 checks, dentro del ruido de una corrida, y con P90 más bajo.

El esfuerzo de razonamiento medio duplicó la latencia sin mejorar los checks, así que queda en `low`.

## Para el mantenedor

1. **Desplegar `main`** como siempre, con su tag `prod-AAAA-MM-DD`. No hay migraciones.
2. **Activar el estado de la cuenta**: `COWORK_WORKSPACE_ENABLED=true` en `apphosting.yaml`.
   - Es solo lectura: tres conteos sobre `leads` y `bulk_campaigns`, el cupo de LinkedIn y la agenda de «¿Qué toca hoy?».
   - Corre en paralelo con el contexto del usuario y tiene un tope de 2,5 s.
   - Si la latencia de los turnos sube en producción, se apaga el flag sin tocar código.
3. **No definir `COWORK_REASONING_EFFORT`**: el valor por defecto `low` es el medido. `medium` existe solo para pruebas.
4. **Regrabar el video tutorial de Cowork** cuando convenga. El video grabado todavía muestra «Crear trabajo» y «Nuevo trabajo»; el guion (`scripts/tutorial-videos/storyboards/cowork.mjs`) ya usa los nombres nuevos.
5. **Pruebas de humo después del deploy**, además de las habituales:
   - `/api/onboarding/tour` debe responder 401;
   - `/cowork` debe responder 200;
   - `POST /api/cowork/wake` debe responder 401;
   - `GET /api/cowork/memories` sin sesión debe responder 401;
   - `POST /api/cowork/runs/<id>/feedback` sin sesión debe responder 401.
6. **Leer el feedback**:
   ```sql
   select payload, created_at from cowork_run_events where kind = 'answer.feedback' order by created_at desc;
   ```
7. **Rollback**:
   - el estado de cuenta: apagar el flag;
   - cualquier otra parte: `git revert` del PR, redeploy y pruebas de humo.
   - Ninguna parte deja datos que haya que limpiar: el feedback son eventos y olvidar archiva la fila de `suplia_memories`.

## Lo que queda

- **Medir en producción** la latencia del estado de la cuenta (`loadCoworkWorkspace`) y, con dos semanas de 👍/👎, qué respuestas fallan más y por qué.
- **Fricción de «¿quieres que revise…?»**: la queja más frecuente del juez, todavía presente en 2 o 3 respuestas de 27. Cowork ofrece una consulta gratuita en vez de hacerla.
- **Tareas largas (4c)**: requiere una migración que el dueño debe autorizar.
- **«Otra versión» del primer mensaje**: abre una conversación nueva y oculta la anterior, así que no tiene ‹ 1/2 ›. Las versiones de los turnos siguientes sí lo tienen.
