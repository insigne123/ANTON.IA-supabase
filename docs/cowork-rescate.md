# Cowork · rescate de un turno que iba a fallar (Plan 14, 2)

> **8 oct:** el rescate usa `gpt-6-luna` con esfuerzo de razonamiento alto, no sol (`docs/cowork-rescate-luna.md`).

Segunda mejora de comportamiento del Plan 14. Está inspirada en Odysseus, el espacio de trabajo con IA de código abierto de PewDiePie: cuando su modelo pequeño falla un turno, un modelo más fuerte lo toma y responde.

## El problema

Cuando un turno no alcanza a terminar, la persona ve un error:
- «No pude completar esta respuesta. Tu solicitud quedó guardada: reintenta o reformúlala»;
- «El asistente tardó demasiado en responder»;
- «No logré armar una respuesta válida».

En las evaluaciones guardadas pasó en 5 de 1.019 respuestas. `ur-pipeline-grafico` falló 3 veces en rondas distintas, siempre por seguir leyendo hasta la última decisión. En producción hubo 5 turnos fallidos en 30 días; ninguno desde el 2 de octubre.

Es poco, pero es lo peor que puede ver alguien: el trabajo del turno se pierde detrás de un error.

## Qué cambia

Si el turno iba a fallar, se hace una sola decisión más con `COWORK_RESCUE_MODEL` (gpt-6.1-sol en producción). Esa decisión solo puede responder, nunca proponer acciones ni leer más. La respuesta dice en la primera frase qué se revisó o hizo y qué faltó, después lo útil que encontró, y cierra con el siguiente paso.

| Cuándo se rescata | Motivo registrado |
|---|---|
| La última decisión todavía pedía una lectura | `reads_at_last_decision` |
| La última decisión fue rechazada por el ciclo | `rejected_at_last_decision` |
| La última decisión no cumplió el formato | `invalid_at_last_decision` |
| El modelo tardó demasiado o respondió 429 o 5xx | `model_unavailable` |
| El turno terminó sin respuesta final | `no_answer` |
| Falló una consulta | `unexpected` |

**Nunca se rescata:**
- una cancelación, un acceso perdido o un lease perdido (el turno ya no es de este worker);
- un presupuesto o cupo agotado, porque su mensaje ya dice qué hacer;
- una propuesta que el servidor rechazó con su motivo («No pude preparar la acción: …»).

**Una respuesta que ya existe gana:** si el turno ya tenía una respuesta (la de una corrección o la del juez), queda esa y no se gasta una llamada.

**Límites:**
- una vez por turno;
- solo si quedan al menos 12 s antes del cierre del worker, con hasta 45 s para responder;
- solo si el presupuesto de llamadas del turno lo admite (la base permite 5 llamadas de coordinador por turno y el turno usa 4).

Sin tiempo o sin presupuesto, el turno falla como antes.

`COWORK_RESCUE_MODEL` sin definir apaga el rescate. Un valor con «astra» también lo apaga: la regla del dueño es no usar astra nunca.

## Para aprender de las fallas

Cada rescate deja un evento `turn.rescued` en `cowork_run_events`, con el motivo y el modelo:

```sql
select payload->>'failure' as motivo, count(*) from cowork_run_events where kind = 'turn.rescued' group by 1 order by 2 desc;
```

## Medición

1. **Casos que fallaron antes**, con luna, 3 repeticiones, `main` contra este PR (`ur-pipeline-grafico`, `ur-ficha-cuenta`, `chat-aviso-dado` y `axis-d1-cadencia`):
   - 105/117 verificaciones en ambos lados;
   - 0 turnos fallidos y 0 rescates.

   Las fallas son raras y esta vez no se repitieron. Esto confirma que el rescate no actúa cuando no hace falta.
2. **Falla forzada con el modelo real**: un decisor que siempre pide otra lectura, y el rescate real con gpt-6.1-sol. Las dos respuestas pasan todas las verificaciones de su caso:

   | Caso | Rescate | Tiempo | Verificaciones |
   |---|---|---|---|
   | `ur-pipeline-grafico` | `reads_at_last_decision` | 10,9 s | 8/8 |
   | `ur-ficha-cuenta` | `reads_at_last_decision` | 32,5 s | 9/9 |

   Ejemplo: «Revisé tus contactos y los envíos registrados, pero faltó obtener las etapas del CRM para construir tu gráfico de pipeline…».

## Costo

Solo en los turnos que iban a fallar: 5 en 30 días en producción. `COWORK_MODEL_PRICING_JSON` todavía no tiene precio para gpt-6.1-sol, así que esas llamadas quedan con costo desconocido hasta que el mantenedor lo agregue con el precio real.

## Rollback

Borrar `COWORK_RESCUE_MODEL` de `apphosting.yaml` y redeployar, o `git revert` del PR.
