# Cowork · evaluación con conversaciones reales (25 sep 2026)

## Resumen

Cowork entiende bien lo que se le pide y casi no inventa: comprensión 4,1 y veracidad 4,5 sobre 5. Donde falla es en lo útil y lo natural. Las respuestas se quedan en la limitación, no proponen el siguiente paso y hablan con términos internos. El hilo se detiene después de cada aprobación y algunos errores llegan como un mensaje genérico. Promedios de 24 turnos: utilidad 2,5, claridad 3,2 y fricción 2,3 (5 = sin fricción).

## Cómo se probó

- Cowork en producción, workspace GrupoExpro, modo con aprobaciones, desde el Chrome del propietario, el 25 sep 2026 entre 01:04 y 10:42 (hora de Chile).
- 12 conversaciones (13 hilos) y 24 turnos escritos como los escribiría un usuario: español informal, sin tildes y con seguimientos.
- Permisos acordados:
  - Búsquedas: libres.
  - Investigaciones: permitidas.
  - Enriquecimientos: hasta 10. Se usó 1.
  - Campañas: solo a nicogun123@gmail.com. No llegó a crearse; ver hallazgo 2.
- Acciones aprobadas:
  - 1 búsqueda (25 personas).
  - 1 contacto guardado (Carlos A., Minera Centinela).
  - 1 enriquecimiento, sin correo encontrado.
  - 1 investigación, con resultado insuficiente.
- Propuestas descartadas: 1 (repetir el enriquecimiento).
- Rúbrica de 1 a 5:
  - Comprensión.
  - Veracidad frente a los datos consultados.
  - Utilidad.
  - Claridad y formato.
  - Fricción, donde 5 significa sin fricción.
- Además se midió la latencia, y cada respuesta se pasó por el verificador `coworkAnswerIssues`, que revisa:
  - Jerga o códigos internos.
  - IDs.
  - Horas en UTC.
  - Largo antes de ir al punto.
  - Siguiente paso concreto.

## Resultados por conversación

| # | Pedido del usuario | Qué pasó | C·V·U·Cl·F | Espera total | Problema principal |
|---|---|---|---|---|---|
| 1 | «que tengo pendiente para hoy?» | Nada pendiente; advierte que no puede confirmar el buzón | 4·4·2·3·2 | 27 s | Callejón sin salida, jerga de «cobertura» |
| 1b | «que me recomiendas hacer hoy?» | Plan de 3 pasos para el usuario | 4·3·2·3·2 | 95 s | Repite lecturas; manda al usuario a revisar lo que Cowork puede leer |
| 2 | «como me ha ido esta semana? dame numeros» | 0 envíos, tasas no calculables | 5·5·3·4·3 | 32 s | Sin siguiente paso |
| 3 | «muestrame los ultimos contactos que guarde» | 13 contactos agrupados por fecha y empresa | 5·5·3·4·3 | 74 s | Cierre técnico («no indicó que estuviera truncada») |
| 3b | «que sabemos de la nehal de adecco? vale la pena?» | Sin correo ni investigación; pregunta qué vende el usuario | 4·4·2·3·2 | 90 s | No propone buscar el correo |
| 4 | «revisa si mi dominio esta bien configurado» | Pide «el dominio desnudo» | 4·5·1·2·1 | 112 s | Pregunta algo que podía deducir |
| 4b | «yago.cl» | MX y DKIM ok, SPF softfail, DMARC p=none | 5·5·4·4·4 | 27 s | Hora en UTC |
| 5 | «gerentes de operaciones de empresas mineras en antofagasta» | Propone búsqueda; 25 resultados | 5·5·4·4·4 | 112 s | 2 cargos y solo seniority manager |
| 5b | «guarda los 3 mas relevantes y buscales el correo» | Una sola tarjeta (guardar a 1) | 4·5·2·3·1 | 17 s | Sin explicación; el hilo se detiene tras aprobar |
| 6 | «investiga a carlos … quiero escribirle» | Propone buscar su correo | 5·5·4·4·3 | 80 s | No explica el plan |
| 6b | «no encontro correo? igual investigalo» | Vuelve a proponer buscar el correo | 2·3·1·3·1 | 50 s | Repite un efecto que ya falló e ignora la instrucción |
| 6c | «ya lo enriqueciste… investigalo igual» | Propone investigar | 4·5·4·4·2 | 169 s | Hizo falta corregirlo |
| 6d | «ya termino la investigacion?» | Investigación insuficiente | 5·5·2·4·2 | 61 s | Sin alternativa |
| 6e | «escribeme igual un correo…» | Correo genérico firmado «[Tu nombre]» | 4·5·2·3·3 | 54 s | No sabe qué vende el usuario |
| 7 | «informe … pa mandarselo a mi jefe» | Documento solo con métricas en cero | 4·4·2·3·3 | 113 s | Filtra «last_30_days»; ignora la actividad real |
| 8 | «campaña de prueba … nicogun123@gmail.com» | Pregunta la oferta | 4·4·3·4·3 | 64 s | Bug de la oferta |
| 8b | «ofrecemos ANTON.IA…» | Tres correos en el chat | 5·5·4·4·4 | 36 s | Debían ir en documento |
| 8c | «dale creala» | Pregunta Gmail u Outlook | 5·5·3·4·2 | 73 s | Pregunta con respuesta obvia |
| 8d | «con gmail» | **Falla**: «No se pudo completar la respuesta» | 1·–·1·1·1 | 129 s | Error opaco |
| 8e | (hilo nuevo) «arma la campaña…» | **Falla** igual | 2·–·1·1·1 | 52 s | Reproducible |
| 9 | «puedo mandarle correos a gente que no me dio permiso?» | Ley 19.628 y 21.719, bajas, sin asesoría legal | 5·4·4·4·4 | 97 s | Filtra «do_not_contact» |
| 10 | «ayudame a vender mas» | Consejo genérico; pregunta qué vende | 4·4·2·3·2 | 162 s | No usa los datos que consultó |
| 11 | «agendame una reunion con carlos…» | No puede; pregunta la zona horaria | 4·5·2·3·2 | 217 s | Pregunta para algo que no hará |
| 12 | «a quien le hago seguimiento por linkedin?» | «Completa el barrido» | 4·4·1·3·1 | 253 s | Jerga y sin alternativa |

**En números** (verificador automático sobre los 24 trabajos):
- 17 respuestas de texto: 15 (88 %) con algún problema, 11 (65 %) sin siguiente paso y 10 (59 %) con jerga o códigos internos.
- 2 fallos opacos, los dos del flujo de campaña.
- 0 de 4 continuaciones automáticas después de aprobar.
- Espera en cola: mediana 63 s, máximo 234 s. Procesamiento: mediana 19 s.

## Hallazgos y cambios

| # | Hallazgo | Cambio | Dónde |
|---|---|---|---|
| 1 | Después de aprobar, el hilo no continúa. `admitCoworkContinuation` descarta el error sin registrarlo | Registra el motivo (`[cowork] continuation not admitted`). Si la continuación no llega, la conversación ofrece «Seguir con el resultado» | `effects.ts`, `CoworkWorkspace.tsx` |
| 2 | Un error de validación termina el trabajo con un mensaje genérico. Ejemplo: el destinatario de la campaña no es un contacto guardado | Las decisiones inválidas y las propuestas que el servidor rechaza vuelven al modelo con el motivo, y el modelo corrige o explica. Si aun así falla, el mensaje dice la causa y qué hacer | `agent-loop.ts`, `failure-messages.ts`, `worker.ts` |
| 3 | La oferta de la empresa llegaba como «[object Object]» | `offerText` lee el perfil de empresa en JSON. `app.context` usa además los productos configurados de la organización | `suplia-context.ts`, `extended-reads.ts` |
| 4 | Respuestas sin siguiente paso, con jerga y advertencias repetidas | Nueva sección «Cómo responder» al inicio del prompt: hallazgo primero, lenguaje simple, una advertencia por hilo, siempre un siguiente paso, una pregunta como máximo | `agent-instructions.ts`, `commercial-behavior.ts` |
| 5 | Pide datos que puede consultar o que tienen un valor obvio | Reglas «No pidas lo que puedes consultar» y «usa el valor razonable». Recetas para pendientes, informe, dominio, investigar y «¿vale la pena?» | `agent-instructions.ts` |
| 6 | Repite lecturas y efectos ya hechos | El historial trae la hora de cada turno y las acciones ejecutadas con su resultado. Nueva regla de no repetir | `conversation-context.ts`, `agent-instructions.ts` |
| 7 | Las propuestas llegan sin explicación | El modelo escribe 1 a 3 frases junto a la propuesta. Se guardan como nota y se muestran antes de la tarjeta | `agent-loop.ts`, `contracts.ts`, `CoworkTurn.tsx` |
| 8 | Sin lecturas disponibles, solo podía responder | Con `mustAnswer` también puede proponer el paso obvio | `agent-instructions.ts` |
| 9 | Códigos internos en el texto (`last_30_days`, `do_not_contact`), correos con formato de código, IDs | Glosario en el contexto del modelo, más una pasada determinista que traduce códigos, quita IDs y formato de código | `decision-context.ts`, `answer-quality.ts` |
| 10 | Horas en UTC | Se agregan `clock.localNow` y `clock.timeZone` (America/Santiago, configurable con `COWORK_TIME_ZONE`) | `decision-context.ts` |
| 11 | Informe para jefatura pobre y correos múltiples en el chat | Formato de informe ejecutivo (Actividad, Resultados, Qué aprendimos, Próximos pasos). Dos o más borradores van en documento, con firma del perfil | `agent-instructions.ts` |
| 12 | Criterios de búsqueda estrechos | Variantes de cargo del rubro y sin restringir seniority salvo pedido | `agent-instructions.ts` |
| 13 | No se podía buscar un contacto guardado por correo | `leads.search` busca también en el correo | `lead-tools.ts` |
| 14 | IDs visibles en el mensaje del usuario («Enriquece a Jose (c517…)») | El ID viaja oculto y se quita al mostrar el mensaje y el título del hilo | `CoworkWorkspace.tsx`, `presentation.ts` |
| 15 | Mensajes fijos que prometían algo que no ocurría («se incorporará al retomarse») | Mensajes que dicen el siguiente paso real | `effects.ts`, `presentation.ts` |
| 16 | Espera de 1 a 4 min por turno (cola de un trabajo por minuto) | Ya resuelto en el parche anterior con `POST /api/cowork/wake` al enviar y aprobar | `wake/route.ts` |

## Cómo medir la mejora

- **Corpus de regresión:** `scripts/fixtures/cowork-conversation-corpus.ts`. Tiene 14 casos tomados de esta prueba, con resultados de herramientas copiados de producción (enmascarados) y las verificaciones que debe pasar cada turno.
- **Sin modelo:** `node --loader ./scripts/ts-test-loader.mjs --test scripts/cowork-conversation-corpus.test.ts`. Comprueba dos cosas contra el bucle real: que un turno ideal pasa todas las verificaciones y que las respuestas de producción las fallan. Está incluido en `scripts/verify-cowork.mjs`.
- **Con el modelo real:**

  ```
  OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=120 --repeat=2 --output=eval.json
  ```

  Para comparar prompts, córrelo con el mismo código y copia temporalmente `docs/cowork-prompts-originales/*.ts.txt` sobre los prompts. El informe JSON guarda también las decisiones que el esquema rechaza, con lo que el modelo mandó.
- **Después de desplegar:** repetir estas 12 conversaciones en producción y comparar con la tabla de arriba.

## Validación con el modelo real (segunda sesión, 25 sep 2026)

Se corrió el corpus con gpt-6-luna, el bucle real y las lecturas del corpus, dos repeticiones por caso. No se tocó producción, la base de datos ni proveedores. Las dos columnas usan el mismo código final y el mismo corpus; solo cambian los prompts.

| | Prompts originales | Prompts nuevos |
|---|---|---|
| Casos aprobados, repetición 1 | 1 de 14 | **13 de 14** |
| Casos aprobados, repetición 2 | 0 de 14 | **13 de 14** |
| Verificaciones aprobadas | 117 de 168 | **166 de 168** |
| Respuestas con problemas (verificador) | 23 de 28 | **1 de 28** |
| Trabajos que terminaron en error | 0 | 0 |
| Llamadas al modelo | 59 | 60 |
| Tokens de entrada por llamada (promedio) | 10.200 | 12.500 |

**Estabilidad.** El modelo varía entre corridas: el mismo prompt dio entre 25 y 28 de 28. Por eso se agregaron frenos deterministas en el bucle y se corrieron tres repeticiones más de la versión final: **42 de 42 casos y 252 de 252 verificaciones**. En total, con el código final aprueban 68 de 70 corridas (97 %). Las dos que fallan:
- `agendar-reunion`: propone «30 minutos en hora de Santiago», que es correcto, pero menciona «zona horaria» y la verificación léxica lo marca.
- `linkedin-seguimiento`: cierra con «Después puedo revisar…» en vez de una pregunta.

Las respuestas completas de estas corridas están en `docs/cowork-eval-2026-09-25/`: `prompts-originales.json`, `prompts-nuevos.json` y `prompts-nuevos-estabilidad.json`.

Cómo se llegó ahí. Después de cada cambio se leyeron las respuestas completas, no solo el PASS/FAIL:

| Medición | Casos | Verificaciones | Con problemas | Trabajos en error |
|---|---|---|---|---|
| Prompts originales con el código del zip | 0/28 | 119/168 | 22 | 0 |
| Prompts del zip, sin ajustes | 19/28 | 146/168 | 5 | 2 |
| Lecturas fijas, reintento, cierre y LinkedIn | 23/28 | 163/168 | 5 | 0 |
| Pregunta de cierre también con documento | 27/28 | 167/168 | 0 | 0 |
| Horas ya convertidas a Chile | 28/28 | 168/168 | 0 | 0 |
| Notas de propuesta sin pregunta | 25/28 | 165/168 | 2 | 0 |
| Jerga corregida en los resultados de las lecturas | 26/28 | 166/168 | 0 | 0 |
| Dos verificaciones corregidas y corpus alineado con producción | 25–28/28 | 163–168/168 | 0–1 | 0 |
| Frenos en el bucle (documento con propuesta, enriquecimiento repetido) | **26/28** + **42/42** | **166/168** + **252/252** | 1 + 0 | 0 |

**Qué se corrigió al leer las respuestas:**

| # | Qué pasaba | Cambio | Dónde |
|---|---|---|---|
| 1 | El informe para la jefatura fallaba siempre con «No pude completar esta respuesta». El modelo le pasaba un período («last_30_days», «este mes…») a `metrics.rates`, que no recibe entrada; el esquema lo rechazaba cuatro veces seguidas y se acababan los turnos. También puede pasar en producción | Las lecturas sin entrada ignoran el texto sobrante y una lectura pedida dos veces se hace una vez | `parallel-reads.ts`, `agent-loop.ts` |
| 2 | Volvía a proponer el enriquecimiento que ya había fallado; la nota decía «voy a volver a buscar el correo…» | La regla «sin correo, enriquece antes de investigar» ahora aplica solo si aún no se buscó en el hilo; si ya se buscó, investiga. El servidor lo permite: pide correo o un enriquecimiento ya intentado. Como el prompt no bastó en todas las corridas, el bucle rechaza además un enriquecimiento del mismo contacto que ya se ejecutó en el hilo. Después: investiga en 5 de 5 | `agent-instructions.ts`, `agent-loop.ts` |
| 3 | Propuso un lote de enriquecimiento con la nota «Dejé el informe ejecutivo listo», pero el informe se perdía: el modelo lo había escrito junto a la propuesta y las propuestas solo guardan la nota | Una propuesta que trae documento vuelve al modelo para entregar primero el documento y ofrecer la acción como pregunta. Después: el informe llega en 5 de 5 | `agent-loop.ts` |
| 4 | Cerraba con «puedo…», con una instrucción («guarda el correo», «revísalo con asesoría legal») o con una promesa, sobre todo al entregar un documento | Regla 4: termina con una pregunta cerrada que se responde con «sí», también con documento o cuando el paso depende del usuario | `agent-instructions.ts` |
| 5 | Junto a la tarjeta de aprobación preguntaba «¿Lo busco?». Si el usuario escribe «sí», la propuesta se descarta y se abre otro trabajo | La nota explica la propuesta sin cerrar con pregunta | `agent-instructions.ts` |
| 6 | «barrido», «cobertura», «denominador» y «registros de la app» venían de los propios resultados de las lecturas y de las instrucciones | Textos de LinkedIn, métricas, respuestas y audiencia reescritos en simple, con el botón real de la extensión («Sincronizar historial de LinkedIn») | `linkedin-reads.ts`, `metric-reads.ts`, `reply-reads.ts`, `metrics.ts`, prompts |
| 7 | Horas mal convertidas: «guardado el 25 sep, 10:26» para algo guardado a la 01:26 de Chile (2 de 6 corridas) | Cada fecha de los resultados y del historial llega con su lectura local ya convertida («25 sep 2026, 01:26»). Después: todas correctas | `decision-context.ts` |
| 8 | Revisaba el dominio sin decir cuál; «vender más» buscaba prospectos nuevos teniendo 256 contactos sin usar; en la campaña ofrecía «guardar» un correo, cosa que Cowork no puede hacer | Nombra el dominio revisado; parte por los contactos ya guardados; indica «Importar Leads» | `agent-instructions.ts` |

**Verificaciones del corpus corregidas.** Ninguna se debilitó; tenían falsos negativos:

- `recomendacion-hoy`, «usa datos de la cuenta»: solo aceptaba ciertas cifras con dígitos. Ahora acepta la cifra escrita («dos incidencias abiertas»), las cifras de audiencia (118 de RR. HH., 21 con correo) y los contactos por nombre, que también son datos de la cuenta.
- `agendar-reunion`: aceptaba «no puedo», pero no «Cowork no puede agendarla».
- Las lecturas del corpus se alinearon con lo que ahora devuelve producción:
  - Los textos de `metrics.rates` y `replies.attention`.
  - La forma de `linkedin.inbox` y `linkedin.followups`, más `linkedin.network`, que faltaba.
- Las respuestas de producción de esos casos siguen fallando por otras verificaciones: lecturas repetidas, zona horaria y jerga.

## Pruebas de uso en la app local

**Cómo se probó.** Se levantó la app completa sin tocar producción:
- Supabase local con las migraciones del repo y los datos de QA.
- Un usuario local con el correo del propietario, porque Cowork solo abre para esa cuenta, con siete contactos parecidos a los del corpus.
- La app en modo desarrollo, con el worker y gpt-6-luna.
- Un navegador automatizado que escribe como una persona, aprueba tarjetas y toma capturas.

Enriquecer falla a propósito porque en local no hay proveedor configurado. Se probó en escritorio y en móvil.

| # | Qué pasaba | Causa | Cambio |
|---|---|---|---|
| 1 | Después de aprobar, el hilo nunca continuaba (0 de 4 en producción) | En la base existen dos versiones de `cowork_admit_followup`: la de 6 parámetros y la de 7 con `p_reset_depth` por defecto. La continuación no nombraba el séptimo y PostgREST respondía PGRST203 («no puede elegir la función»). Lo mostró el registro `[cowork] continuation not admitted` | La continuación nombra `p_reset_depth: false` (`continuation.ts`). En local ahora continúa sola |
| 2 | Si una acción aprobada fallaba, el hilo terminaba en el error técnico («No se pudo preparar el enriquecimiento. No se consultó al proveedor.») | Solo la ejecución de código reanudaba el hilo | Toda acción fallida reanuda el hilo para explicarla y proponer otra salida; nada se reintenta solo (`effects.ts`, `presentation.ts`). En local respondió: «No repetiré ese intento; propongo investigar a Nehal…» con su tarjeta |
| 3 | Lo escrito en los primeros segundos se borraba y Enter no hacía nada: es el «primer envío se perdió» de la evaluación | `AuthContext` envuelve la app en un `Fragment` con clave usuario:workspace. Al resolverse la sesión (1 a 2 s), la página completa se vuelve a montar | El borrador se guarda en la pestaña por usuario y vuelve con el foco al final; se borra al enviar (`CoworkWorkspace.tsx`). Prueba A/B en el navegador: antes quedaba vacío y Enter no enviaba; ahora se conserva y se envía |
| 4 | Un mensaje en espera que no se podía guardar desaparecía | La ruta del mensaje en espera no devolvía el texto al fallar | Vuelve al cuadro |
| 5 | La nota de la propuesta preguntaba «¿Lo busco?» | Ver punto 5 de la tabla anterior | Prompt |

También se revisó el informe para la jefatura: el documento se abre solo en el panel, con tablas y descarga. Queda un detalle: una fila dice «Contactos guardados observados».

**Verificaciones:**
- `npm run test:unit`: 1670 de 1670.
- `npx tsc --noEmit` y lint de lo tocado: sin errores.
- `node scripts/verify-cowork.mjs` pasa completo por primera vez. Se actualizó `test-cowork-start-research.mjs`: su mock no implementaba `.filter` y seguía describiendo la regla anterior; ahora cubre «sin correo, basta un enriquecimiento ya intentado».
- Tests nuevos o ampliados:
  - `test-cowork-draft.mjs`: el borrador sobrevive al remontaje, se borra al enviar y no pasa a otra cuenta.
  - `test-cowork-effects.mjs`: argumento explícito y continuación tras una acción fallida.
  - `agent-loop.test.ts`: documento junto a una propuesta, enriquecimiento repetido y lecturas fijas con período.
  - `continuation.test.ts`, `parallel-reads.test.ts`, `decision-context.test.ts` y `presentation.test.ts`.
- Cada test nuevo se comprobó contra el código anterior: ahí falla.

## Límites y pendientes

- **Alcance de la validación.** Son 14 casos con lecturas de un solo workspace, y las verificaciones son léxicas. El modelo varía entre corridas; aun así, a veces cierra con «puedo…» en vez de una pregunta. Leyendo las respuestas quedaron dos detalles que no detectan:
  - En una corrida de «vender más», la pregunta final se contradice: ofrece buscar el correo de quien ya lo tiene.
  - En la campaña a un correo no guardado, la pregunta de cierre suena forzada.
- **Producción sin tocar.** Después del deploy:
  - Repetir las 12 conversaciones.
  - Confirmar que no aparecen nuevos `[cowork] continuation not admitted` con `PGRST203`.
- **Función duplicada en la base.** Para confirmar que producción tiene las dos versiones: `select oid::regprocedure from pg_proc where proname = 'cowork_admit_followup';`. La corrección de código funciona en ambos casos. Borrar la versión de 6 parámetros sería una migración forward-only aparte, con aprobación.
- **Remontaje global.** El `Fragment` con clave de `AuthContext` afecta todas las pantallas: consultas iniciales duplicadas y texto perdido si se escribe apenas carga. Cowork ya está protegido. La corrección de fondo exige revisar qué componentes dependen de ese remontaje.
- **Texto escrito antes de que cargue el JavaScript.** Se pierde igual, porque React aún no lo ve. En producción es poco probable.
- **Avatar de Cowork.** En local se ve roto: existen `public/icon.png` y `src/app/icon.png`, y Next.js responde 500 en `/icon.png`. Además pesa 1,6 MB para mostrarse a 26 px. Falta verificar en producción.
- **Entorno local.** `npm run db:start` y `test:reset` fallan en una base nueva por dos razones:
  - Las seis migraciones de datos de GrupoExpro (`20260906164000` a `20260906164500`).
  - El `drop table` sin `if exists` de `20260923010517`.
  
  Para estas pruebas se usó una copia sin ellas, fuera del repo.
- **Prompt.** El principal creció unos 1,6 KB (≈400 tokens). La entrada media por llamada subió de 10.200 a 12.500 tokens por las lecturas locales de fechas y por más consultas útiles.
- **Campaña de prueba.** Solo puede ir a contactos guardados: hay que guardar nicogun123@gmail.com, por ejemplo con Importar Leads, antes de crearla.
- **Guardar varios contactos en una sola aprobación.** Necesitaría un efecto nuevo con migración. Por ahora se explica el plan y se avanza de a uno; la tabla de resultados ya permite guardar por fila.
- **Lo que quedó en GrupoExpro por las pruebas de la primera sesión:**
  - Los hilos de prueba en el historial de Cowork del propietario.
  - Carlos A. (Minera Centinela) guardado.
  - 1 enriquecimiento sin resultado.
  - 1 investigación.
  - 1 búsqueda externa.
