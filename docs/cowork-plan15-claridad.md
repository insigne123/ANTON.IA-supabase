# Cowork: menos rodeos y menos trabajo devuelto (Plan 15, 8 oct)

Objetivo del dueño: que el usuario se comunique con la IA con facilidad y que le responda lo que necesita, fácil de entender.

## Lo que se midió primero

Casos `ur-*`, `chat-*` e `hilo-*` (39), coordinador `gpt-6-luna` con los flags de producción (estado de la cuenta, tareas,
preferencias, búsqueda externa, importar contactos, escritora y diseñadora), juez `gpt-6.1-sol`. Pasaban 36 de 39 casos y 416 de 420
checks, así que los checks ya no distinguen; el juez sí: 23 buenas, 9 mejorables y 7 malas. Lo que más se repetía en las malas:

- **Ofrecer una consulta gratuita en vez de hacerla**: «¿Quieres que identifique cuáles de tus contactos con correo calzan mejor…?».
  El detector de ofertas de lectura (`OFFERED_READ`, Plan 12) no conocía «identifique», «analizo» ni «priorizo».
- **El aviso «Por cierto» repetido**: en «¿Qué toca hoy?», la respuesta ya nombraba a Marcela en la tabla y terminaba igual con «Por
  cierto, Marcela Rojas pidió una reunión hace 4 días».
- **Prudencia explicada en vez de practicada**: «aunque el cargo por sí solo no confirma que tengan esa necesidad», «son sectores
  presentes en tu base, no una prueba de que necesiten…». Alarga la respuesta y no ayuda a decidir.
- **El costo de buscar decisores**: la receta de oportunidades decía «lleva aprobación y créditos»; buscar prospectos usa una
  búsqueda del cupo diario (los créditos son al buscar cada correo). Cowork llegó a decir «aproximadamente 1 crédito».

## Qué cambia

- `src/lib/cowork/agent-loop.ts`: `OFFERED_READ` reconoce también «identifico/identifique», «analizo/analice» y «priorizo/priorice»;
  esas respuestas vuelven al modelo para que haga la consulta (con `COWORK_OFFERED_READS_ENABLED`, encendido en producción).
- `src/lib/cowork/answer-quality.ts`: `withoutRepeatedAside` quita el «Por cierto, …» cuando la respuesta o sus tarjetas ya nombraron a
  esa persona. Solo el que cierra su línea, para no cortar nada después.
- `src/lib/cowork/agent-instructions.ts`:
  - regla 3: «La prudencia tampoco se explica: basta con no afirmar lo que no consta», con ejemplos de lo que no se escribe;
  - receta de oportunidades: buscar decisores usa una búsqueda del cupo diario; los créditos se gastan al buscar el correo.

## Medición (mismos 39 casos, misma configuración, una corrida cada uno)

| | main | este PR |
|---|---|---|
| Casos OK | 36/39 | 35/39 |
| Juez: buena / mejorable / mala | 23 / 9 / 7 | 25 / 11 / 3 |
| Comprensión | 4,82 | 4,90 |
| Veracidad | 4,56 | 4,69 |
| Utilidad | 4,38 | 4,46 |
| Claridad | 4,62 | 4,87 |
| Fricción | 4,41 | 4,51 |

Pasan de mala a buena o mejorable: `ur-perfil-info`, `ur-oferta-app`, `ur-investigacion-lista`, `ur-como-me-ha-ido`,
`chat-aviso-hoy`. El caso que falla de más (`chat-aviso-reunion`) es la escritora que esta vez no incluyó el aviso que sí recibió en
findings: variación de una corrida, no lo que cambia este PR (el aviso no estaba en la respuesta para quitarlo). Queda una mala nueva
(`chat-dia-envio`, una pregunta general de ventas que ofrece revisar métricas); el patrón de ofrecer una consulta en un botón de
respuesta sugerida sigue siendo lo más frecuente en las mejorables.

AXIS ★ (20 operaciones, misma configuración): 181/263 checks en main y 182/263 en este PR, dentro del ruido de una corrida.

La corrección del costo de buscar decisores se agregó después de estas corridas (es una frase de la receta de oportunidades).

Sin migraciones ni flags nuevos.
