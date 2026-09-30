# Cowork · nombre, empresa y oferta en cada turno (26 sep 2026)

## Corrección del 30 sep: la oferta de «Perfil» no llegaba

**Qué pasaba.** Un usuario con la oferta cargada en «Perfil» preguntó «¿qué puedes hacer tú?» y Cowork respondió «No veo … qué ofrece Yago», y le pidió la oferta.

**Por qué.** La oferta se guarda en un lugar y se buscaba en otro:
- «Perfil» guarda descripción, productos y servicios, propuesta de valor, pruebas y rubro en `profiles.signatures.profile_extended` (`src/lib/profile/profile-mappings.ts`).
- `profileOffer` buscaba columnas que no existen (`value_proposition`, `offer`) o que nadie escribe (`company_profile`).
- El cargador de Cowork excluía `signatures` a propósito.
- Resultado: `offer` llegaba nulo a Cowork, a `app.context`, a la Redactora y a la Jueza. Para la Jueza, además, toda frase sobre la oferta parecía inventada.
- Las pruebas no lo vieron: simulaban una columna `value_proposition`, y el corpus inyectaba la oferta ya armada.

**Qué cambia:**

| Pieza | Dónde |
|---|---|
| `profileOfferDetails` lee `profile_extended` con `normalizeSellerProfile`, el mismo lector de borradores e investigación. Recorta cada campo antes de pasarlo: el normalizador rechaza campos de más de 2.000 caracteres y «Perfil» no tiene tope | `src/lib/server/suplia-context.ts` |
| `profileOffer` usa primero «Perfil» (propuesta de valor, descripción si cabe y servicios, hasta 600 caracteres) y después los campos antiguos. Un nombre de empresa ya no cuenta como oferta | `src/lib/server/suplia-context.ts` |
| `coworkUserContextFromProfile` suma `services` (hasta 6), `proofPoints` (hasta 4) y `sector`, solo si existen. Nunca las firmas de correo, que viven en la misma columna | `src/lib/server/cowork/user-context.ts` |
| `profile.get` devuelve `commercial`: lo que guardó en «Perfil» | `src/lib/server/cowork/profile-read.ts` |
| `app.context` y el asistente Suplia reciben la misma oferta; Suplia ya no puede mostrar «[object Object]» | `suplia-context.ts`, `suplia-tools.ts` |
| La Jueza cuenta lo que trae `usuario` como dato consultado, y decir que falta un dato presente es veracidad 2 o menos. La Redactora y la Revisora aceptan `proofPoints` como respaldo | `src/lib/cowork/judge.ts`, `src/lib/cowork/writer.ts` |
| Receta «¿Qué puedes hacer?»: una frase que conecta Cowork con su oferta, tres puntos adaptados a ella, una o dos cifras de la cuenta y nunca «no veo», «no tienes» ni «no hay». Si la oferta falta de verdad, invita a guardarla en «Perfil» | `src/lib/cowork/agent-instructions.ts` |
| El corpus arma `userContext` desde una fila realista de `profiles`, con firma de Gmail, usando la misma función. Suma el caso de producción `que-puedes-hacer-tu` | `scripts/fixtures/cowork-conversation-corpus.ts` |

Sin migraciones ni flags. Lee las mismas tablas de antes.

## Qué cambia para el usuario

Cowork ya sabe quién eres y qué vendes desde el primer mensaje. Los correos, seguimientos y mensajes de LinkedIn salen firmados con tu nombre y hablan de tu oferta, sin gastar consultas en averiguarlo.

Antes, el modelo tenía que pedir `profile.get` (nombre y cargo) y `app.context` (oferta) antes de redactar. En la última corrida del corpus, 61 de 176 consultas (35 %) fueron esas dos. Con tres consultas por turno, eso dejaba menos espacio para lo que el usuario pidió: sus contactos, lo enviado o sus campañas.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| `loadCoworkUserContext`: lee nombre, cargo, empresa, dominio y oferta una vez por trabajo | `src/lib/server/cowork/user-context.ts` |
| La oferta sigue la misma regla que `app.context`: primero el perfil y después la configuración de la organización | `profileOffer` y `readOrganizationOffer`, ahora exportadas |
| `userContext` viaja en el contexto de cada decisión, con una instrucción corta; nulo si no se pudo leer | `coworkDecisionContext` en `src/lib/cowork/decision-context.ts` |
| El worker lo carga antes de la primera decisión | `src/lib/server/cowork/worker.ts` |
| Prompt: firma y oferta desde `userContext`; `profile.get` queda para las firmas por canal y antes de `profile.update` | `src/lib/cowork/agent-instructions.ts` |

**Qué no incluye.** Ni el correo del perfil ni las firmas HTML ni tokens. Si la lectura falla, `userContext` es nulo y el modelo vuelve a consultar `profile.get` y `app.context` como antes.

**Sin migraciones.** Lee las mismas tablas que `profile.get` y `app.context` (`profiles` y `antonia_workflow_settings`). No escribe nada.

**Recetas que cambian.**
- «Mándale un correo a…»: solo busca el grupo; el correo sale con la oferta y firmado.
- «No me respondió»: consulta lo enviado y la ficha del contacto, en vez de la firma y la oferta.
- «Revisa mi dominio»: usa el dominio de la empresa del perfil sin consultarlo.
- Toda redacción va firmada con el nombre del usuario, nunca solo con el nombre de la empresa.

**Ajustes que pidió la medición.** Con la oferta ya en contexto, el modelo empezó a saltarse pasos que antes hacía de pasada. Cada ajuste salió de leer las respuestas:
- **Secuencias:** redactaba sin consultar `message.context` (voz y términos prohibidos) y dejaba los 3 correos en el chat. Ahora hay una receta: consulta el contexto de redacción y entrega los correos en un documento. La indicación de campañas aclara que la oferta de `userContext` no reemplaza esa consulta.
- **Mensaje de LinkedIn:** escribía el texto sin buscar a la persona, así que no podía proponerlo, porque le faltaba su `leadId`. La regla 10 pide `leads.search` antes de `linkedin.message`.
- **«¿Qué puedes hacer?»:** a veces respondía en un párrafo y sin LinkedIn. Ahora pide una lista con los tres puntos, siempre los tres.
- **«Necesito más clientes»:** a veces proponía buscar prospectos habiendo contactos con correo sin contactar. Ahora la búsqueda queda como paso siguiente.

## Validación con el modelo real

Corpus de 25 casos (14 de producción y 11 de correo y LinkedIn), gpt-6-luna, bucle real, lecturas de fixture y 3 repeticiones. No se tocó producción, la base de datos ni proveedores.

La variación entre corridas del mismo código llega a 5 casos de 75. Por eso la comparación se hizo **el mismo día**, con la versión anterior (`860b2c4`, el PR del corpus de marketing con su último ajuste) y las mismas verificaciones.

| Corrida | Casos | Producción | Marketing | Verificaciones | Consultas por caso | Llamadas por caso | Cierre completo |
|---|---|---|---|---|---|---|---|
| Versión anterior, mismo día | 71/75 | 41/42 | 30/33 | 638/642 | 2,28 | 2,37 | 51/53 |
| Con `userContext` | 66/75 | 41/42 | 25/33 | 629/642 | 1,79 | 2,29 | 52/55 |
| Más secuencias y LinkedIn con `leadId` | 69/75 | 42/42 | 27/33 | 636/642 | 1,83 | 2,25 | 49/52 |
| **Más «qué puedes hacer» y «necesito clientes»** | **73/75** | **42/42** | **31/33** | **640/642** | **1,77** | **2,24** | **55/56** |

- **Consultas:** de 171 a 133 en las 75 corridas (22 % menos por caso). `profile.get` pasó de 20 consultas a 0 y `app.context` de 38 a 13; esta última sigue sirviendo para conexiones y volúmenes.
- **Las dos fallas finales:**
  - `mkt-resultado-campana`: el reintento de cierre no dejó la pregunta al final.
  - `mkt-busqueda-y-campana`: propuso la búsqueda sin explicación, y la nota armada con los criterios no dice que la campaña viene después.

  La versión anterior tuvo fallas del mismo tipo.
- **Verificaciones nuevas de firma:** el correo mejorado, el correo que se muestra para un grupo y el mensaje de LinkedIn deben llevar el nombre del perfil. La versión anterior también las pasa: firmaba porque consultaba el perfil. Ahora firma sin gastar esa consulta.
- **Tiempo por caso:** no lo comparé. La última corrida compartió máquina con otra evaluación y una compilación.

Cómo se corre:

```
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=300 --repeat=3 --output=eval.json
```

El resumen ahora informa `readsPerCase` y `callsPerCase`.

## Pendientes

- **Cierre:** la mayoría de las fallas que quedan, en esta versión y en la anterior, son del reintento de cierre. Pierde la pregunta final o las sugerencias. Un campo aparte para la pregunta final, que la interfaz muestre al final, lo haría estructural en vez de depender del texto.
- **Memoria aprobada:** el contexto compartido de la app ya lee memorias aprobadas del usuario (`suplia_memories`). Sumarlas a `userContext` daría preferencias estables, como el tono o lo que nunca ofrecer, sin consultas.
