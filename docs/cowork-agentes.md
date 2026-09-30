# Cowork · Quién hace cada paso (30 sep 2026)

Plan 2, punto G4. Mientras Cowork trabaja, el plan y la actividad ya decían qué hacía. Ahora también dicen **quién**, como en Claude Cowork cuando reparte el trabajo entre agentes. Cada especialidad tiene un nombre, igual que la Redactora y la Revisora de G1:

| Agente | Qué hace | Lecturas |
|---|---|---|
| **Analista** | cifras y resultados | `metrics.*`, `campaigns.batch_report`, `campaigns.list`, `deliverability.*`, `files.read`, `files.list` |
| **Estratega** | audiencias, listas y planes de contacto | `audience.*`, `saved_searches.*`, `lists.*`, `campaigns.company_plan`, `campaigns.next_touch`, `campaigns.retry_review`, `campaigns.plan`, `privacy.contactability*` |
| **Investigadora** | lo que se sabe de un contacto o una cuenta | `research.*`, `crm.*`, `contacted.*`, `replies.*`, `gmail.*`, `compliance.*` |
| **LinkedIn** | red, cupo y trabajos de LinkedIn | `linkedin.*` |

Buscar un contacto, leer el perfil o la cuenta y responder los hace Cowork mismo, sin nombre.

## Qué cambia para el usuario

- **En el plan mientras trabaja:** «Analista · Reviso tus cifras de la semana», «Investigadora · Reviso lo que sé de Marcela», «LinkedIn · Veo tu cupo de LinkedIn». El nombre del paso en curso va en el color de acento.
- **En la línea «Ahora»:** «Ahora: Investigadora · reviso lo que sé de Marcela…», con la misma forma que «Redactora · escribiendo 3 correos».
- **En el panel lateral:** «Paso 2 de 4: Investigadora · reviso lo que sé de Marcela».
- **Al abrir la actividad de un turno terminado:** el plan y cada consulta con su agente («Analista · Calculó tasas de 7 y 30 días»).
- **Los pasos pendientes** ahora se leen en el gris de texto secundario, y no en el tenue: sobre el panel del plan miden 4,53:1 en claro (antes 2,86) y 7,5:1 en oscuro. Los que no hicieron falta siguen tenues y tachados.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Qué agente hace cada lectura (`coworkSpecialistFor`) | `src/lib/cowork/agents.ts` (nuevo) |
| El agente en cada paso del plan, en cada consulta y en el panel lateral (`coworkPlanStepLine`) | `src/lib/cowork/presentation.ts` |
| Plan, línea «Ahora» y lista de consultas | `src/components/cowork/CoworkActivity.tsx` |

- **El nombre sale de la lectura, no del modelo.** Cada paso del plan ya dice qué lectura lo completa (`read`), y cada consulta dice qué acción corrió.
  - No cuesta llamadas ni tiempo.
  - No puede nombrar a un agente que no trabajó.
  - Funciona igual en los turnos guardados antes de este cambio.
- **No cambia nada de lo que ve el modelo:** instrucciones, contexto, juez y corpus quedan idénticos a `main`.
- **Por qué no son llamadas aparte al modelo:** la Redactora (G1) y el juez del turno (G2) sí lo son, porque escriben o juzgan texto y se midió que mejoran el resultado. Las lecturas de cifras, audiencias o LinkedIn ya las hace el coordinador en una llamada. Partirlas en agentes con modelo propio sumaría latencia, y no hay datos de que mejore la respuesta. Lo que faltaba era que se viera quién hace qué.

## Validación

**Pruebas sin modelo** (`npm run test:unit` y `verify-cowork`):
- `agents.test.ts` (nuevo): cada familia de lecturas con su agente; búsquedas de contactos, perfil, cuenta y borradores sin agente.
- `presentation.test.ts`:
  - los pasos del plan llevan su agente, y el paso de responder no;
  - la línea del paso («Investigadora · veo qué correos ya enviaste»);
  - el agente de una consulta;
  - el panel lateral.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-g4.mjs`): un turno a mitad de su plan de 4 pasos y el mismo plan terminado. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **En curso:**
  - la línea «Ahora» dice «Investigadora · reviso lo que sé de Marcela…», y lo mismo anuncia el estado para lectores de pantalla;
  - el plan dice «Analista · Reviso tus cifras de la semana (hecho)», «Investigadora · Reviso lo que sé de Marcela (en curso)», «LinkedIn · Veo tu cupo de LinkedIn (pendiente)» y «Te preparo el resumen», sin agente;
  - a 1440 px, el panel lateral dice «Paso 2 de 4: Investigadora · reviso lo que sé de Marcela».
- **Terminado:** al abrir «Siguió un plan de 4 pasos…», el plan con sus agentes y las consultas («Analista · Calculó tasas de 7 y 30 días», «Investigadora · Consultó la investigación guardada · 2 fuentes», «LinkedIn · Revisó tu cupo de invitaciones»).
- **Contraste:** el nombre del paso en curso mide 5,74:1 en claro y 5,24 en oscuro; los demás, 15 o más.
- **En todos los casos:**
  - sin errores de página ni scroll horizontal;
  - `/cowork` queda en 239 kB de carga inicial, como `main`.

## Límites

- **Los nombres describen especialidades, no procesos separados:** el trabajo lo sigue decidiendo el coordinador en su llamada, dentro del mismo techo.
- **Una lectura nueva sin familia conocida** aparece como de Cowork, sin nombre, hasta que se agregue a `agents.ts`.
