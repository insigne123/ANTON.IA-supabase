# Cowork · banco AXIS: las 20 ★ contra la IA anterior (30 sep 2026)

El usuario trabajaba su marketing con otra IA y compartió el paquete con sus 44 operaciones reales (20 marcadas con ★). Este banco convierte las 20 ★ en casos que se pueden correr contra Cowork, con el pedido tal como lo escribió y una cuenta con el mismo volumen, para medir dónde Cowork **supera**, **iguala** o queda **por debajo** de lo que logró esa IA, y dónde la app todavía no puede hacer lo que la operación pide.

No cambia la app: son scripts, fixtures y este documento.

## Cómo está armado

- **Un mundo por caso** (`scripts/fixtures/cowork-axis-paquete.ts`): la cuenta como estaba cuando se escribió el paquete, con nombres y cifras inventados.
  - Yago SpA y su oferta guardadas en «Perfil», en la misma columna que las firmas de correo, como las guarda la página. El corredor arma el contexto del usuario con el cargador real (`loadCoworkUserContext`), así que si la oferta no llega a Cowork, el banco lo muestra.
  - Unos 2.500 contactos, 990 correos de una campaña de siete toques a 165 personas y 2 respuestas.
  - Verticales con su frescura: construcción 557 contactos y 53 % nuevos; aseo 186 y 81 % ya trabajados; seguridad 84 y 62 % trabajados; minería, logística, retail, salud y hotelería 1.619.
  - Hilos anonimizados (autorrespuestas, rebotes, una baja, interés, «multiriesgo», un contrato sin firmar, «¿te parece agendar?»), cupo de LinkedIn, y las leyes de datos de Chile.
  - Las lecturas devuelven la forma de las capacidades reales (filas de `contacted_leads` sin cuerpo de correo, cupos, `blockedBy`). Una lectura que nadie escribió responde «sin datos en este corpus».
- **Un caso por operación** (`axisCorpus`): el «Pedido» textual (con `history` en los que tienen varios turnos, como A7 y G4), unas 13 verificaciones que se leen de la respuesta y una decisión ideal por caso en la prueba.
  - Las verificaciones miran lo que el usuario lee (respuesta, tarjetas, nota, búsqueda, campaña), sin acentos ni mayúsculas.
  - Las cifras solo valen si están en el mundo: un tamaño de mercado o una tasa que nadie leyó es inventar.
  - Ninguna respuesta puede decir que ya envió, invitó o gastó créditos: en el banco nada sale, las herramientas solo preparan propuestas.
- **Lo que hizo la IA anterior** (`axis.reference`): qué debía hacer, qué logró y en qué falló, resumido del paquete. No es una transcripción.
- **Lo que la app puede hoy** (`axis.capability`): `cubierta`, `parcial` (hace una parte; lo demás lo dice o lo deja al usuario) o `faltante`. Decir un límite no es una falla; fingir que se hizo sí.

## Las 20 operaciones

| Op | Bloque | Operación | La app hoy | Verificaciones |
|---|---|---|---|---|
| A2 | A · Investigar y armar audiencia | Dimensionar el mercado y elegir verticales con datos | parte | 13 |
| A4 | A | Armar una ola gastando créditos solo donde vale | parte | 13 |
| A5 | A | Buscar el perfil correcto y enriquecer con autorización | parte | 13 |
| A7 | A | Investigar la empresa antes de escribir, y no confundir el rubro | parte | 12 |
| B1 | B · Estrategia y planificación | Diagnosticar por qué una campaña no funciona | la hace | 13 |
| B4 | B | Calendario multicanal de siete días | parte | 14 |
| C1 | C · Redactar | Escribir el correo frío corto | la hace | 15 |
| C2 | C | Personalizar por rol, vertical y registro | la hace | 13 |
| C3 | C | Responder objeciones y preguntas entrantes | parte | 13 |
| D1 | D · Ejecutar por correo | Ejecutar una cadencia de siete toques en tandas | parte | 13 |
| D2 | D | Revisar el estado y decir qué toca hoy | parte | 14 |
| D5 | D | Elegir hilo o correo nuevo, y verificar los hechos antes de enviar | no puede | 11 |
| E3 | E · Ejecutar por LinkedIn | Enviar invitaciones sin nota, cuidando el cupo y verificando | parte | 13 |
| E4 | E | Enviar mensajes a quienes aceptaron, verificando al destinatario | parte | 13 |
| F1 | F · Otros canales | Canal telefónico: lista, revelado y límites | no puede | 14 |
| G1 | G · Seguimiento | Barrer la bandeja y encontrar quién respondió alguna vez | parte | 13 |
| G2 | G | Reactivar a un lead tibio con el siguiente paso ya hecho | parte | 13 |
| G3 | G | Detectar fallas de la propia automatización y arreglarlas de raíz | no puede | 13 |
| G4 | G | Seguimiento después de la reunión: cotización, plan y compromisos | parte | 13 |
| G6 | G | Preparar una reunión y trazar su origen | parte | 13 |

Son 3 que la app hace, 14 que hace en parte y 3 que todavía no puede. Las 24 operaciones restantes del paquete van en un PR aparte.

## Cómo se corre

Las claves salen del entorno (`OPENAI_API_KEY` y `COWORK_MODEL`); los scripts nunca leen `.env.local`.

```bash
# 1. Las 20 operaciones, 3 veces cada una, como corre en producción (Redactora y texto en vivo).
#    Sin --cases, la evaluación corre el corpus de siempre: las operaciones AXIS se piden por nombre.
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts \
  --live --stream --writer --cases='axis-*' --repeat=3 --max-calls=400 --output=axis.json

# 2. Se juzgan con un modelo distinto al que escribe: la rúbrica de siempre y, en cada caso,
#    la comparación con la IA anterior.
node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts \
  --live --judge-model=gpt-6-sol --input=axis.json --output=axis-judge.json

# 3. Dos corridas lado a lado (por ejemplo main y una rama); el juicio se busca junto al informe
#    (axis.json → axis-judge.json).
node scripts/compare-cowork-evals.mjs main=main.json rama=rama.json --axis --markdown
```

`--cases` acepta ids separados por coma y `axis-*` para las 20. Para repartir una corrida en varios procesos, cada grupo de casos va en su propio informe: `compare-cowork-evals.mjs` acepta varios informes por corrida (`main=a.json,b.json`), siempre que no repitan el mismo caso.

**Cómo leer el veredicto frente a la IA anterior** (`scripts/fixtures/cowork-axis-judge.ts`):

| Veredicto | Cuándo |
|---|---|
| Supera | Cumple lo que la IA anterior debía hacer y además evita su falla documentada o agrega algo que ella no hizo (una cifra propia, una advertencia, una verificación) |
| Iguala | Cumple lo esencial con datos que consultó y sin inventar, con menos detalle |
| Por debajo | Se salta algo que la app sí podía hacer, repite la falla de la IA anterior, inventa un dato, una persona o un resultado, o devuelve el trabajo sin mirar los datos |
| Fuera de alcance | La operación pide algo que la app no puede hoy y la respuesta lo dice con claridad y entrega el paso útil más cercano |

La fricción del juez tiene un ruido de unos ±0,4: conviene repetir 3 veces antes de atribuir un cambio a una modificación.

## Línea base

Pendiente. Se corre sobre `main` como está en producción (Jueza apagada, [#48](https://github.com/insigne123/ANTON.IA-supabase/pull/48)), 3 veces cada operación y juzgada por gpt-6-sol con los comandos de arriba. Sus números entran aquí, por operación y por bloque, y se repiten tras cada PR que cambie a Cowork.

## Lo que ya se sabe sin el modelo

- **Cada operación tiene una respuesta buena que pasa todas sus verificaciones,** y una respuesta que no mira los datos y devuelve el trabajo al usuario falla al menos 3 en cada una (`scripts/cowork-axis-paquete.test.ts`, 42 pruebas sin red). Es lo que hace que un fallo del banco signifique algo.
- **Brechas que el banco deja a la vista** (este PR no resuelve ninguna):
  1. **Si alguien de la misma empresa responde desde otro correo, la secuencia sigue.** `inboundCandidates` (`src/lib/server/reply-sync.ts`) solo cuenta como respuesta al remitente exacto de la dirección a la que se escribió. Es la causa de G3 y afecta a toda la app, no solo a Cowork.
  2. **Una aprobación por persona:** en A4 serían unas 150 tarjetas.
  3. **Cowork no responde dentro del hilo** (`email.send` siempre abre un correo nuevo) **ni lee el cuerpo de los correos:** C3, D5 y G2.
  4. **No hay tope de una empresa por día sumando correo y LinkedIn:** B4, D1, E3 y E4.
  5. **Teléfono y créditos:** revelar teléfonos está apagado en Cowork y no hay saldo de créditos por tipo: A4 y F1.
  6. **El cupo de LinkedIn no ve las invitaciones pendientes reales:** E3.

## Límites

- **Un turno por caso.** Las operaciones que en la realidad duraron una sesión (D1, B4, A4) se miden en su primer turno: lo que Cowork consulta, propone y dice. Los efectos se registran y no se ejecutan.
- **Las verificaciones son texto.** Ver que una respuesta dice «72 horas» no prueba que sea buena, y una que no lo dice puede serlo por otro camino: por eso el juez la lee entera, y por eso conviene mirar juntas las verificaciones y el veredicto.
- **La referencia es un resumen** hecho por el autor del banco a partir del paquete, no las conversaciones completas.
- **El mundo es sintético.** Mide el patrón de comportamiento con los volúmenes del paquete, no el negocio real ni la calidad de un dato.
- **El juez es un modelo** (gpt-6-sol, distinto del que escribe). Sus veredictos sirven para comparar corridas hechas igual, no como una tasa absoluta.
