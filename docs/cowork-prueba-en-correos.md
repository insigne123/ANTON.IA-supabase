# Cowork: los correos usan la prueba del perfil (8 oct 2026)

## Problema

Un evaluador independiente (otra sesión de Claude) leyó a ciegas 26 respuestas de Cowork con luna. Los correos que escribía o mejoraba
salían genéricos («En tu rol en {{empresa}}, puede ser relevante conocer…») y no usaban la prueba que el usuario cargó en su Perfil
(«Procesa 1.000 personas en unos 30 minutos»). Las instrucciones decían que los `proofPoints` se pueden citar, pero ninguna regla
pedía usarlos al redactar.

## Cambio

`src/lib/cowork/agent-instructions.ts`, regla de toda redacción: si `userContext` trae `proofPoints`, el correo cita el que más calce con
el destinatario, tal cual y en una frase, como la razón concreta para responder (en una secuencia, en uno de los correos). Sin
`proofPoints` no inventa cifras ni resultados.

## Medición

8 casos de redacción (`ur-escribir-sin-correo`, `ur-mejorar-correo`, `inicio-escribir`, `inicio-mejorar`, `mkt-campana-rrhh`,
`descargar-correo`, `mkt-secuencia`, `mkt-seguimiento`), 2 veces cada uno, con `gpt-6-luna`. El evaluador leyó las 32 respuestas
mezcladas, sin saber cuál era cuál:

| | Antes | Con la regla |
|---|---|---|
| Calidad del correo (¿lo enviarías? 1 a 5) | 2,88 | 3,56 |
| Buenas / mejorables / malas | 1 / 12 / 3 | 9 / 6 / 1 |
| Utilidad | 3,81 | 4,25 |
| Veracidad | 4,88 | 4,94 |
| Claridad | 4,06 | 4,31 |
| Posición media (1 = mejor de 4) | 2,94 | 2,06 |
| Mejor respuesta del caso | 2 de 8 | 6 de 8 |
| Correos que citan la prueba del perfil | 10 de 16 | 14 de 16 |
| Checks automáticos | 169 de 170 | 170 de 170 |

Ninguna versión inventó cifras. Queda pendiente, según el evaluador:

- aperturas obvias («revisar antecedentes laborales puede ser parte de…»);
- funciones amontonadas;
- seguimientos que no mencionan el correo anterior.

Sin migraciones ni flags.
