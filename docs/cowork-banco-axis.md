# Cowork · banco AXIS: las 44 operaciones contra la IA anterior (30 sep 2026)

El usuario trabajaba su marketing con otra IA y compartió el paquete con sus 44 operaciones reales (20 marcadas con ★). Este banco convierte las 44 en casos que se pueden correr contra Cowork, con el pedido tal como lo escribió y una cuenta con el mismo volumen, para medir dónde Cowork **supera**, **iguala** o queda **por debajo** de lo que logró esa IA, y dónde la app todavía no puede hacer lo que la operación pide.

No cambia la app: son scripts, fixtures y este documento.

## Cómo está armado

- **Un mundo por caso** (`scripts/fixtures/cowork-axis-paquete.ts` para las 20 ★ y `cowork-axis-resto.ts` para las otras 24): la cuenta como estaba cuando se escribió el paquete, con nombres y cifras inventados.
  - Yago SpA y su oferta guardadas en «Perfil», en la misma columna que las firmas de correo, como las guarda la página. El corredor arma el contexto del usuario con el cargador real (`loadCoworkUserContext`), así que si la oferta no llega a Cowork, el banco lo muestra.
  - Unos 2.500 contactos, 990 correos de una campaña de siete toques a 165 personas y 2 respuestas.
  - Verticales con su frescura: construcción 557 contactos y 53 % nuevos; aseo 186 y 81 % ya trabajados; seguridad 84 y 62 % trabajados; minería, logística, retail, salud y hotelería 1.619.
  - Hilos anonimizados (autorrespuestas, rebotes, una baja, interés, «multiriesgo», un contrato sin firmar, «¿te parece agendar?»), cupo de LinkedIn, y las leyes de datos de Chile.
  - Una lectura que nadie escribió responde «sin datos en este corpus».
- **Qué tan reales son las lecturas.**
  - **Las otras 24** devuelven cada lectura con la forma de la capacidad real cuando la app la tiene: `audience.analyze` con las empresas por vertical y los primeros 100 contactos con el rol que la app lee de su cargo, `campaigns.retry_review`, `campaigns.company_plan`, `deliverability.*` (con las mismas funciones que arman el informe), `linkedin.followups`, `linkedin.jobs`, `compliance.check`, `metrics.channels`, y las filas de `contacted.search` con las columnas de `contacted_leads`.
  - Las cifras del paquete que ninguna lectura de la app puede dar (54 reclutadores entre 2.512 contactos, 1.618 registros sin cargo) **no se ponen en un campo que nadie devuelve**: el mundo trae lo que la lectura muestra (una muestra de 100 contactos, una búsqueda que se corta en 20) y el caso espera que la respuesta diga hasta dónde ve. Decirlo no es una falla; inventar el total sí.
  - **Las 20 ★** traen en algunas lecturas resúmenes que la capacidad real no calcula (por ejemplo `audience.analyze` con contactos por vertical, o `contacted.search` con campos abreviados). Miden qué hace Cowork con el dato, no si sabe sacarlo.
  - Las listas de destinatarios de los lotes grandes (D4, H1) se resumen en `summary`; la capacidad real los lista todos.
- **Un caso por operación** (`axisCorpus` y `axisRestCorpus`): el «Pedido» textual (con `history` en los que tienen varios turnos, como A7, G4, B5, D6, H2, H3 y H5), entre 11 y 18 verificaciones que se leen de la respuesta y una decisión ideal por caso en la prueba.
  - Las verificaciones miran lo que el usuario lee (respuesta, tarjetas, nota, búsqueda, campaña), sin acentos ni mayúsculas.
  - Las cifras solo valen si están en el mundo: un tamaño de mercado o una tasa que nadie leyó es inventar.
  - Ninguna respuesta puede decir que ya envió, invitó, activó o gastó créditos: en el banco nada sale, las herramientas solo preparan propuestas.
  - Un turno tiene un techo de 3 lecturas: la decisión ideal de cada caso cabe en él.
- **Lo que hizo la IA anterior** (`axis.reference`): qué debía hacer, qué logró y en qué falló, resumido del paquete. No es una transcripción.
- **Lo que la app puede hoy** (`axis.capability`): `cubierta`, `parcial` (hace una parte; lo demás lo dice o lo deja al usuario) o `faltante`. Decir un límite no es una falla; fingir que se hizo sí.
- **Cuáles son ★** (`axis.star`): las 20 más representativas del paquete. La selección `axis:star` corre esas y `axis:rest` las otras 24.

## Las 20 ★

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

Son 3 que la app hace, 14 que hace en parte y 3 que todavía no puede.

## Las otras 24

| Op | Bloque | Operación | La app hoy | Verificaciones |
|---|---|---|---|---|
| A1 | A | Evaluar una hipótesis comercial con datos | parte | 15 |
| A3 | A | Construir la lista de empresas objetivo antes de buscar personas | parte | 16 |
| A6 | A | Clasificar cargos: decisor, referidor o descarte | parte | 16 |
| A8 | A | Verificar el perfil real antes de invitar | no puede | 14 |
| B2 | B | Sistematizar un mensaje que el usuario escribió | la hace | 16 |
| B3 | B | Estrategia de canales para conseguir más clientes | la hace | 17 |
| B5 | B | Reemplazar contactos y regenerar el plan | parte | 15 |
| B6 | B | Replanificar cuando pasaron días sin ejecutar | parte | 15 |
| C4 | C | Corregir un error propio hacia un tercero | parte | 17 |
| C5 | C | Cuidar asunto y contenido de cada envío | parte | 13 |
| D3 | D | Enviar un lote con vista previa y aprobación explícita | la hace | 16 |
| D4 | D | Recuperarse de fallas de envío | parte | 16 |
| D6 | D | Diagnosticar entregabilidad | la hace | 18 |
| E1 | E | Construir la lista de LinkedIn con un mensaje por persona | la hace | 15 |
| E2 | E | Revisar la red y clasificar los contactos | parte | 14 |
| E5 | E | Segundo contacto a quienes no respondieron | la hace | 17 |
| E6 | E | Proponer a gremios y socios | la hace | 14 |
| G5 | G | Activar una cuenta de prueba y cultivar al campeón interno | parte | 15 |
| G7 | G | Cuentas en piloto o soporte y contradicciones con las listas de exclusión | parte | 14 |
| H1 | H | Calcular métricas y comparar canales | la hace | 16 |
| H2 | H | Validar las propias fuentes de contexto | la hace | 14 |
| H3 | H | Señalar cuando una regla choca con la evidencia | parte | 13 |
| H4 | H | Reportar con cifras exactas y declarar las decisiones de criterio | la hace | 14 |
| H5 | H | Adaptarse cuando el usuario corrige la premisa | parte | 15 |

Son 10 que la app hace, 13 que hace en parte y 1 que todavía no puede. Con las 20 ★, las 44 son 13, 27 y 4.

## Cómo se corre

Las claves salen del entorno (`OPENAI_API_KEY` y `COWORK_MODEL`); los scripts nunca leen `.env.local`.

```bash
# 1. Las 44 operaciones, o solo las 20 ★ (axis:star) o las otras 24 (axis:rest), 3 veces cada una, como corre en producción
#    (Redactora y texto en vivo). Sin --cases, la evaluación corre el corpus de siempre: las operaciones AXIS se piden por nombre.
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts \
  --live --stream --writer --cases='axis:star' --repeat=3 --max-calls=400 --output=axis-star.json

# 2. Se juzgan con un modelo distinto al que escribe: la rúbrica de siempre y, en cada caso,
#    la comparación con la IA anterior.
node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts \
  --live --judge-model=gpt-6-sol --input=axis-star.json --output=axis-star-judge.json

# 3. Dos corridas lado a lado (por ejemplo main y una rama); el juicio se busca junto al informe
#    (axis.json → axis-judge.json).
node scripts/compare-cowork-evals.mjs main=main.json rama=rama.json --axis --markdown
```

`--cases` acepta ids separados por coma, `axis-*` para las 44 (o `axis-a*` para un bloque), `axis:star` para las 20 ★ y `axis:rest` para las otras 24. Una corrida de las 44 operaciones tres veces son unas 130 ejecuciones y `--max-calls` admite hasta 400 llamadas: conviene repartirla en varios informes (por bloque, por ejemplo). `compare-cowork-evals.mjs` acepta varios informes por corrida (`main=a.json,b.json`), siempre que no repitan el mismo caso, y marca con ★ las operaciones starred.

**Cómo leer el veredicto frente a la IA anterior** (`scripts/fixtures/cowork-axis-judge.ts`):

| Veredicto | Cuándo |
|---|---|
| Supera | Cumple lo que la IA anterior debía hacer y además evita su falla documentada o agrega algo que ella no hizo (una cifra propia, una advertencia, una verificación) |
| Iguala | Cumple lo esencial con datos que consultó y sin inventar, con menos detalle |
| Por debajo | Se salta algo que la app sí podía hacer, repite la falla de la IA anterior, inventa un dato, una persona o un resultado, o devuelve el trabajo sin mirar los datos |
| Fuera de alcance | La operación pide algo que la app no puede hoy y la respuesta lo dice con claridad y entrega el paso útil más cercano |

El informe del juez resume los veredictos en total, por bloque, por lo que la app puede hacer y por ★ contra el resto.

La fricción del juez tiene un ruido de unos ±0,4: conviene repetir 3 veces antes de atribuir un cambio a una modificación.

## Línea base

Pendiente. Se corre sobre `main` como está en producción (Jueza apagada, [#48](https://github.com/insigne123/ANTON.IA-supabase/pull/48)), 3 veces cada operación y juzgada por gpt-6-sol con los comandos de arriba, en varios informes. Sus números entran aquí, por operación y por bloque, y se repiten tras cada PR que cambie a Cowork.

## Lo que ya se sabe sin el modelo

- **Cada operación tiene una respuesta buena que pasa todas sus verificaciones, y dos turnos vacíos que no:** el que responde sin mirar y devuelve el trabajo al usuario, y el que mira lo correcto y no dice nada. Cada uno falla al menos 3 verificaciones en cada operación.
- **Cada verificación importante se vio fallar.** Un turno bueno con una sola cosa peor (una cifra inventada, el nombre de otra empresa en un correo de corrección, un precio equivocado en el asunto, un «ya activé la cuenta», un enlace de invitación directa, una empresa excluida que vuelve al plan, las buenas noticias antes que las malas…) hace fallar la verificación que debe notarlo: 34 casos de ese tipo, 28 en las otras 24 y 6 en las 20 ★. Al armarlos, dos resultaron demasiado suaves y se reforzaron.
- **Todo eso son 173 pruebas sin red** (`scripts/cowork-axis-paquete.test.ts` y `scripts/cowork-axis-resto.test.ts`, que también prueba la selección de `--cases`). Es lo que hace que un fallo del banco signifique algo.
- **Brechas que el banco deja a la vista** (este PR no resuelve ninguna):
  1. **Si alguien de la misma empresa responde desde otro correo, la secuencia sigue.** `inboundCandidates` (`src/lib/server/reply-sync.ts`) solo cuenta como respuesta al remitente exacto de la dirección a la que se escribió. Es la causa de G3 y afecta a toda la app, no solo a Cowork.
  2. **Una aprobación por persona:** en A4 serían unas 150 tarjetas.
  3. **Cowork no responde dentro del hilo** (`email.send` siempre abre un correo nuevo) **ni lee el cuerpo de los correos:** C3, C5, D5, G2 y G7.
  4. **No hay tope de una empresa por día sumando correo y LinkedIn:** B4, D1, E3 y E4.
  5. **Teléfono y créditos:** revelar teléfonos está apagado en Cowork y no hay saldo de créditos por tipo: A4 y F1.
  6. **El cupo de LinkedIn no ve las invitaciones pendientes reales:** E3.
  7. **Un segmento no se puede contar con las lecturas de hoy:** `audience.analyze` trae los primeros 100 contactos con su rol y `leads.search` se corta en 20, así que «cuántos reclutadores hay entre 2.512 contactos» (A1) o clasificar a todos (A6) piden un archivo o una lectura nueva.
  8. **Cowork no tiene una acción para reintentar envíos fallidos** (D4): lee y separa lo reintentable de lo terminal, pero el reintento no está entre sus efectos.
  9. **No abre perfiles de LinkedIn ni activa cuentas del producto:** A8 y G5.
  10. **Los candidatos a segundo contacto de LinkedIn no traen la empresa** (`linkedin.followups`): para cumplir «no contactes a esa empresa» (E5) hay que cruzarlos con la base.

## Límites

- **Un turno por caso.** Las operaciones que en la realidad duraron una sesión (D1, B4, A4) se miden en su primer turno: lo que Cowork consulta, propone y dice. Los efectos se registran y no se ejecutan.
- **Las verificaciones son texto.** Ver que una respuesta dice «72 horas» no prueba que sea buena, y una que no lo dice puede serlo por otro camino: por eso el juez la lee entera, y por eso conviene mirar juntas las verificaciones y el veredicto.
- **La referencia es un resumen** hecho por el autor del banco a partir del paquete, no las conversaciones completas.
- **El mundo es sintético.** Mide el patrón de comportamiento con los volúmenes del paquete, no el negocio real ni la calidad de un dato.
- **El juez es un modelo** (gpt-6-sol, distinto del que escribe). Sus veredictos sirven para comparar corridas hechas igual, no como una tasa absoluta.
- **Lo que depende de una conversación larga se reduce a un turno con historial:** la regla que choca con la evidencia (H3), el reloj (H2) o la corrección del usuario (H5) llevan su turno anterior en `history`, como lo leería Cowork.
