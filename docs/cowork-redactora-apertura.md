# Cowork: correos que abren con el trabajo del destinatario (8 oct 2026)

## Problema

Una lectura ciega de los correos que escribe la Redactora de Cowork encontró los mismos defectos en muchas respuestas:

- **Apertura con el cargo o el producto:** «Por tu rol en RR. HH.», «Como {{cargo}} en {{empresa}}», «Tu cargo como jefe de
  Reclutamiento está enfocado en…», «Te escribo para presentarte AXIS». La regla anterior lo pedía: «la primera frase habla del
  destinatario o de su rol».
- **Listas de funciones:** «por lote, por archivo o correo, con evidencia auditable».
- **`{{nombre}}` en un correo a una sola persona**, incluso uno pedido en Word.
- **Notas internas dentro del correo:** «no tengo más antecedentes verificados sobre la empresa».
- **Jerga en el texto al usuario:** «dato aprobado», «sincronización del buzón», «según el dato de tu perfil».

Los mejores correos abrían con la tarea concreta que la oferta le quita al destinatario («consultar persona por persona»), usaban la
prueba del Perfil y cerraban con una sola pregunta.

## Cambio

En `src/lib/cowork/writer.ts`, reglas de la Redactora:

- **Primera frase:** el trabajo del destinatario, es decir, la tarea concreta que la oferta le quita o mejora, como la vive hoy, o un
  dato observado de su empresa. Nunca su rol, su cargo ni el producto.
- **La oferta:** una sola capacidad dicha en una frase simple, con a lo más una prueba, sin enumerar funciones.
- **Un correo a una sola persona:** la saluda por su nombre de pila, también si lo pide en Word o PDF.
- **El correo es el texto que se envía:** lo que no sabes va en `reply`, no en el correo.
- **`reply`:** sin las palabras de las reglas internas («dato aprobado», «sincronización del buzón»), y sin explicarle al usuario
  qué hace su propia oferta.
- **Chequeo determinístico nuevo:** un `email_draft` con un solo destinatario que usa `{{nombre}}` vuelve a la Redactora para que
  use su nombre.

## Medición

11 casos de redacción (correo, mejora, campaña, secuencia, seguimiento, Word), 2 veces cada uno, con `gpt-6-luna` y el esfuerzo de
producción. Dos sesiones de Claude leyeron a ciegas las 44 respuestas mezcladas, sin saber cuál era cuál:

| | Antes | Con las reglas |
|---|---|---|
| Buenas / mejorables / malas | 4 / 11 / 7 | 15 / 5 / 2 |
| Calidad del correo (1 a 5) | 2,86 | 3,68 |
| Veracidad | 4,77 | 4,86 |
| Utilidad | 4,18 | 4,36 |
| Claridad | 4,09 | 4,36 |
| Posición media (1 = mejor de 4) | 3,18 | 1,82 |
| Mejor respuesta del caso | 1 de 11 | 10 de 11 |
| Segundos por turno (mediana) | 21 | 20 |

Las reglas ya se habían medido antes, con la Redactora en esfuerzo medio, contra esfuerzo bajo y medio sin ellas: posición media
2,45 contra 3,68 y 4,36, y buenas 10 contra 4 y 3 de 22.

## Lo que se probó y no quedó

La Redactora con esfuerzo de razonamiento medio. En una primera ronda ganó 6 de 8 casos. En una segunda, más grande, quedó detrás
del esfuerzo bajo: posición media 4,36 contra 3,68 y malas 11 contra 6 de 22. Además suma latencia: la llamada pasa de 5 a 9 s en
la mediana, con un máximo de 26 s cuando el límite es 30 s. Sigue en esfuerzo bajo.

Queda pendiente, según los evaluadores:

- cierres que repiten la misma fórmula («¿Te serviría conversar sobre cómo podría apoyar…?»);
- nombrar «junior» al prospecto;
- mezclar tú y usted.

Sin migraciones ni flags.
