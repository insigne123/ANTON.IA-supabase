# Borradores que suenan a persona y seguimientos que preguntan (Plan 15, 8 oct)

Objetivo del dueño: que la IA cree material de calidad, que los borradores y los seguimientos sean poderosos.

## Lo que se midió primero

Línea base con `native-draft/v18`, `gpt-6-luna` como generador y como juez, conjuntos AXIS (2 secuencias, 8 correos por corrida) y
ServiPro (20 casos, 25 correos), sin escrituras ni envíos. Lo que el juez marcaba:

- **Rodeos de plantilla** («hay un dato concreto», «una posibilidad es», «podría ser una tarea concreta para tu equipo», «Eso vuelve
  relevante pensar en…»): «suena humano» era el criterio más bajo, 3,4.
- **Beneficios estirados**: el modelo explicaba la propuesta de valor con un mecanismo que el vendedor no declara («así cada consulta
  sigue el mismo procedimiento», «en vez de mantenerse igual todo el proyecto»). La mayoría de los envíos a revisión humana.
- **Seguimientos iguales**: los tres repetían la cifra completa del inicial («300 trabajadores para dos obras nuevas en el Biobío») y
  pedían otra vez 15 minutos. El validador exigía los minutos en todo seguimiento.
- **Usted y tú mezclados en el cierre** (`resolveEffectiveCta`): decidía el tratamiento por palabras sueltas del cuerpo. «les faltó
  gente» o «su equipo» (que hablan de la empresa) le ponían «¿Le parece…?» a un correo de tú, y «servirle» no se reconocía como usted.

## Qué cambia (`native-draft/v19`)

- **El servicio en presente y con sujeto** («AXIS consulta…», «Ponemos…»); el condicional queda para la situación del destinatario,
  una vez. Lista de rodeos prohibidos, también en la revisión editorial.
- **El beneficio con las palabras del vendedor** (`valueProposition` o un servicio declarado), sin mecanismos ni comparaciones nuevas.
- **El primer seguimiento pregunta cómo lo resuelven hoy** («¿Cómo hacen hoy esas consultas para los postulantes?») en vez de pedir
  otra reunión; el segundo sí propone la conversación breve y el cierre sigue igual. El validador acepta en un seguimiento una pregunta
  sin minutos si no pide reunión (`meetingAskCue`); un pedido de reunión o llamada sigue necesitando los minutos del CTA aprobado.
- **El hecho del destinatario se nombra corto en los seguimientos** («con la temporada de Navidad»), sin repetir la oración del inicial.
- **El tratamiento del cierre sale de lo pedido**: primero la instrucción del usuario y el estilo («de usted», «tutea»), y solo si nada
  lo dice, del cuerpo, con marcas que no se confunden con el plural («usted», «le escribo», «servirle»).

## Medición (mismo juez, misma herramienta)

`scripts/evaluate-outreach-set.ts` ahora hace lo que la app: un correo de usted lleva y se valida con el CTA de usted
(`resolveEffectiveCta`). `scripts/judge-outreach-set.ts` le da al juez los datos de la reconexión (antes marcaba como inventada la
relación anterior que sí estaba en el caso).

AXIS (2 secuencias, 8 correos por corrida, 3 corridas por versión, 24 correos):

| | v18 | v19 |
|---|---|---|
| Enviar | 8 | 12 |
| Corregir | 8 | 9 |
| Revisión humana | 8 | 3 |
| Suena humano | 3,42 | 3,59 |
| Especificidad | 4,29 | 4,21 |
| Un solo pedido | 4,75 | 4,92 |
| Tono y tratamiento | 4,83 | 4,79 |
| Veracidad | 4,21 | 4,79 |

ServiPro (25 correos por corrida). v18: 3 corridas con la herramienta corregida (75 correos). v19: las 2 corridas con el
tratamiento del cierre ya corregido (50 correos):

| | v18 | v19 |
|---|---|---|
| Enviar | 21 (28 %) | 16 (32 %) |
| Corregir | 23 (31 %) | 23 (46 %) |
| Revisión humana | 31 (41 %) | 11 (22 %) |
| Suena humano | 3,41 | 3,46 |
| Especificidad | 3,97 | 3,98 |
| Tono y tratamiento | 4,64 | 4,74 |
| Veracidad | 4,17 | 4,54 |
| Válidos al final (con la herramienta corregida) | 16/16 iniciales y 8/8 pasos | 16/16 iniciales y 8/8 pasos |
| Costo por corrida | US$ 0,033 a 0,045 | US$ 0,037 a 0,039 |

Lo que sigue yendo a revisión humana son inferencias sueltas («la apertura trae un peak de trabajo») y los casos de objeción y
reconexión, que el generador de correos en frío no está hecho para responder (en la app, las respuestas a un prospecto van por
`email.reply_thread`). Con una o dos corridas por versión hay ruido de ±2 correos; la dirección se repite en los dos conjuntos y en todas
las corridas: menos revisión humana y más veracidad.

Así queda la secuencia AXIS (construcción), seguimiento 1:

> Un cliente en piloto ya usa AXIS a diario en reclutamiento. Para los trabajadores que Constructora Pehuén contratará en obras nuevas
> en el Biobío, […] En Yago, AXIS hace consultas judiciales automáticas para revisar antecedentes laborales. ¿Cómo hacen hoy esas
> consultas para quienes postulan a las obras?

Antes cerraba con «¿Podemos conversar 15 minutos sobre su aplicación en Pehuén?», igual que el inicial y el segundo seguimiento.

## Para repetir

```bash
OUTREACH_EVAL_OUT=<carpeta> node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts <carpeta>/outreach-eval/<fecha>
# AXIS: con OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json en los dos
```

Los borradores ya escritos no cambian; aplica a los nuevos. Sin migraciones ni flags.
