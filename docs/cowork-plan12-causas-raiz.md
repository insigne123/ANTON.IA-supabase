# Cowork · Plan 12, causas raíz después de la ronda 1 (6 oct 2026)

Después de la ronda 1 (`docs/cowork-plan12-ronda-1.md`) se corrigió una causa por PR, cada una medida con el modelo real:

- coordinador y Redactora con `gpt-6-luna`;
- juez `gpt-6-sol`.

## Lo que entró

| PR | Causa | Arreglo | Medición |
|---|---|---|---|
| 4a-2 (#201) | La Redactora terminaba con «¿Creo la campaña pausada?» y el usuario tenía que responder «sí» para ver la tarjeta | Después de escribir, el coordinador propone `campaign.create` con esos correos en el mismo turno | Campaña propuesta en 10 de 10 turnos; juez 3 / 3 / 0 (buena / mejorable / mala) |
| 4a-3 (#202) | Ofrecía investigar sin correo y afirmaba «no tiene LinkedIn» cuando solo faltaba el perfil guardado | Investigar parte del correo; sin perfil se propone buscar sus datos con el proveedor o se pide el enlace | Seis casos × 2: «mala» de 10 a 3 de 12; fricción 4,42 |
| 4a-4 | Una decisión de búsqueda o de artefacto fallaba porque el modelo llenaba `campaign` con relleno («N/A@invalid», asunto vacío). Pasó en 16 decisiones de las mediciones; en una, el turno se quedó sin decisiones y falló | `campaign` inválido ya no rechaza la decisión. Solo `campaign.create`, la única acción que lo usa, le devuelve el problema al modelo | El esquema JSON que ve el modelo no cambia (misma huella). La prueba del ciclo cubre los dos casos |

## Detrás de un flag (apagado): hacer la consulta ofrecida

`COWORK_OFFERED_READS_ENABLED=true`

**El problema:** en 716 turnos medidos, 62 cerraron ofreciendo una consulta gratuita que Cowork podía hacer («¿Reviso tus contactos guardados?», «¿Quieres que revise la campaña?»). El juez calificó «mala» 55 de ellos, el 89 %. El promedio general de «mala» es 44 %.

**Con el flag:** si la respuesta cierra así y quedan dos decisiones, el ciclo le pide al modelo que haga esa consulta y edite su respuesta con lo que encuentre.

- Funciona como la corrección del juez del turno: una lectura más, aunque pase el techo.
- Si la corrección falla, se muestra la respuesta original.
- No se aplica a lo que lleva aprobación («¿Busco su correo?») ni a lo que es redactar («¿Te redacto…?»).

**Medición (6 oct, con el modelo real):** los mismos 12 casos × 2, con el flag encendido y apagado, y el juez `gpt-6-sol`. Son casos elegidos porque cerraban ofreciendo una consulta, así que su «mala» es más alta que el promedio.

| | Apagado | Encendido |
|---|---:|---:|
| Juez: buena / mejorable / mala | 3 / 1 / 20 | 4 / 3 / 17 |
| Utilidad | 2,88 | 3,08 |
| Fricción | 2,63 | 2,71 |
| Veracidad | 4,08 | 4,17 |
| Verificaciones | 215/290 | 218/290 |
| Llamadas al modelo por caso | 2,75 | 3,0 |
| Tiempo total (p50) | 9,1 s | 8,7 s |

- **Mejora, pero poco:** 3 «mala» menos de 24, sin bajar en ninguna verificación ni en el tiempo.
- **Lo que queda:** en `axis-d2`, `axis-g1` y `axis-h5` la respuesta sigue ofreciendo la consulta, porque el turno lee en dos decisiones y ya no le queda lugar. El arreglo de fondo es leer en paralelo en una sola decisión (ver «Pendiente»).
- **Un costo en pantalla:** 7 respuestas se corrigieron. Con el texto en vivo, 5 de ellas se ven primero y después cambian. Con `COWORK_ANSWER_HOLD_ENABLED` la respuesta se muestra una sola vez, ya corregida.

**Recomendación:** encenderlo junto con `COWORK_ANSWER_HOLD_ENABLED`. Lo enciende el mantenedor en el entorno de producción.

Para medirlo:

```bash
COWORK_OFFERED_READS_ENABLED=true node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer \
  --max-calls=70 --cases=axis-a7-rubro,axis-d2-que-toca-hoy,axis-e3-invitaciones,axis-e4-mensajes,axis-g1-bandeja,axis-g2-tibios,axis-g3-automatizacion,axis-h4-reporte-exacto,axis-h5-corrige-la-premisa,ur-pipeline-grafico,ur-perfil-info,ur-como-me-ha-ido \
  --repeat=2 --output=salida.json
```

## Lo que se probó y no entró: mirar antes de buscar

**La hipótesis:** en AXIS ★ (a2, a4 y a5), el coordinador proponía buscar prospectos nuevos en la primera decisión, sin mirar los contactos que ya tenía. La prueba fue rechazar una vez esa búsqueda y pedirle primero `audience.analyze` o `leads.recommend`.

| | Sin el cambio (rondas 5 y 6) | Con el cambio |
|---|---|---|
| Mira lo que ya tiene antes de buscar | 0 de 12 | 8 de 8 |
| Juez en a2 y a4 | mejorable o buena | mala, en las dos corridas |
| Juez en `ur-buscar-leads-yago`, `ur-retail-alto-cargo` y `ur-tarea-larga` | mayormente buena o mejorable | buena, mejorable, mejorable |
| Duración del turno | 7 a 10 s | 18 a 31 s |

- **Por qué empeoró:** después de mirar, seguía proponiendo la búsqueda y decía «no encontré contactos que calcen». El juez lo marcó como una conclusión sin respaldo.
- **El costo:** el turno tardó el doble o el triple.
- **La decisión:** no entra. Lo que la medición pide es un plan que use los contactos guardados, y eso no se arregla con una lectura obligatoria.

## Pendiente

- **Con crédito en la cuenta de OpenAI:**
  - medir los tres casos nuevos de artefactos de 3c (`art-licitaciones`, `art-ficha-cuenta` y `art-segmentos`).
- **AXIS d2 y g1:** leen en dos decisiones y responden en la tercera. Ya no queda lugar para la consulta ofrecida, así que el arreglo tiene que ir en las instrucciones: leer en paralelo en una sola decisión.
