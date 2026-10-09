# Cowork: sin cautelas que no ayudan (9 oct 2026)

## Problema

Un barrido de 20 casos de marketing e inicio (60 respuestas, lectura a ciegas) encontró «cautela innecesaria» en 27 de 60:
«…presenta AXIS sin atribuirles una necesidad confirmada», «sin dar por hecho cómo opera cada empresa», «sin asumir que lo
recibió», además de repetir que el registro «no confirma si respondió por fuera de ANTON.IA». La regla 3 del coordinador ya lo
prohíbe, pero casi todas venían del resumen de la Redactora, que no tenía esa regla. Su propia regla («sin atribuirle al destinatario
necesidades que no constan») la llevaba a contar lo que había evitado suponer.

## Cambio

- `src/lib/cowork/answer-quality.ts`: `withoutCaveats` quita del texto de la respuesta, no de los correos, las cláusulas «sin asumir…»,
  «sin suponer…», «sin dar por hecho/sentado/confirmado…» y «sin atribuirle(s)…», hasta su coma, punto o un «y» con el verbo siguiente.
  Si la frase era solo eso, la deja como está. Se aplica en `polishCoworkAnswer`, a toda respuesta.
- `src/lib/cowork/writer.ts`, regla de salida de la Redactora: no explica lo que evitó suponer y, si no ve las respuestas, lo dice una
  sola vez.

## Medición

8 casos con redacción y análisis (`inicio-escribir`, `mkt-campana-rrhh`, `mkt-seguimiento`, `mkt-secuencia`, `inicio-a-quien`,
`mkt-a-quien-escribo`, `mkt-necesito-clientes`, `inicio-como-voy`), 3 veces cada uno, con `gpt-6-luna`. Un lector independiente
leyó las 48 respuestas mezcladas, con etiquetas anónimas:

| | Antes | Con el cambio |
|---|---|---|
| Nota media (1 a 5) | 2,92 | 3,33 |
| Respuestas con una cautela de estas formas | 13 de 24 | 6 de 24 |
| Checks automáticos | 229 de 231 | 231 de 231 |

Los dos checks que fallaban antes eran de jerga («cobertura del buzón»). Lo que queda son, sobre todo, frases como «Solo veo lo
registrado en ANTON.IA», una por respuesta, que la regla 3 permite. Los errores de destinatarios en `mkt-necesito-clientes` son el fallo
intermitente ya conocido.

Sin migraciones ni flags.
