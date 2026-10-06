# Plan 13, parte 1: medición (6 oct 2026)

Qué se midió: Cowork con el estado de la cuenta en cada turno (`COWORK_WORKSPACE_ENABLED=true`), las reglas nuevas de
comunicación (largo según el pedido, prosa natural, reconocer errores en una frase, honestidad con los datos, preguntas
generales de ventas sin consultar) y el aviso proactivo de lo pendiente hoy («Por cierto, …»), contra `main` (`345f408c`).

Cómo:
- Coordinador con `gpt-6-luna` y `COWORK_OFFERED_READS_ENABLED=true`.
- Flags `--writer --artifacts --preferences --stream`.
- Una corrida por caso.
- Juez `gpt-6.1-sol` en los casos `ur-*` y `chat-*`. El juez ve el mismo `workspace` que recibió el turno.
- No se usó ningún modelo astra.

## Casos `ur-*` (20) + `chat-*` (7)

| Variante | Casos OK | Checks | Fallidas | Primer texto P50 | Total P50 | Total P90 |
|---|---|---|---|---|---|---|
| main | 20/27 | 226/237 | 1 | 5,0 s | 5,9 s | 13,7 s |
| workspace + esfuerzo medio | 25/27 | 234/237 | 0 | 9,0 s | 12,3 s | 24,0 s |
| workspace + esfuerzo bajo | 25/27 | 235/237 | 0 | 3,3 s | 4,9 s | 11,4 s |
| final (bajo, aviso al final) | 24/27 | 234/238 | 0 | 3,7 s | 5,4 s | 9,6 s |

El esfuerzo medio duplica la latencia sin mejorar los checks: `COWORK_REASONING_EFFORT` queda en `low` por defecto
(se puede subir a `medium` o `high` por variable de entorno).

## Juez (`gpt-6.1-sol`, 27 casos)

| | comprensión | veracidad | utilidad | claridad | fricción | explica | buena / mejorable / mala |
|---|---|---|---|---|---|---|---|
| main | 4,63 | 4,41 | 4,22 | 4,56 | 3,96 | 4,15 | 13 / 8 / 6 |
| final | 4,78 | 4,37 | 4,22 | 4,67 | 4,11 | 4,33 | 12 / 9 / 6 |

La primera calificación del candidato bajó la veracidad a 3,56. La causa fue que el juez no veía el `workspace` y
marcaba como inventadas las cifras que venían en él («256 contactos, 21 con correo»). Ahora el resultado guarda el
`workspace` y el juez lo recibe con `usuario`. Las «mala» que quedan son la fricción conocida de ofrecer una consulta
en vez de hacerla, no algo nuevo.

## AXIS ★ (20 operaciones, 262 checks)

- main: 186/262, con un total P50 de 8,4 s y P90 de 13,3 s.
- final: 183/262, con un total P50 de 7,9 s y P90 de 10,6 s.

La diferencia está dentro del ruido de una corrida (±1 check en cinco casos).

## Ejemplos del candidato

- «hola»: responde sin consultar nada. «Hola, Nicolás. ¿Qué te gustaría avanzar hoy? Tienes 256 contactos y 21 con correo…».
- Corrección: «Me equivoqué: confundí los 256 contactos totales con contactos que tienen correo…».
- Honestidad: «No lo mandaría igual a los 256: solo 21 aparecen con correo…».
- Pregunta general («¿lunes o martes?»): «Si tienes que elegir, partiría el martes… Es una pauta para probar, no una garantía».
