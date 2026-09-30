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

Medida el 30 de septiembre de 2026 con el modelo real: las 44 operaciones por 3 ejecuciones (132), en ocho informes de 5 o 6 operaciones, con `--stream --writer` (texto en vivo y Redactora encendidos, como en producción). Coordinador gpt-6-luna; juez gpt-6-sol con la rúbrica de siempre y la referencia de la IA anterior. El código es el de `main` con la Jueza apagada ([#48](https://github.com/insigne123/ANTON.IA-supabase/pull/48)); este banco solo agrega scripts, fixtures y documentos. Las cifras sirven para compararlas con otra corrida hecha igual, no como una tasa absoluta.

| | Operaciones | Verificaciones que pasan | Juez: buena / mejorable / mala | Frente a la IA anterior: supera / iguala / por debajo / fuera de alcance | Medias del juez: comprensión · veracidad · utilidad · claridad · fricción |
|---|---|---|---|---|---|
| **Las 44** | 44 | 1259 de 1881 (66,9 %) | 16 / 36 / 80 | 1 / 2 / 109 / 20 | 4,00 · 3,81 · 2,79 · 4,67 · 3,03 |
| Las 20 ★ | 20 | 538 de 786 (68,4 %) | 6 / 23 / 31 | 0 / 0 / 49 / 11 | 4,08 · 4,05 · 2,83 · 4,63 · 3,22 |
| Las otras 24 | 24 | 721 de 1095 (65,8 %) | 10 / 13 / 49 | 1 / 2 / 60 / 9 | 3,93 · 3,61 · 2,76 · 4,70 · 2,87 |

**Por bloque:**

| | Operaciones | Verificaciones que pasan | Juez: buena / mejorable / mala | Frente a la IA anterior: supera / iguala / por debajo / fuera de alcance | Medias del juez: comprensión · veracidad · utilidad · claridad · fricción |
|---|---|---|---|---|---|
| A · Investigar y armar audiencia | 8 | 216 de 336 (64,3 %) | 5 / 8 / 11 | 0 / 0 / 21 / 3 | 4,33 · 4,25 · 3,08 · 4,92 · 3,75 |
| B · Estrategia y planificación | 6 | 160 de 270 (59,3 %) | 1 / 6 / 11 | 0 / 1 / 16 / 1 | 4,00 · 3,56 · 2,89 · 4,39 · 3,17 |
| C · Redactar | 5 | 156 de 213 (73,2 %) | 3 / 7 / 5 | 0 / 0 / 13 / 2 | 3,93 · 4,20 · 3,00 · 4,40 · 3,33 |
| D · Ejecutar por correo | 6 | 175 de 264 (66,3 %) | 3 / 1 / 14 | 0 / 0 / 12 / 6 | 3,72 · 3,67 · 2,33 · 4,78 · 2,33 |
| E · Ejecutar por LinkedIn | 6 | 175 de 258 (67,8 %) | 2 / 5 / 11 | 0 / 0 / 15 / 3 | 4,17 · 3,83 · 2,89 · 4,55 · 2,94 |
| F · Otros canales | 1 | 28 de 42 (66,7 %) | 0 / 0 / 3 | 0 / 0 / 2 / 1 | 2,67 · 4,67 · 2,00 · 4,67 · 2,67 |
| G · Seguimiento | 7 | 183 de 282 (64,9 %) | 2 / 7 / 12 | 0 / 0 / 17 / 4 | 4,24 · 4,05 · 2,86 · 4,72 · 2,81 |
| H · Control y reportes | 5 | 166 de 216 (76,9 %) | 0 / 2 / 13 | 1 / 1 / 13 / 0 | 3,60 · 2,67 · 2,53 · 4,80 · 2,73 |

**Por lo que la app hace hoy:**

| | Operaciones | Verificaciones que pasan | Juez: buena / mejorable / mala | Frente a la IA anterior: supera / iguala / por debajo / fuera de alcance | Medias del juez: comprensión · veracidad · utilidad · claridad · fricción |
|---|---|---|---|---|---|
| La app la hace | 13 | 402 de 594 (67,7 %) | 9 / 10 / 20 | 1 / 1 / 37 / 0 | 4,10 · 3,92 · 3,28 · 4,72 · 3,41 |
| La app parte | 27 | 745 de 1131 (65,9 %) | 7 / 25 / 49 | 0 / 1 / 64 / 16 | 3,94 · 3,70 · 2,64 · 4,64 · 2,93 |
| La app no puede | 4 | 112 de 156 (71,8 %) | 0 / 1 / 11 | 0 / 0 / 8 / 4 | 4,08 · 4,17 · 2,25 · 4,67 · 2,50 |

**Por operación** (3 ejecuciones cada una; el juez en una escala de 1 a 5; «IA ant.» es el veredicto frente a lo que logró la IA anterior, en las 3 ejecuciones):

| Op | | La app | Verificaciones | Juez (b / m / M) | IA ant. (S / I / D / F) | Comp. | Ver. | Util. | Clar. | Fricc. | Mediana |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 |  | parte | 29/45 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 5,0 | 3,7 | 3,3 | 5,0 | 2,3 | 7 s |
| A2 | ★ | parte | 24/39 | 0 / 3 / 0 | 0 / 0 / 3 / 0 | 3,7 | 5,0 | 3,0 | 5,0 | 5,0 | 9 s |
| A3 |  | parte | 24/48 | 3 / 0 / 0 | 0 / 0 / 3 / 0 | 5,0 | 5,0 | 5,0 | 5,0 | 5,0 | 6 s |
| A4 | ★ | parte | 21/39 | 1 / 2 / 0 | 0 / 0 / 3 / 0 | 4,0 | 5,0 | 3,3 | 5,0 | 5,0 | 9 s |
| A5 | ★ | parte | 29/39 | 0 / 2 / 1 | 0 / 0 / 3 / 0 | 4,0 | 5,0 | 2,7 | 5,0 | 4,7 | 5 s |
| A6 |  | parte | 30/48 | 0 / 0 / 3 | 0 / 0 / 1 / 2 | 3,3 | 2,7 | 2,0 | 4,7 | 2,0 | 12 s |
| A7 | ★ | parte | 26/36 | 1 / 1 / 1 | 0 / 0 / 3 / 0 | 5,0 | 4,7 | 3,3 | 5,0 | 3,0 | 4 s |
| A8 |  | no puede | 33/42 | 0 / 0 / 3 | 0 / 0 / 2 / 1 | 4,7 | 3,0 | 2,0 | 4,7 | 3,0 | 14 s |
| B1 | ★ | la hace | 24/39 | 0 / 3 / 0 | 0 / 0 / 3 / 0 | 3,3 | 5,0 | 3,3 | 4,3 | 4,3 | 11 s |
| B2 |  | la hace | 24/48 | 1 / 0 / 2 | 0 / 0 / 3 / 0 | 4,7 | 2,7 | 4,3 | 4,7 | 5,0 | 7 s |
| B3 |  | la hace | 28/51 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 4,3 | 4,3 | 3,0 | 5,0 | 2,0 | 10 s |
| B4 | ★ | parte | 29/42 | 0 / 1 / 2 | 0 / 0 / 3 / 0 | 3,7 | 3,0 | 2,3 | 4,7 | 2,7 | 24 s |
| B5 |  | parte | 29/45 | 0 / 1 / 2 | 0 / 0 / 2 / 1 | 5,0 | 2,3 | 2,3 | 3,0 | 2,3 | 11 s |
| B6 |  | parte | 26/45 | 0 / 1 / 2 | 0 / 1 / 2 / 0 | 3,0 | 4,0 | 2,0 | 4,7 | 2,7 | 14 s |
| C1 | ★ | la hace | 39/45 | 1 / 2 / 0 | 0 / 0 / 3 / 0 | 3,7 | 5,0 | 3,7 | 4,3 | 4,7 | 17 s |
| C2 | ★ | la hace | 27/39 | 2 / 1 / 0 | 0 / 0 / 3 / 0 | 5,0 | 5,0 | 4,0 | 4,0 | 4,7 | 14 s |
| C3 | ★ | parte | 26/39 | 0 / 3 / 0 | 0 / 0 / 3 / 0 | 5,0 | 3,7 | 3,3 | 3,7 | 3,0 | 11 s |
| C4 |  | parte | 40/51 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 3,7 | 3,0 | 2,0 | 5,0 | 2,3 | 24 s |
| C5 |  | parte | 24/39 | 0 / 1 / 2 | 0 / 0 / 1 / 2 | 2,3 | 4,3 | 2,0 | 5,0 | 2,0 | 22 s |
| D1 | ★ | parte | 28/39 | 0 / 0 / 3 | 0 / 0 / 2 / 1 | 4,0 | 2,3 | 2,0 | 4,7 | 2,0 | 12 s |
| D2 | ★ | parte | 30/42 | 0 / 1 / 2 | 0 / 0 / 3 / 0 | 4,3 | 4,0 | 3,0 | 5,0 | 2,3 | 15 s |
| D3 |  | la hace | 27/48 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 2,3 | 4,3 | 1,7 | 5,0 | 1,7 | 38 s |
| D4 |  | parte | 35/48 | 0 / 0 / 3 | 0 / 0 / 0 / 3 | 2,7 | 1,3 | 1,3 | 4,0 | 1,3 | 12 s |
| D5 | ★ | no puede | 27/33 | 0 / 0 / 3 | 0 / 0 / 1 / 2 | 4,0 | 5,0 | 2,0 | 5,0 | 2,0 | 12 s |
| D6 |  | la hace | 28/54 | 3 / 0 / 0 | 0 / 0 / 3 / 0 | 5,0 | 5,0 | 4,0 | 5,0 | 4,7 | 5 s |
| E1 |  | la hace | 33/45 | 0 / 1 / 2 | 0 / 0 / 3 / 0 | 4,0 | 3,7 | 3,3 | 5,0 | 2,3 | 18 s |
| E2 |  | parte | 27/42 | 0 / 3 / 0 | 0 / 0 / 3 / 0 | 4,3 | 4,3 | 3,0 | 4,3 | 4,7 | 16 s |
| E3 | ★ | parte | 23/39 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 4,0 | 2,0 | 2,3 | 4,0 | 2,0 | 13 s |
| E4 | ★ | parte | 29/39 | 0 / 0 / 3 | 0 / 0 / 0 / 3 | 3,7 | 3,3 | 2,0 | 4,7 | 2,0 | 10 s |
| E5 |  | la hace | 31/51 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 4,0 | 4,7 | 2,3 | 5,0 | 2,0 | 8 s |
| E6 |  | la hace | 32/42 | 2 / 1 / 0 | 0 / 0 / 3 / 0 | 5,0 | 5,0 | 4,3 | 4,3 | 4,7 | 30 s |
| F1 | ★ | no puede | 28/42 | 0 / 0 / 3 | 0 / 0 / 2 / 1 | 2,7 | 4,7 | 2,0 | 4,7 | 2,7 | 14 s |
| G1 | ★ | parte | 24/39 | 0 / 1 / 2 | 0 / 0 / 3 / 0 | 4,7 | 5,0 | 3,0 | 4,7 | 3,0 | 12 s |
| G2 | ★ | parte | 32/39 | 1 / 0 / 2 | 0 / 0 / 2 / 1 | 4,3 | 3,3 | 3,3 | 5,0 | 3,7 | 22 s |
| G3 | ★ | no puede | 24/39 | 0 / 1 / 2 | 0 / 0 / 3 / 0 | 5,0 | 4,0 | 3,0 | 4,3 | 2,3 | 10 s |
| G4 | ★ | parte | 24/39 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 3,0 | 2,7 | 2,0 | 5,0 | 2,0 | 21 s |
| G5 |  | parte | 32/45 | 1 / 1 / 1 | 0 / 0 / 3 / 0 | 4,3 | 5,0 | 3,3 | 4,7 | 3,0 | 22 s |
| G6 | ★ | parte | 24/39 | 0 / 2 / 1 | 0 / 0 / 0 / 3 | 4,7 | 3,3 | 3,0 | 4,7 | 3,3 | 16 s |
| G7 |  | parte | 23/42 | 0 / 2 / 1 | 0 / 0 / 3 / 0 | 3,7 | 5,0 | 2,3 | 4,7 | 2,3 | 16 s |
| H1 |  | la hace | 42/48 | 0 / 2 / 1 | 1 / 1 / 1 / 0 | 4,7 | 3,0 | 3,7 | 5,0 | 3,3 | 12 s |
| H2 |  | la hace | 32/42 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 3,7 | 1,0 | 2,0 | 4,7 | 2,3 | 17 s |
| H3 |  | parte | 24/39 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 2,0 | 4,7 | 2,0 | 5,0 | 3,3 | 6 s |
| H4 |  | la hace | 35/42 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 3,7 | 2,3 | 3,0 | 5,0 | 2,7 | 10 s |
| H5 |  | parte | 33/45 | 0 / 0 / 3 | 0 / 0 / 3 / 0 | 4,0 | 2,3 | 2,0 | 4,3 | 2,0 | 6 s |

**Cómo leerla**

- **Ninguna de las 132 ejecuciones cumple todas sus verificaciones** (cada operación tiene entre 11 y 18, sobre lo que el usuario lee: cifra exacta, nombre, advertencia, no fingir un envío). En promedio pasan 66,9 %.
- **El juez las calificó «mala» en 80 (61 %), «mejorable» en 36 y «buena» en 16.** Frente a la IA anterior: «por debajo» en 109, «fuera de alcance» en 20 (operaciones que la app todavía no puede y lo dijo bien), «supera» en 1 (H1) e «iguala» en 2.
- **Lo mejor** (el juez dijo «buena» en 2 o 3 de 3): A3, C2, D6 y E6. Las verificaciones y el juez miden cosas distintas: A3 y D6 tienen los mejores veredictos y las verificaciones más bajas (50 % y 52 %), porque el juez lee la respuesta entera y las verificaciones piden el dato exacto.
- **Lo peor** («mala» en las 3 ejecuciones): A1, A6, A8, B3, C4, D1, D3, D4, D5, E3, E4, E5, F1, G4, H2, H3, H4 y H5. En 11 de esas 18 el juez da fricción de 2 o menos (A6, B3, D1, D3, D4, D5, E3, E4, E5, G4 y H5); contando también C5, son 12 operaciones con fricción de 2 o menos y 15 con utilidad de 2 o menos. Lo que el juez anota en ellas es, sobre todo, devolver el trabajo al usuario: ofrecer una consulta que podía hacer («¿reviso…?»), pedir un dato que ya tenía o dejar la preparación en sus manos.
- **Veracidad baja** (2,4 o menos): B5, D1, D4, E3, H2, H4 y H5: cifras o fechas que no salen de los datos, o un hecho supuesto (por ejemplo, Gmail conectado cuando la cobertura figura sin confirmar).
- **El juez con rúbrica tomaba la fecha real por la del mundo** en 8 de las 132 evaluaciones (H2 en las 3, D4 en 2, G6, E1 y H4 en 1): no recibía «ahora» (solo lo recibe el que compara con la IA anterior), así que decía que «hoy es 30» y marcaba un cálculo correcto como error. Ya lo recibe, con la misma frase que sigue el juez del turno (`COWORK_JUDGE_NOW_RULE`), y las veracidades de H2 y D4 de esta línea base se vuelven a medir con él: hasta entonces no son confiables.
- **Tiempo:** mediana de 12 segundos por respuesta, hasta 38 (D3).
- **Ruido:** la fricción del juez varía unos ±0,4 entre repeticiones; tres ejecuciones por operación bastan para ver diferencias grandes, no pequeñas.

**Qué mover primero, según esto**

1. **La fricción y la utilidad**: lo que más pesa es devolver el trabajo. Una sola regla de cierre y la revisión antes de mostrar ([#51](https://github.com/insigne123/ANTON.IA-supabase/pull/51)) apuntan ahí; la medida se repite con ella.
2. **La veracidad en cifras y fechas** (bloque H y D4): usar la hora del mundo y no suponer conexiones que la cobertura no confirma.
3. **Las brechas de capacidad de la sección siguiente** siguen como estaban: responder en el hilo, aprobar en lote, el tope de una empresa por día sumando correo y LinkedIn.

## Lo que ya se sabe sin el modelo

- **Cada operación tiene una respuesta buena que pasa todas sus verificaciones, y dos turnos vacíos que no:** el que responde sin mirar y devuelve el trabajo al usuario, y el que mira lo correcto y no dice nada. Cada uno falla al menos 3 verificaciones en cada operación.
- **Cada verificación importante se vio fallar.** Un turno bueno con una sola cosa peor (una cifra inventada, el nombre de otra empresa en un correo de corrección, un precio equivocado en el asunto, un «ya activé la cuenta», un enlace de invitación directa, una empresa excluida que vuelve al plan, las buenas noticias antes que las malas…) hace fallar la verificación que debe notarlo: 34 casos de ese tipo, 28 en las otras 24 y 6 en las 20 ★. Al armarlos, dos resultaron demasiado suaves y se reforzaron.
- **Todo eso son 173 pruebas sin red** (`scripts/cowork-axis-paquete.test.ts` y `scripts/cowork-axis-resto.test.ts`, que también prueba la selección de `--cases`). Es lo que hace que un fallo del banco signifique algo.
- **Brechas que el banco deja a la vista** (este documento no resuelve ninguna; la 1 la resuelve #53):
  1. **Si alguien de la misma empresa responde desde otro correo, la secuencia seguía** (la línea base de arriba se midió antes de que lo resolviera [#53](https://github.com/insigne123/ANTON.IA-supabase/pull/53), `docs/cowork-parar-empresa.md`). `inboundCandidates` (`src/lib/server/reply-sync.ts`) solo cuenta como respuesta al remitente exacto de la dirección a la que se escribió. Es la causa de G3 y afecta a toda la app, no solo a Cowork.
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
