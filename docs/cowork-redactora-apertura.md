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

## Ajuste: sin apertura repetida ni cierre de fórmula

La regla de #283 traía un ejemplo de apertura que coincide con la oferta del banco: «revisar los antecedentes de cada postulante uno
por uno». El modelo lo copiaba, así que 17 de 22 primeros correos abrían casi igual («Revisar los antecedentes laborales de cada
postulante…»). Antes de #283, ninguno. Para un usuario que vende eso, todos sus correos empezarían igual.

- **Apertura:** sin ejemplos de un rubro. Se pide la tarea como la vive esta persona según su cargo y su empresa, con palabras
  propias, sin copiar la descripción de la oferta, y que dos correos a personas distintas no abran con la misma frase.
- **Cierre:** una pregunta propia del correo (cómo lo hacen hoy, quién lo hace o cuánto les toma), no la fórmula «¿Te serviría
  conversar sobre cómo podría apoyar…?».
- **Trato:** el mismo, tú o usted, en todo el correo y en toda la secuencia.
- **Cargo:** nunca le nombra su nivel al destinatario («junior», «senior»).

Mismos 11 casos, 2 veces, contra #283:

| | #283 | Con el ajuste |
|---|---|---|
| Primeros correos que abren con la misma frase | 17 de 22 | 9 de 22 |
| Cierre «¿Te serviría conversar sobre cómo podría…?» | 5 de 22 | 0 de 22 |
| Buenas / mejorables / malas (lectura ciega) | 6 / 13 / 3 | 13 / 7 / 2 |
| Calidad del correo (1 a 5) | 3,18 | 3,59 |
| Veracidad | 4,95 | 4,77 |
| Posición media (1 = mejor de 4) | 2,77 | 2,23 |
| Mejor respuesta del caso | 3 de 11 | 8 de 11 |
| Checks automáticos | — | 224 de 224 |

La veracidad baja por dos respuestas sueltas: una dice que el correo «quedó dirigido a tus contactos con correo» sin haberlos
consultado, y otra cambia «procesa 1.000 personas» por «ha procesado». No se repiten.

Queda pendiente, según los evaluadores:

- con una oferta acotada, los correos todavía se parecen entre sí: misma estructura (problema, qué hace, prueba, pregunta);
- versiones «por persona» que casi no cambian entre una y otra.

Sin migraciones ni flags.
