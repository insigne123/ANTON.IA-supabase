# Rescate de Cowork y modelos restantes con luna (8 oct 2026)

El dueño pidió usar `gpt-6-luna` para todo lo posible y subir el esfuerzo de razonamiento donde haga falta. Este cambio pasa a luna lo
que en `apphosting.yaml` todavía apuntaba a sol, salvo los borradores prioridad A (`OPENAI_REASONING_MODEL`). Esos van en su propio PR,
medidos aparte.

| Variable | Antes | Ahora | Uso |
|---|---|---|---|
| `COWORK_RESCUE_MODEL` | `gpt-6.1-sol` | `gpt-6-luna` | Una respuesta cuando un turno iba a fallar (`docs/cowork-rescate.md`) |
| `OPENAI_ORCHESTRATOR_MODEL` | `gpt-6-sol` | `gpt-6-luna` | Ningún código la lee hoy |
| `OPENAI_CRITICAL_MODEL` | `gpt-6-sol` | `gpt-6-luna` | Ningún código la lee hoy |

## El rescate con luna

- **Esfuerzo alto** (`COWORK_RESCUE_REASONING_EFFORT`, `src/lib/cowork/rescue-model.ts`): es la última palabra del turno y pasa poco
  (5 turnos en 30 días en producción). Las decisiones normales siguen en `low`: el Plan 13 midió que `medium` duplicaba la latencia
  sin mejorar los checks.
- **Instrucción más explícita** (`coworkRescueNote`): termina con una pregunta corta que proponga el siguiente paso y deja una o dos
  respuestas sugeridas. Con luna, la versión anterior a menudo cerraba sin siguiente paso.
- `scripts/evaluate-cowork-conversations.ts` usa el mismo esfuerzo para el rescate.

## Medición

Falla forzada, como en el Plan 14: el turno consulta con luna y su última decisión todavía pide una lectura (`reads_at_last_decision`);
la respuesta la da el rescate. Casos `ur-pipeline-grafico` y `ur-ficha-cuenta`, dos veces cada uno. En las 8 respuestas el rescate respondió y
ningún turno terminó en error. Checks del caso que pasaron:

| Rescate | Checks | Tiempo del rescate |
|---|---|---|
| luna, esfuerzo bajo, instrucción anterior | 27 de 34 | 6 a 13 s |
| luna, esfuerzo alto, instrucción anterior | 30 de 34 | 8 a 33 s |
| luna, esfuerzo alto, instrucción nueva (este PR) | 33 de 34 | 10 a 28 s |
| sol (Plan 14, una vez por caso) | 17 de 17 | 11 y 33 s |

Lo que faltaba con luna era cerrar con un siguiente paso o respuestas sugeridas. El único check que queda fuera es «entrega algo
visual o explica cómo verlo» en el pipeline vacío: la respuesta explica que no hay datos para graficar, sin decir cómo se vería.

Ejemplo: «Revisé el CRM de la organización y no aparecen oportunidades registradas, así que todavía no hay datos por etapa para
graficar. ¿Quieres que te prepare una plantilla para cargar oportunidades con etapa, monto y próximo paso?»

Costo: un rescate con luna en esfuerzo alto cuesta menos de $0,01; con sol costaba alrededor de $0,05.

Sin migraciones. Rollback: volver los valores en `apphosting.yaml` o `git revert` del PR.
