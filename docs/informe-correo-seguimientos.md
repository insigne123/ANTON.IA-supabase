# El informe trae cómo escribirle (Plan 6, PR-C2)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 6)

Punto 12: el informe debía servir para escribir el correo y los seguimientos.

La sección `angle` del informe v2 traía solo «una apertura útil y el siguiente paso». Además, la pantalla la mezclaba con las señales, las preguntas y los riesgos en «Qué explorar y cómo ayudar», así que no se veía como una guía para escribir.

## Qué cambia

- **El editor del informe** (`src/ai/flows/write-report-v2.ts`, versión `report-v2/editor/8`) escribe la sección `angle` como la guía para escribirle, según la oferta real. Cada punto va en su propio párrafo:
  1. **De 3 a 5 ángulos.** Cada uno lleva el dato o la señal que lo respalda, con su cita, o va dicho como hipótesis del rol, con el dolor posible y el beneficio concreto.
  2. **Una idea de primer correo:** asunto y 2 o 3 frases, con el ángulo más fuerte y un pedido de bajo esfuerzo.
  3. **Dos ideas de seguimiento.** Cada una con otro ángulo y algo nuevo que aportar: un dato, una pregunta o un recurso. Nunca «solo quería saber si viste mi correo».
  4. **Qué no afirmar:** lo que no se pudo confirmar y lo que el vendedor no puede respaldar.

  Siguen las reglas de siempre: nada de experiencia, clientes ni resultados del vendedor sin respaldo, y apertura con un evento solo si el evento es real.
- **Extensión:** de 1300 a 1900 palabras, antes de 1100 a 1600. La sección `angle` admite hasta 9 párrafos.
- **Un solo nombre:** la sección se llama «Cómo usarlo en el correo y los seguimientos» (`REPORT_V2_ANGLE_TITLE`) en el informe, en Cowork y en la pantalla.
- **En la pantalla del informe** (`NativeResearchReport`), la guía es su propio bloque, «Para escribirle», antes de la lectura comercial y abierto. Ya no se repite en «Qué explorar y cómo ayudar».
- **Los borradores** ya toman sus anclas de los datos citados en esta sección (`draft-context-v2.ts`): más ángulos respaldados son más anclas posibles.

Los informes ya escritos no se regeneran. El trabajador solo toma investigaciones pendientes, así que el cambio aplica a los informes nuevos y no gasta créditos de más.

## Medición

Con el modelo real (2 oct), `scripts/review-report-v2.ts --replay --role 'Jefa de Reclutamiento y Selección'`, sin escrituras ni envíos. El caso:
- un prospecto ficticio, el de las pruebas, con una sola fuente sobre la empresa, como las investigaciones parciales del 1 oct;
- la oferta AXIS (datos de prueba).

| | `main` (editor/7) | Este PR (editor/8), 3 corridas |
|---|---|---|
| Sección `angle` | 3 párrafos, 201 palabras: apertura y siguiente paso | 7 a 8 párrafos, de 419 a 487 palabras |
| Ángulos | ninguno separado | 4 en cada corrida |
| Idea de primer correo con asunto | no | 3 de 3 |
| Dos ideas de seguimiento | no | 3 de 3 |
| Qué no afirmar | no | 3 de 3 |
| Informe completo | 1492 palabras | de 1739 a 1859 palabras |
| Estado | completo, 1 aviso de repetición | completo en 3 de 3; revisión aprobada en 1 y avisos de repetición en 2 |
| Contenido retirado por la revisión | nada | nada |
| Tiempo y costo | 55 s, US$ 0,0045 | de 50 a 59 s, de US$ 0,0045 a 0,0049 |

**Una cuarta corrida agotó el tiempo** en el análisis (`reasonAboutReportV2Account`), antes del editor. Ese paso no cambia en este PR, así que se repitió. Con tan poca evidencia, los ángulos van como hipótesis del rol: solo 1 de 3 corridas citó un dato. Con más fuentes, cada ángulo puede llevar su cita.

## Pruebas

- **`src/ai/flows/write-report-v2.test.ts`:**
  - el prompt pide los ángulos con respaldo, el primer correo, los dos seguimientos y qué no afirmar;
  - la sección admite 9 párrafos y no 10.
- **`src/ai/flows/synthesize-report-v2.test.ts`:** el título fijo, y una guía vaciada por la revisión no se anuncia.
- **`scripts/test-research-report-writing-ui.mjs` (DOM):**
  - la guía es su propio bloque, abierto y antes de la lectura comercial;
  - no se repite en la lectura comercial;
  - sin guía no hay bloque vacío.
