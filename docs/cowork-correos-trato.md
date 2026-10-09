# Cowork: un solo trato y una pregunta distinta por correo (9 oct 2026)

## Problema

Los correos y las secuencias de la Redactora mezclaban el «te» con un «ustedes/sus procesos» impersonal y, aunque el pedido
dijera «tono cercano», salían formales. En las secuencias, los tres correos cerraban con casi la misma pregunta
(«¿Cómo gestionan hoy esa revisión?»). La causa estaba en las reglas: la pregunta de cierre de cada correo debía ser «cómo lo hacen
hoy, quién lo hace o cuánto les toma», y en la secuencia el correo 2 también «pregunta cómo lo hacen hoy», así que la Redactora
repetía la misma pregunta en todos. Además, ningún chequeo marcaba la mezcla de trato ni la pregunta repetida.

## Cambio

`src/lib/cowork/writer.ts`:

- Reglas de la Redactora: cada correo se escribe directo y en presente, sin «puede sumar», «podría facilitar» ni «si en algún
  momento». Le habla a la persona de tú (usted solo si el encargo o el contexto de redacción lo pide), con el mismo trato en todo.
  En la secuencia, cada correo cierra con un tipo de pregunta distinto: el 1 pregunta cuánto les toma, el 2 cómo lo hacen o quién lo hace
  y el 3 si le sirve verlo con un caso propio. Además, ninguna pregunta repite la de otro correo con otras palabras.
- Chequeos determinísticos (`coworkDraftIssues`): marcan tú y usted en un mismo bloque («un solo trato») y, en una secuencia, un
  correo que cierra con casi la misma pregunta que uno anterior («pregunta distinta»). Lo que marcan se corrige una vez, como los demás
  chequeos, sin gastar la Revisora.

## Medición

3 casos (`mkt-campana-rrhh`, `mkt-secuencia`, `inicio-escribir`), 4 veces cada uno, con `gpt-6-luna`. Un lector independiente
(otra sesión de Claude) leyó las 36 respuestas mezcladas y con etiquetas anónimas, sin saber cuál era cuál:

| | Antes | Solo chequeos | Chequeos y reglas |
|---|---|---|---|
| ¿Lo enviarías tal cual? (1 a 5) | 2,42 | 2,58 | 3,25 |
| Secuencia (1 a 5) | 1,50 | 2,25 | 3,50 |
| Respuestas con pregunta repetida | 4 | 3 | 0 |
| Tono distinto del pedido | 3 | 1 | 0 |
| Respuestas con dos preguntas | 2 | 1 | 0 |
| Checks automáticos | 132 de 132 | 132 de 132 | 131 de 132 |

El check que falló fue una frase del resumen sobre la bandeja de entrada («cobertura completa de la bandeja»), un problema
intermitente que no viene de este cambio. Según el lector, queda pendiente:

- aperturas con rodeos («puede sumar trabajo manual»), que siguen en 11 de 12 respuestas;
- correos intercambiables entre destinatarios.

Sin migraciones ni flags.
