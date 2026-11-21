# «Contacto del día»: un contacto listo, tres días a la semana

**Fecha:** 20 de octubre de 2026.

Es una idea del dueño para que los usuarios vuelvan. Primero eran cinco contactos dos veces por semana; el mismo día lo cambió a **un contacto por día, tres días a la semana**: martes, miércoles y viernes.

- **El contacto trae:**
  - su correo, conseguido con Apify y no con los créditos de Apollo;
  - por qué se lo recomendamos: qué calza con su cliente ideal y por qué le sirve para lo que vende;
  - quién es la persona y qué hace su empresa;
  - un primer correo sugerido.
- **Llega por correo**, en el aviso de la mañana:
  - en el cuerpo, un bloque con el contacto (nombre, cargo y empresa, por qué calza) y su botón «Ver y guardar»;
  - adjunto, un PDF con el porqué, la persona, su empresa, cómo abordarla y el borrador;
  - un enlace a «Buscar prospectos», donde se ve la búsqueda que lo encontró, con el contacto ya listo.
- **Guardarlo no gasta créditos:** ya viene con correo.
- **Sin correo, desde «Hoy»:** quien no lo recibe por correo lo abre en «Hoy», y se prepara en ese momento.

## Desde el 3 de noviembre: con Apollo, sin costo de búsqueda, y con tres seguimientos

Idea del dueño: «que se use Apollo para esto, buscar un lead no nos tiene costo». La idea es que el usuario vea lo fácil y directo que es buscar un lead y contactarlo.

- **La búsqueda es la gratuita de Apollo** (`searchApolloDrops`, `/mixed_people/api_search`), con el cliente ideal de cada persona: cargos, rubros, lugares y tamaño.
  - Trae hasta 100 personas, no gasta créditos ni el presupuesto del mes de Apify, y no deja nada en la bóveda: Apollo no da el correo en la búsqueda.
  - Solo quedan las personas que Apollo dice que tienen correo (`has_email`).
  - Apollo muestra el apellido oculto («Ni***o»). La pantalla, el correo y el PDF muestran «Daniel N.» hasta que se busca su correo.
- **Calce sin dato que la búsqueda sí filtró** (`searchedFit`): Apollo suele no decir el rubro, el tamaño ni el lugar de la empresa. Si la búsqueda filtró por ellos, el contacto está dentro y la tabla dice «Dentro de lo que buscas».
  - El rubro cuenta solo si Apollo lo reconoce por su etiqueta («Retail», «Construcción»). Un rubro que pasa como palabra clave («servicios transitorios») sigue diciendo «Sin dato».
  - «Por qué calza» ya no nombra un rubro o lugar que la tabla dice que no calza.
- **Un correo y tres seguimientos:** la Redactora escribe una secuencia de 4 correos (`DROP_SEQUENCE_STEPS`), con la misma revisión que en Cowork: el primero el día 1 y los seguimientos los días 3, 7 y 11. Se ven plegados bajo el primer correo («Si no responde: 3 seguimientos»), cada uno con «Copiar», y van en el PDF.
- **«Enriquecer y guardar · 1 crédito»:**
  1. El contacto se guarda como contacto guardado (`keepDropLead`, igual que Cowork guarda un resultado). El bloqueo del equipo sigue aplicando.
  2. Se busca su correo como el de cualquier contacto guardado (`completeSavedContacts`), con el cupo diario y la cuota de Apollo de la organización.
  3. Queda en «Por escribir» con su nombre real. El porqué, el correo y los seguimientos quedan en `data.leadDrop` (`linkDropLead`).
  4. Desde ahí, «Investigar y escribirle» lleva al envío revisado desde ANTON.IA, donde se programan los seguimientos.
  - Si Apollo no encuentra el correo, lo dice y se puede intentar de nuevo.
- **Escribir tarda más:** son 4 correos por contacto. La corrida de la mañana escribe 4 a la vez y empieza una ronda solo si quedan 2 minutos, lo que da unos 48 por mañana para unos 38 contactos.
- **Para volver a Leads Finder:** `LEAD_DROPS_PROVIDER=apify`. Vuelven el correo en la búsqueda, el guardado sin créditos y el presupuesto `LEAD_DROPS_MONTHLY_USD`.
- **En producción desde el 10 de noviembre.** Hasta ese día `apphosting.yaml` tenía `LEAD_DROPS_PROVIDER=apify` y los contactos seguían saliendo de Leads Finder. Se quitó por decisión del dueño («que salga de Apollo, pero que no se gasten créditos de enriquecimiento: mandémosle al usuario un lead sin enriquecer»), el mismo día en que la cuenta gratis de Apify quedó sin saldo hasta el 3 de diciembre.
  - Preparar y enviar el contacto no gasta nada: ni créditos de Apollo ni saldo de Apify. El contacto llega sin correo y con el apellido oculto.
  - El único crédito es el de la persona, y solo si pulsa «Enriquecer y guardar · 1 crédito».
  - Con Leads Finder, el 10 de noviembre quedaron 2 personas sin contacto por «Se acabó el presupuesto del mes». Con Apollo ese presupuesto no aplica.

## Desde el 12 de noviembre: cada equipo con su plan, y un buscador con IA para quien recibe varios

Pedido del dueño: que un equipo reciba **6 contactos recomendados al día, de lunes a viernes**, y que el sistema los busque tan bien que el usuario «no tenga que ni pensar, que solo contacte».

- **El plan es de cada equipo** (migración `20261112200000_organizations_lead_drop_plan.sql`):
  - `organizations.lead_drop_size`: cuántos contactos recibe cada persona, de 1 a 10. Por defecto, 1.
  - `organizations.lead_drop_weekdays`: qué días, de 1 (lunes) a 5 (viernes). Por defecto, martes, miércoles y viernes.
  - Es parte de lo que el equipo contrató. Lo cambian el servidor y quien opera la base de datos; un disparador (`guard_organization_lead_drop_plan_v1`) rechaza el cambio de una persona del equipo, aunque sea dueña.
  - Para dar a un equipo 6 contactos cada día hábil: `update organizations set lead_drop_size = 6, lead_drop_weekdays = '{1,2,3,4,5}' where id = '…'`.
- **Las tareas programadas corren de lunes a viernes** y cada equipo recibe solo en sus días:
  - `leadDropsTick` prepara los contactos de los equipos que tienen ese día en su plan. Un día que no está en el plan de nadie no hace nada.
  - Quien está en dos equipos recibe en el más grande de los que tienen contactos ese día.
  - `dailyAlertsTick` también corre el lunes, que sigue siendo del informe semanal: ese día solo escribe a los equipos con contactos el lunes, y solo cuando sus contactos están listos. Mientras no lo están no guarda nada, así la corrida siguiente lo intenta de nuevo.
- **Con un contacto al día nada cambia.** El buscador con IA se usa solo cuando el plan pide más de uno (`plan.size > 1`) y la búsqueda es la de Apollo.

### Desde el 15 de noviembre: plan por persona y búsqueda más profunda

Pedido del dueño: dar 6 contactos a algunas personas de un equipo (las que entran pero usan poco), sin cambiar al resto, y que los recomendados no se acaben pronto.

- **Plan por persona** (migración `20261115120000_lead_drop_person_plans.sql`, tabla `lead_drop_person_plans`):
  - Una fila por persona y equipo: `lead_drop_size` (1 a 10), `lead_drop_weekdays` (vacío = los días del equipo) y `starts_on`.
  - Quien tiene fila recibe lo que dice su fila; el resto del equipo sigue con el plan del equipo.
  - `starts_on` reinicia la cuenta del descanso: lo que la persona dejó sin abrir antes de esa fecha no la deja fuera.
  - Solo la escriben el servidor y quien opera la base de datos (sin acceso para `anon` ni `authenticated`).
  - Para dar 6 a una persona: `insert into lead_drop_person_plans (organization_id, user_id, lead_drop_size) values ('…', '…', 6)`. Para quitarlo, borrar la fila.
  - En una misma corrida, las personas de un equipo se buscan por separado según cuántos reciben: primero las de más contactos, con el buscador con IA.
- **Nadie recibe a una persona que el equipo ya tiene.** La exclusión es de todo el equipo, no de cada persona: leads guardados, enriquecidos, contactados y todo lo recomendado a cualquier compañero en los últimos 180 días.
  - Esa lista se lee completa, de a mil filas: la API responde como máximo 1.000 por consulta, y antes un equipo con más de mil leads habría quedado con la lista cortada sin aviso.
- **Búsqueda más profunda** (`apolloDropDepth`): Apollo responde cada búsqueda en el mismo orden, así que un equipo que ya tenía a los primeros se quedaba sin gente nueva aunque hubiera miles más abajo. Ahora la primera búsqueda del buscador pide 300 personas más tantas como el equipo ya tiene, de a cien, hasta 1.000 (diez páginas, sin costo).
  - Medido el 15 de noviembre para el cliente de GrupoExpro en Chile: unas 25.700 personas en Apollo, 12.700 con correo verificado; el equipo tenía cerca de 1.000 y la búsqueda leía solo las primeras 300.
  - Con 6 personas a 6 contactos, tres días a la semana, se usan unos 470 al mes.
  - Una búsqueda más larga toma más tiempo: con varias búsquedas por hacer, la corrida no empieza otra si le quedan menos de 90 segundos. Esas personas quedan sin fila y las planifica la corrida siguiente.
  - Las corridas de la mañana parten a las 05:00 de Chile en vez de las 06:00 (nueve en vez de seis), para que alcance el tiempo de investigar y escribir a todos antes del correo de las 08:00.

### Desde el 15 de noviembre: «Para llamar», el teléfono y el guion de cada contacto

Pedido del dueño: «necesito que puedan también enriquecer con teléfono y que les hagamos un guion personalizado, con un listado de puntos de interés para el lead».

- **El teléfono, con el correo o después.** La tarjeta de cada contacto (`DropContactCard`) mantiene «Enriquecer · 1 crédito» como botón. Debajo, la opción secundaria «O con su teléfono · 8 créditos» busca el correo y el móvil en la misma búsqueda: 8 créditos por ambos, porque la búsqueda del móvil ya trae el correo. A un contacto ya enriquecido se le busca después, en «Para llamar» → «Buscar su teléfono · 8 créditos», que se suman al crédito del correo.
  - Es la misma búsqueda del resto de la app (`/api/opportunities/enrich-apollo`): mismo cupo diario, mismo reparto de créditos del equipo y mismo registro. El costo sale de la regla de la app (`apolloAllocationCost`).
  - El proveedor responde el móvil en minutos. Mientras tanto la tarjeta dice «Buscando su teléfono» y vuelve a leer sola cada 20 segundos, hasta 4 minutos; «Actualizar» lo hace a mano.
  - Un segundo toque mientras la búsqueda está en camino no pregunta ni cobra de nuevo. Una búsqueda que terminó sin teléfono lo dice, y la siguiente es otra operación.
- **El número no se guarda en el contacto del día.** Se lee cada vez desde «Por escribir» (`enriched_leads`), solo de la propia persona (`withDropPhones`, `dropPhoneOf`).
- **Con el número:** «Llamar» y «WhatsApp».
  - Dentro de la app son los botones de siempre (`ContactActions`): registran el intento y después preguntan cómo salió (`contact_calls`).
  - Desde la página del correo, sin sesión, son enlaces simples (`tel:` y `wa.me`), sin ese registro.
  - El WhatsApp se abre con el primer mensaje del guion ya escrito; la persona lo revisa y lo envía desde su propio WhatsApp.
- **El guion de llamada** se prepara al pedirlo («Preparar guion de llamada»), una sola vez, y queda guardado con el contacto (`item.call`); «Otra versión» pide otro. No usa créditos.
  - Trae: puntos de interés de esa persona (de 2 a 5), qué decir al contestar, de 2 a 4 preguntas, hasta 3 objeciones con su respuesta, el mensaje si no contesta y el primer WhatsApp.
  - Sale de lo que el contacto del día ya sabe: cargo, empresa, la investigación corta (qué hace la empresa, la novedad, por qué calza, qué le importa a ese cargo), las razones de la recomendación y el primer correo de su campaña. El modelo no puede inventar datos: lo que no se sabe se plantea como pregunta.
  - Modelo: `LEAD_DROPS_CALL_MODEL`, o el de la investigación (`LEAD_DROPS_RESEARCH_MODEL`), Haiku por defecto.
- **Dónde funciona:** en la página del contacto, en «Tus contactos de hoy» de «Hoy» y en la página que abren los correos, con Gmail y con Outlook por igual (la tarjeta es la misma).
- **Código:** `src/lib/lead-drop-call.ts` (reglas, contrato del guion y lo que se le pide al modelo), `src/lib/server/lead-drop-call.ts` (lectura del teléfono, búsqueda y guion), acciones `phone` y `script` en `/api/lead-drops/[id]` y `/api/lead-drops/link`. Sin cambios de esquema.
- **Pruebas:** `src/lib/lead-drop-call.test.ts`, `src/lib/server/lead-drop-call.test.ts`, y los casos de «Para llamar» en `drop-contact-card.test.ts`, `lead-drop-flow-ui.test.ts` y `lead-drop-mail.test.ts`. Recorrido: `contactos-para-llamar` (escritorio y móvil).

### El buscador con IA (`src/lib/server/lead-drop-finder.ts`)

Con un contacto al día alcanzaba con tomar al primero cuyo cargo tuviera las palabras del cliente ideal. Con seis al día eso se queda sin gente en una semana y no aprende. El buscador hace cuatro cosas, todas con la búsqueda gratuita de Apollo y un modelo chico (Claude Haiku):

1. **Pregunta de más formas.** Además de los cargos del cliente ideal (hasta 300 personas), busca esos cargos como la gente los escribe («HR Manager», «Gerenta de Personas») y las palabras de su área como cargo («personas», «rrhh»), 100 de cada una. Si aun así quedan pocas personas nuevas, repite solo con cargos y lugares. Son de 3 a 8 llamadas gratis por grupo de personas con el mismo cliente ideal.
2. **Lee cada cargo por lo que significa** (`classifyTitles`, el mismo clasificador de la búsqueda): mismo cargo, cargo parecido, cargo vecino o sin relación. Quien no tiene relación no se ofrece.
3. **Pone dos notas a cada candidato**, de 0 a 10: cuánto decide ese cargo la compra de lo que vende el equipo, y cuánto necesitaría esa empresa lo que vende. El modelo recibe:
   - lo que vende el equipo: la oferta, los servicios, los diferenciadores y el rubro de «Perfil» y de la «Ficha de la empresa»;
   - el cliente ideal: cargos, rubros, lugares y tamaños;
   - lo que el equipo hizo con contactos anteriores: los que guardó o marcó «me sirve» y los que marcó «no me sirve», con su motivo (`dropLessons`);
   - de cada candidato, solo cargo, nivel, área, empresa, rubro, tamaño, lugar y descripción. Nunca el nombre.
   El modelo lee el cargo completo y juzga la función real, no las palabras que comparte con el cliente ideal. Una nota de 2 o menos en cargo o en empresa deja fuera a la persona.
   - **Medido el 12 de noviembre** con una página real de Apollo (32 personas, cargos de seguridad y operaciones en empresas chilenas de 1.001 a 5.000 personas) para un equipo que vende servicios de emergencia a minería, energía y forestal:
     - arriba quedaron «Gerente HSE» y «Superintendente de Seguridad» de empresas de gas, minería y equipos mineros (93 a 97 puntos);
     - quedaron fuera 10: «Gerente de Operaciones TI», «Gerente de Operaciones Financieras», «Gerente de Operaciones Inmobiliarias» y otros que la búsqueda por palabras ofrecía como calce exacto;
     - como exploración salieron un jefe de mantención de una planta de celulosa y un encargado de protección industrial de un puerto.
     - Con la primera versión de las instrucciones (notas de 0 a 5) el «Gerente de Operaciones Financieras» de una eléctrica empataba en el primer lugar: por eso la escala es de 0 a 10 y las instrucciones piden juzgar la función.
4. **Elige con cupos para explorar** (`pickRankedDrops`): los mejores del cliente ideal y, en los últimos cupos, los mejores cargos vecinos, para aprender si también sirven. De 6 contactos, 4 son del cliente ideal y 2 son exploración (`exploreSlots`: 3 de cada 10). Se mantiene lo de siempre: solo personas con correo, nadie que el equipo ya tenga o haya recibido, uno por empresa.

- **Un cargo vecino se dice como lo que es:** «Su cargo es vecino a los que buscas: te lo proponemos para probar si también te sirve». En la tabla de calce, su cargo dice «En parte».
- **Si el modelo falla**, quedan los cargos que se reconocen por sus palabras, y quien se queda sin nadie recibe los contactos como un equipo de un contacto.
- **Escribir tarda más:** un envío de 6 contactos son 24 correos. La corrida escribe los 6 a la vez y junta en una ronda hasta 12 contactos (8 hasta el 18 de noviembre).
- **Modelo:** `LEAD_DROPS_FINDER_MODEL` (por defecto, el de `LEAD_DROPS_RESEARCH_MODEL` o Haiku 5.5).

### La investigación corta de cada contacto (`src/lib/server/lead-drop-research.ts`)

La búsqueda gratuita de Apollo trae nombre, cargo y empresa, y nada más: ni rubro, ni sitio, ni descripción. Por eso los contactos llegaban sin una palabra sobre la empresa y sus correos se leían iguales para todos («Cuando una emergencia detiene una operación…»). Desde el 12 de noviembre, antes de escribir, cada contacto se investiga:

1. **Dos búsquedas en la web** (Serper): la empresa, para encontrar su sitio y qué hace, y sus noticias. Se busca por el nombre sin su forma legal («Minera Andina», no «Minera Andina S.A.»).
2. **La portada de su sitio**, cuando el sitio se reconoce por el nombre de la empresa entre los resultados. Directorios, redes sociales y diarios no cuentan como sitio.
3. **Cinco líneas** que escribe un modelo chico (Claude Haiku), cada una de una frase, pensadas para leerse en un correo:
   - qué hace la empresa;
   - qué le está pasando ahora, con la fecha y el medio;
   - por qué le sirve lo que vende el equipo;
   - qué le importa a ese cargo;
   - cómo abrir la conversación.

- **La fecha y el medio de la noticia son los de la búsqueda, nunca del modelo.** El modelo solo elige cuál noticia sirve y dice qué pasó.
- **Una noticia cuenta solo si habla de la empresa:** su nombre de una palabra, sus dos primeras palabras juntas o una primera palabra propia. «Cumbre andina de turismo» no es de Minera Andina. Las de más de 18 meses se descartan.
- **Una línea con una cifra que la evidencia no trae se descarta**, igual que en las razones.
- **Los correos usan lo encontrado:** qué hace la empresa y la noticia van como hechos de la empresa a la Redactora, y cómo abrir y por qué le sirve van como su ángulo. Las razones (`adviseOn`) también leen lo encontrado.
- **Queda guardado** en `brief` de cada contacto. Si se reconoció el sitio y la búsqueda no lo traía, también quedan `domain` y `website`.
- **Sin evidencia no hay investigación** y el contacto sigue como antes. Una búsqueda o un modelo que falla nunca detiene el envío.
- **Costo:** dos búsquedas de Serper, una página y una llamada a Haiku por contacto; unos 3 a 5 segundos, todos los contactos de un envío a la vez.
- **Apagar:** `LEAD_DROPS_BRIEF=off`.
- **Medido el 12 de noviembre** con noticias públicas reales de una distribuidora de gas y un equipo que vende servicios de emergencia: eligió la noticia de su planta nueva de biogás (con su fecha y su medio), y propuso abrir preguntando cómo preparan la respuesta ante emergencias en esa planta.

### La campaña lista: en el correo y en la página (varios contactos al día)

Pedido del dueño: «que le entreguemos toda la campaña lista para aprobar», que pueda «enriquecer desde el mail», y una página donde revise por qué se le sugiere cada contacto, vea la investigación y la campaña, la modifique y la apruebe, con Gmail y con Outlook.

**El correo de la mañana**, cuando el envío trae más de un contacto (`campaignEmailSection` en `src/lib/lead-drops.ts`), tiene una tarjeta por contacto:

- nombre, cargo y empresa; los cargos vecinos dicen «para explorar»;
- **Por qué:** por qué le sirve lo que vende el equipo (de la investigación; si no hay, la primera razón);
- **Ahora:** la novedad de la empresa, con su medio y su fecha;
- **Cómo abrir**;
- **Campaña lista:** el asunto y las primeras líneas del primer correo, como las leería el contacto (con su nombre en vez de `{{nombre}}`), y los días en que saldrían los seguimientos si se aprueba hoy;
- un botón por contacto, según en qué paso está:
  - «Enriquecer y revisar · 1 crédito», si todavía no tiene correo;
  - «Revisar y aprobar», si ya lo tiene;
  - «Ver su campaña», si ya está aprobada.
- Los correos completos van en el PDF adjunto. Con un solo contacto el correo es el de antes.

**El botón del correo** lleva a la tarjeta de ese contacto (`?c=<id>`). Desde el 13 de noviembre abre la página que no pide sesión (más abajo, «todo desde el correo»); lo que sigue es cómo funciona cuando el servidor no puede firmar enlaces y el botón abre la app. Si todavía no tiene correo, el enlace además pide buscarlo al llegar (`&enriquecer=1`).

- La búsqueda es la misma que hace el botón de la página, con la sesión de la persona y para un contacto suyo. Un lector de correo que sigue el enlace sin sesión no gasta nada.
- Al llegar, la dirección pierde esos parámetros: volver a la página no pide otra búsqueda.

**La página** (`/search/contactos/<id>`) muestra una tarjeta por contacto (`DropContactCard`), con un paso a la vez:

1. **Por qué te lo recomendamos:** dos o tres razones en lenguaje simple. Primero lo que dice la investigación (por qué le sirve, qué le importa a ese cargo), después las razones de la oferta, y al final qué calzó con el cliente ideal.
2. **Sobre la empresa:** qué hace, la novedad con enlace a su fuente, y su sitio.
3. **Cómo abrir.**
4. **Campaña lista:** plegada, dice cuántos correos son y entre qué días. Al abrirla, cada correo con su día; los seguimientos dicen «si no responde».
   - **«Editar los correos»** cambia asuntos y textos ahí mismo (`editDropEmails`). No cambian cuántos son ni sus días.
5. **Cómo calza con tu cliente ideal:** plegado, criterio por criterio.
6. **«¿Te sirve este contacto?»:** «Me sirve» o «No me sirve». El segundo pregunta el motivo con un clic («El cargo no decide», «La empresa no calza», «Ya lo conozco», «Otro motivo»). Queda en `feedback` del contacto y el buscador lo usa en los envíos siguientes.

- **La acción principal cambia con el estado:** «Enriquecer · 1 crédito» → «Aprobar y programar» → «Ver la campaña».

**«Aprobar y programar»** (`approveDropCampaign` en `src/lib/server/lead-drop-campaign.ts`) crea una campaña de una persona en «Campañas» y la activa:

- **Desde qué correo:** el que la persona eligió en «Conexiones», o el único conectado. Funciona igual con Gmail y con Outlook. Sin ninguno conectado, lo dice y no crea nada.
- **Cuándo sale cada correo:** el primero con la siguiente pasada de envíos (cada 5 minutos); cada seguimiento, tantos días después del anterior como dijo la Redactora (días 1, 3, 7 y 11 → esperas de 2, 4 y 4 días).
  - **Ningún seguimiento cae en fin de semana:** el que tocaría un sábado o un domingo pasa al lunes, y el siguiente mantiene su distancia desde ahí (`dropCampaignMessages` con la fecha de inicio). Aprobada un viernes 13, los seguimientos salen el lunes 16, el viernes 20 y el martes 24.
  - Las fechas que muestran el correo de la mañana, la tarjeta y el correo «Campaña lista» se calculan igual, contando desde el día en que se miran; las definitivas son las del día en que se aprueba.
- **Se detiene** ante respuesta, baja o rebote, como toda campaña. Desde «Campañas» se pausa o se cambia.
- **`{{nombre}}`, `{{empresa}}` y `{{cargo}}`** se reemplazan por los datos del contacto ya enriquecido.
- **Pedirla dos veces no la duplica:** el mismo contacto del mismo envío es siempre la misma campaña.
- **Lo que la campaña rechaza se dice tal cual:** un contacto ya contactado, dado de baja o de un dominio excluido.
- **Requisitos:** el contacto en «Por escribir» con su correo (después de «Enriquecer») y `BULK_CAMPAIGNS_ENABLED=true`.

**El correo «Campaña lista para aprobar»** (`mailDropCampaign` en `src/lib/server/lead-drop-campaign.ts`, texto en `src/lib/lead-drop-campaign-email.ts`). Pedido del dueño: que al enriquecer desde el correo «le llegue el mail de contacto inicial junto con los mails que se van a mandar de seguimiento».

- **Cuándo sale:** apenas se encuentra el correo del contacto («Enriquecer», desde el correo de la mañana o desde la página). Una vez por contacto (`campaignMailedAt`), y solo en envíos de varios contactos, que es donde la tarjeta tiene «Aprobar y programar».
- **Qué trae:** el correo encontrado, desde qué buzón saldría la campaña (o que falta conectar uno), el primer correo y cada seguimiento completos, como los leería el contacto, con el día en que saldría cada uno, y el botón «Revisar y aprobar».
- **No aprueba nada por sí solo:** el botón lleva a la tarjeta, donde está «Aprobar y programar». Un lector de correo que abre enlaces no puede echar a andar una campaña.
- **A quién no le llega:** a quien apagó los correos de la app en «Tu semana», no tiene dirección o tiene una de prueba. Un envío que falla no se reintenta solo; la campaña sigue en la página.
- **Va después de responder** (`after` en la ruta): enriquecer no espera al correo.
- **Apagar:** `LEAD_DROPS_CAMPAIGN_EMAIL=off`.

**«Hoy» con varios contactos** (`LeadDropBanner`, `latestDrop` y `homeDrop`):

- Con contactos de Apollo no promete correo: «6 contactos nuevos para ti, cada uno con su campaña lista. Ver el correo de cada uno usa 1 crédito.», y después «Te quedan 4 contactos de 6 por revisar». El botón dice «Revisar mis contactos». Antes decía «con correo verificado. Guardarlos no gasta créditos», que solo es cierto con Leads Finder.
- Lo que ofrece cuando no hay envío habla del plan del equipo: «Hoy te tocan 6 contactos nuevos…», «…cada día hábil te elegimos 6 contactos nuevos». Con el plan por defecto, los textos de siempre.

### Desde el 13 de noviembre: todo desde el correo, sin iniciar sesión (varios contactos al día)

Pedido del dueño: «la idea es que le lleguen al mail sin siquiera necesidad de estar entrando a la app, que el usuario no tenga que aprender nada de la app, que solo le lleguen y lo ocupe», «que pueda hacer todo desde Gmail o Outlook». Hasta el 12 de noviembre cada botón del correo abría la app y pedía iniciar sesión.

**Qué cambia para la persona.** Los botones del correo de la mañana y del correo «Campaña lista para aprobar» abren una página propia, `/contactos/<enlace>`, sin sesión, sin menú y sin nombrar partes de la app. Ahí están sus contactos del día, una tarjeta por cada uno (la misma `DropContactCard`), y cada paso es un botón:

1. **«Enriquecer · 1 crédito»** busca el correo de trabajo del contacto. Encontrado, la tarjeta muestra la dirección y llega el correo «Campaña lista para aprobar».
2. **«Conectar Gmail» / «Conectar Outlook»**, solo la primera vez: el consentimiento de Google o Microsoft, y de vuelta a la misma página. No pasa por «Conexiones».
3. **«Aprobar y programar»**: la campaña sale desde su propio Gmail u Outlook; las respuestas le llegan ahí.
4. **«Detener la campaña» / «Reanudar la campaña»**, desde la misma tarjeta: quien aprueba con un toque en un correo la detiene igual.
5. «Editar los correos» y «Me sirve / No me sirve» funcionan como en la app.

Solo aplica a envíos de **varios contactos** (el plan de un equipo). Con un contacto, los correos siguen abriendo la app como antes.

**Un correo solo de contactos.** Pedido del dueño el mismo día, al ver el primer correo real: «quiero que el mail sea solo de leads, lo de oportunidades que sea aparte en otro mail». Con varios contactos, el correo de la mañana trae solo los contactos, su PDF y sus botones (asunto «6 contactos nuevos para ti»), sin enlace a la app. Lo demás del día (respuestas, oportunidades, una búsqueda que falla, la meta) va en un segundo correo, y solo si hay algo que decir (`deliverDailyAlert` en `src/lib/server/daily-alerts.ts`, `dropAlertEmail` en `src/lib/daily-alerts.ts`). Sigue siendo un solo aviso por persona y día en `daily_alerts`. Con un contacto, todo va en un correo como antes.

**Dentro de la app, en «Hoy».** Pedido del dueño el mismo día: «si nos vas a llevar para la app, que sea realmente dentro de la app, que sea una sección especial dentro del sistema, de hecho podría ser en la sección Hoy… le deberíamos dar más importancia a esa sección». Las dos entradas conviven y ninguna obliga a la otra:

- **«Tus contactos de hoy»** (`src/components/home/TodayContacts.tsx`) es lo primero de «Hoy» para un equipo con varios contactos al día, al lado de «Meta de la semana». Arriba dice cuántos hay y en qué va cada uno (por enriquecer, por aprobar, en marcha). Cada contacto es una fila: quién es, una línea de por qué y su paso siguiente; «Ver por qué y su campaña» abre ahí mismo la ficha completa (`DropContactCard` con `collapsible`), donde se cambian los correos y se aprueba. Las acciones son las mismas de la página del envío (`useDropActions`).
- **Cuándo aparece** (`homeDrop`, campo `board` de `GET /api/lead-drops/latest`): todo el día del envío, quede lo que quede; y los días siguientes mientras algún contacto espere su correo o su aprobación, salvo que ya toque uno nuevo. Con un solo contacto no hay sección: sigue la línea de siempre bajo «Lo primero hoy».
- **El botón del correo** abre la página sin sesión, como antes. Si ese navegador ya tiene iniciada la sesión de la persona que el enlace nombra, la misma dirección la deja dentro de la app: `/contactos/<enlace>` redirige a `/dashboard?contactos=<enlace>&c=<contacto>`, y «Hoy» trae ese contacto a la vista, abierto en su campaña, y borra el enlace de la dirección. Llegar no hace nada por sí solo. Nadie es enviado a iniciar sesión: sin sesión, o con la sesión de otra cuenta, se queda en la página sin sesión, que al final ofrece una línea, «Ábrelos en «Hoy»», para quien prefiera trabajar dentro.
- **Lo que «Hoy» no puede mostrar** (el enlace de un correo anterior, los contactos de otro equipo) vuelve a la página sin sesión con `aqui=1`, que no redirige de nuevo. La vuelta de conectar Gmail u Outlook (`correo=`) también se queda en esa página, donde se muestra el resultado.
- **La sesión es por dominio.** Quien inició sesión en `anton-ia.yago.cl` queda dentro de la app al tocar el correo; quien solo la tiene en la dirección técnica de la app verá la página sin sesión hasta entrar una vez por `anton-ia.yago.cl`.

**En el dominio que la gente conoce.** Pedido del dueño al abrir el primer correo real: «me gustaría que lleve al https://anton-ia.yago.cl/». Los enlaces de los correos de contactos (el de la mañana, su PDF y «Campaña lista para aprobar») abren en la dirección pública de la app, que sirve esta misma app; sin ella, o si no es una dirección https simple, abren en la dirección propia de la app, como antes. Ese mismo día el dueño pidió lo mismo para el resto de los correos, así que la variable pasó a ser `APP_PUBLIC_URL` y vale para todos los correos de la app a sus usuarios (ver `docs/dominios.md`). Conectar Gmail u Outlook desde la página pasa por la dirección de la app, que es la que Google y Microsoft tienen registrada, y devuelve a la persona al dominio del correo (`provider-oauth-link.ts`). El enlace es el mismo en cualquiera de las dos direcciones: la dirección no es parte de lo firmado.

**El enlace** (`src/lib/server/lead-drop-link.ts`) es lo que permite actuar sin sesión, así que vale lo que vale el correo:

- **Qué es:** 48 caracteres que nombran un solo envío y la hora en que vence, sellados con HMAC-SHA256 bajo una clave propia derivada del secreto del servidor (`LEAD_DROPS_LINK_SECRET`, o `INTERNAL_API_SECRET`, o la clave de servicio). No sirve como ninguna otra firma, y ninguna otra firma sirve como enlace.
- **A quién representa:** a la persona dueña de ese envío, mientras siga en ese equipo (`resolveDropLink`). Nunca a otra persona ni a otro envío.
- **Vence a los 14 días.** Un enlace vencido o ajeno muestra una página que lo dice y ofrece entrar a la app.
- **Abrir el enlace no hace nada.** Los lectores de correo siguen los enlaces para revisarlos: ninguna búsqueda, aprobación ni detención ocurre al llegar. Todo es un botón de la página, que envía un POST con el enlace (`POST /api/lead-drops/link`). Por eso el botón del correo ya no pide enriquecer al llegar (sin `&enriquecer=1`).
- **Quien tenga el correo puede actuar por la persona** en ese envío: ver sus contactos, gastar sus créditos de enriquecer y aprobar sus campañas. La página lo dice («no lo reenvíes»). Es el costo de no pedir sesión.
- **No se filtra:** la página no se indexa y no entrega su dirección a los sitios que enlaza (`referrer: no-referrer`); la presencia del equipo ve «/contactos», nunca el enlace.

**Enriquecer sin navegador** (`enrichDropLead` en `src/lib/server/lead-drop-mail.ts`). En la app, el navegador guarda el contacto, llama a la búsqueda y lo ata al envío. Desde el correo lo hace el servidor, en ese orden y con las mismas piezas:

- la búsqueda es la ruta de la app (`/api/opportunities/enrich-apollo`), pedida por el servidor a nombre de esa persona: mismo cupo diario, misma cuota de créditos del equipo, mismo registro;
- **un segundo toque no cobra dos veces:** la operación se llama como el envío y el contacto (`lead-drop:<envío>:<contacto>:email:<intento>`), y la ruta responde lo que ya hizo. Solo una búsqueda que terminó sin correo, que fue rechazada o que nunca respondió (15 minutos) deja que el siguiente toque empiece otra;
- **lo que puede pasar se dice tal cual:** encontrado (con el crédito usado), sin correo, todavía buscando (la página pregunta de nuevo cada 5 segundos, un minuto), sin cupo o sin créditos del equipo (con las palabras de la app);
- solo el correo: desde un correo nunca se busca un teléfono.

**Conectar el correo desde el enlace** (`src/lib/server/provider-oauth-link.ts`). Es el mismo flujo OAuth de «Conexiones» (mismos permisos, misma dirección de retorno, PKCE), con dos diferencias:

- la persona la nombra el enlace firmado, no una sesión; se revisa al empezar y de nuevo al volver, así que la cookie del intento nunca decide para quién es el buzón;
- **solo conecta quien no tiene ningún buzón:** un enlace nunca reemplaza el Gmail u Outlook que ya envía;
- **solo el buzón de la propia cuenta:** la dirección del buzón tiene que ser el correo con que la persona entra a ANTON.IA (el de `auth.users`, el único que la cuenta ha probado). Quien acepta el consentimiento es quien tiene el navegador, no necesariamente quien nombra el enlace: sin esta regla, un enlace reenviado («conecta tu correo aquí») ataría el buzón de un tercero a la cuenta de quien lo reenvió. El correo al que llegan los avisos (`profiles.email`) no sirve para esto, porque cada persona puede cambiarlo. Otro buzón se conecta desde la app, y la página lo dice.

**Lo que sigue necesitando la app:** cambiar el buzón con que se envía, ver las respuestas clasificadas y las campañas en detalle, y apagar los avisos («Tu semana»).

Lo de abajo describe cómo funciona con Leads Finder. El reparto, los grupos, el calce, la redacción y el envío de la mañana son iguales con Apollo.

**Por qué martes, miércoles y viernes por defecto:** son días de aviso. Los avisos van de martes a viernes porque el lunes es del informe semanal, y la regla es un correo por día. Desde el 12 de noviembre los días son de cada equipo (`organizations.lead_drop_weekdays`); `DROP_WEEKDAYS` (`src/lib/lead-drops.ts`) es solo el valor por defecto.

### Desde el 15 de noviembre: seguir desde el correo o desde la app, y la respuesta en la misma conversación

Pedido del dueño al ver el correo de ejemplo: «faltaría el botón que te permita ir a la app o el botón que te deje darle a
enriquecer todos con teléfono + mail, solo teléfono o solo mail … si desea continuar desde el mail y le da a enriquecer, le
debería llegar un mail en el mismo hilo con los leads enriquecidos y todo listo para iniciar el primer contacto y lanzar la
campaña de seguimiento, o el guion listo para la llamada».

**En el correo de la mañana** (varios contactos al día, `campaignEmailSection` en `src/lib/lead-drops.ts`), antes de las
tarjetas, tres caminos:

- **«Enriquecer los N · N créditos»** (el botón principal): abre `/contactos/<enlace>?todos=correo`.
- **«Con sus teléfonos · 8N créditos»**: abre `/contactos/<enlace>?todos=telefono`.
- **«Abrir en ANTON.IA»**: los mismos contactos dentro de «Hoy» (`/dashboard?contactos=<enlace>`), que pide iniciar sesión.

Son dos opciones de enriquecimiento y no tres: buscar el teléfono trae también el correo por los mismos créditos
(`apolloAllocationCost`: 8 por ambos), así que «solo teléfono» sería lo mismo que «correo y teléfono». El teléfono de alguien
que ya tiene correo se busca desde su tarjeta («Buscar su teléfono · 8 créditos»).

**El enlace no gasta nada.** La página abre con la opción elegida (`DropBulkEnrich`) y el botón «Enriquecer los N · X
créditos» es lo que busca: un lector de correo que sigue enlaces nunca usa créditos. Al confirmar, la página busca a cada
contacto, uno tras otro, con la misma búsqueda de siempre (`enrich`, con `quiet` para que no salga un correo por contacto) y
al terminar pide la respuesta (`ready`). Un rechazo que le tocaría también al siguiente (sin créditos, cupo del día) detiene
el resto; lo ya encontrado se envía igual.

**La respuesta llega a la misma conversación** (`src/lib/server/lead-drop-ready.ts`, `src/lib/lead-drop-ready-email.ts`):

- **«Listos»**: un correo con cada contacto encontrado: su dirección, su primer correo (completo si es uno; el inicio de
  cada uno si son varios, desde el 16 de noviembre), los días de sus seguimientos y el botón para aprobar. Aprobar sigue
  siendo un botón de la página.
- **«Para llamar»**: cuando llegan los teléfonos (la respuesta del proveedor tarda minutos y entra por
  `src/app/api/apollo-webhook/[token]`), un correo con cada número, «Llamar», «WhatsApp» con su primer mensaje escrito y el
  guion de la llamada; los que quedaron sin teléfono se nombran. Mientras un teléfono pedido hace menos de 10 minutos siga
  en camino, espera para enviarlos juntos. El guion se escribe al confirmar (`prepareDropCalls`), para que esté listo cuando
  llegue el número.
- «Llamar» abre la ficha del contacto en su sección «Llamada» y marca desde la página (`?c=<contacto>&llamar=1`): los
  lectores de correo neutralizan los enlaces `tel:` (visto el 15 de noviembre en Gmail). El número va además como texto.

Cada contacto va una vez en cada correo: se marca en el drop antes de enviar (`campaignMailedAt`, `callMailedAt`), bajo la
última escritura del drop, y si el envío falla la marca se devuelve. El correo «Campaña lista para aprobar» de un contacto
enriquecido por separado va ahora en la misma conversación.

**Cómo se agrupan** (`src/lib/lead-drop-thread.ts`): todos los correos de un drop llevan el mismo asunto (con «Re:» las
respuestas) y los mismos encabezados: `References` e `In-Reply-To` con una raíz propia del drop (Resend escribe el
`Message-ID` de cada correo, así que ninguno puede nombrar a otro; todos nombran la misma raíz, como hacen los correos de
notificación), y `Thread-Topic` y `Thread-Index` para Outlook, con el id del drop como id de conversación. Por la API de
Outlook (`sendMail`) no se pueden enviar encabezados propios: ahí agrupa el asunto.

**Botones visibles en cualquier lector** (`emailButton` en `src/lib/email-shell.ts`): el color va como atributo de la celda
y como `background-color`; con el atajo `background` un intermediario lo quitó y quedó texto blanco sobre blanco.

### Desde el 16 de noviembre: rediseño de la ficha, de la página y de los correos

El dueño vio la página real con el guion de una llamada y dijo: «no me gusta que se vea así como una columna… se siente como
mucho texto y poco organizado, cuesta leerlo». Seis tarjetas una bajo otra eran seis veces el mismo muro de texto. Lo que
cambió, en todas las vistas (la página del correo, «Buscar prospectos» y «Hoy»):

- **Varios contactos son un espacio de trabajo, no una columna** (`DropContactsWorkspace`). A un lado, la lista «Tus
  contactos»: iniciales sobre un color propio, nombre, cargo y empresa, y **dónde va cada uno** en una sola etiqueta
  (`dropStage`: «Por enriquecer», «Sin correo», «Por guardar», «Guardado», «Campaña por aprobar», «Campaña en curso»,
  «Campaña detenida»). Al centro, **un contacto a la vez**. En el teléfono la lista es una fila de caras que se desliza, con
  «Anterior / N de M / Siguiente» bajo la ficha. Llega abierto el contacto del botón del correo; si no, el primero que
  todavía necesita un paso.
- **La ficha (`DropContactCard`) tiene tres secciones en pestañas** (`SegmentedTabs`, con flechas del teclado): «Por qué»,
  «Campaña» (con su número de correos) y «Llamada» (con un punto cuando ya hay teléfono). Arriba quedan quién es, su
  etiqueta de estado y **una sola acción** con su nota. Un botón del correo abre la sección que le corresponde: «Revisar y
  aprobar» la campaña, «Llamar» la llamada.
  - **Por qué**: «Cómo abrir» destacado primero; luego, lado a lado, «Por qué te lo recomendamos» y «Sobre <empresa>» con
    la novedad en un recuadro ámbar con su fuente; y «Cómo calza con tu cliente ideal» a la vista, sin desplegar.
  - **Campaña**: los pasos a la izquierda (primer correo y cada seguimiento con su día) y **un correo a la vez** a la
    derecha. «Editar los correos» sigue igual.
  - **Llamada** (`DropCallPanel`): la fila del teléfono (número grande, «Llamar» y «WhatsApp») y el guion **por bloques, en
    el orden de la llamada**: «Al contestar» destacado; «Puntos de interés» (cada uno por su tema, `splitTopic`) junto a
    «Preguntas» numeradas; «Si te dice…» como tabla objeción | respuesta; y «Si no contesta» junto a «Primer WhatsApp».
- **Arriba de la página**, tres números («Por enriquecer», «Por aprobar», «En marcha») reemplazan la frase de estado, y
  «Enriquecer los N de una vez» es una banda horizontal (`DropBulkEnrich`).
- **«Hoy»** mantiene sus filas plegadas; al abrir una, es la misma ficha con sus pestañas.
- **Los correos** (`src/lib/email-shell.ts`: `emailPerson`, `emailCallout`, `emailLabel`): cada tarjeta parte por las
  iniciales del contacto con el mismo color que en la app (`dropInitials`, `dropTint`).
  - *El de la mañana*: la novedad de la empresa en un recuadro «Ahora» con su fuente, una línea de por qué y la campaña en
    una línea («Campaña lista · «asunto» · primer correo y N seguimientos»). «Cómo abrir» y el adelanto del correo ya no
    van en el HTML: están a un clic, en la página y en el PDF, y siguen en la versión de texto.
  - *«Listos»*: con un contacto, su primer correo completo; con varios, el inicio de cada uno y «Leer completo y aprobar»
    (seis correos completos eran otro muro de texto). La versión de texto los trae completos.
  - *«Para llamar»*: el número grande con sus dos botones, «Al contestar» destacado, los puntos por tema y las preguntas
    numeradas. Objeciones y buzón de voz quedan en la ficha («Abrir el guion completo») y en la versión de texto.

La sección de la llamada se llama «Llamada» en todas partes (antes «Para llamar»); el correo que trae los teléfonos conserva
su nombre interno. Pruebas: `drop-contact-card.test.ts`, `drop-mail-flow.test.ts`, `lead-drop-flow-ui.test.ts`,
`lead-drops.test.ts`, `lead-drop-ready-email.test.ts`; recorridos `contactos-seis`, `contactos-para-llamar`,
`contactos-desde-el-correo*` (incluye `contactos-desde-el-correo-llamar`; desde el cambio de más abajo son `contactos-del-correo-*`) y `contactos-en-hoy`, en escritorio y teléfono.

### Desde el 16 de noviembre: los botones del correo abren la app, en la cuenta de la persona

El dueño, al ver la página del correo: «sigue sin estar como dentro de la app en sí, no hay forma de acceder al resto de la app
desde este link… esto es una forma de facilitarle al usuario el gasto de créditos y además una forma de acercarlo a la app». Un
primer intento le puso a esa página un marco parecido al de la app, y el dueño lo descartó: «lo que hiciste fue crear una
versión 2 de la app, eso no era lo que quería; lo que quería era que el redireccionamiento lo llevara a su cuenta en la app,
porque estos mails solo le llegarán a usuarios que hayan iniciado sesión alguna vez». Ese marco (`DropAppFrame`) se quitó.

**Qué hace ahora cada botón.** La dirección del correo, `/contactos/<enlace>`, ya no muestra nada propio
(`src/app/contactos/[token]/page.tsx`): comprueba el enlace firmado y manda a esos contactos dentro de la app, en
`/dashboard/contactos/<id>` (`LeadDropFlow`), con el menú y todo lo demás de ANTON.IA a un clic.

- **Con la sesión iniciada**, la persona queda directo en sus contactos, con el contacto del botón abierto (`?c=`).
- **Sin sesión**, la app pide entrar (`/login?next=…`) y después abre esos mismos contactos, con lo que el botón pedía.
- **Con otra cuenta abierta en el navegador**, un aviso dice que el correo llegó para otra cuenta y cómo seguir. No se muestra
  ningún contacto.
- **Enlace vencido o que no existe**: el aviso de siempre, con «Entrar a ANTON.IA».

**Lo que la página de la app aprendió para que nada del correo se pierda:**

- **«Enriquecer los N» y «Con sus teléfonos»** del correo de la mañana llegan con `?todos=correo|telefono`: la página muestra
  «Enriquecer los N de una vez» (`DropBulkEnrich`) con esa opción elegida y el costo total. Los créditos se usan recién al
  confirmar. Busca uno por uno (`action: 'enrich'` en `POST /api/lead-drops/<id>`), y al terminar pide la respuesta al correo
  (`action: 'ready'`): «Listos» en la misma conversación de la mañana y, si se pidieron teléfonos, «Para llamar» cuando lleguen.
  La banda aparece también sin venir del correo, cuando quedan dos o más por enriquecer.
- **«Enriquecer y revisar · 1 crédito»** de un contacto llega con `?c=…`: abre a esa persona, y el crédito se usa recién al
  apretar «Enriquecer» ahí («Nada se cobra al abrir», dice el correo). La dirección acepta además `&enriquecer=1`, que ningún
  correo trae hoy: con él la búsqueda partiría al llegar, detrás de la sesión.
- **«Llamar»** del correo «Para llamar» llega con `?c=…&llamar=1`: abre a esa persona en «Llamada» y marca el número una vez.
- **«Hoy»** (`TodayContacts`), cuando recibe un enlace de contactos que no son los que tiene a la vista, manda a esa misma página.

Las respuestas en la misma conversación («Listos», «Para llamar») no cambian: las escribe el servidor, venga la acción de donde
venga.

**Qué queda sin uso.** La página sin sesión (`DropMailFlow`) y su ruta (`POST /api/lead-drops/link`) siguen en el código pero
ningún botón lleva a ellas. Se quitan cuando el dueño lo confirme.

**«Tus contactos de hoy» es una pantalla de «Hoy».** El dueño, al ver el marco todavía en producción: «igual sigue estando en como
otra app; la idea es que esto de tus contactos de hoy sea una subsección de Hoy, para que de esa manera todo conviva en la misma
app y los usuarios puedan entrar a Cowork y todo eso».

- **En el menú real**, bajo «Hoy», aparece «Tus contactos de hoy» (`NAV_SECTIONS`, `sub` de «Hoy»; `app-sidebar.tsx`), con el
  número de contactos que todavía esperan a la persona (su correo por buscar o su campaña por aprobar). Se muestra mientras la
  persona tenga contactos de la última semana (`contacts` en `GET /api/nav/pending`, `latestDropPending`) y siempre que esté en
  esa pantalla. Con el menú plegado a íconos no hay lugar para ella: se marca «Hoy».
- **La pantalla vive bajo «Hoy»**: `/dashboard/contactos/<id>` para unos contactos en particular (los botones del correo, «Hoy»)
  y `/dashboard/contactos` para los últimos (`LatestDrop`, que los lee de `latestId` en `GET /api/lead-drops/latest`). Su vuelta
  es «Hoy», y el día que llegan se titula «Tus contactos de hoy».
- **La dirección anterior**, `/search/contactos/<id>` (bajo «Buscar prospectos»), sigue abriendo: reenvía a la nueva con lo que
  el enlace pedía, para los correos ya enviados.

**Directo a los contactos, y qué pasa con otra cuenta u otro espacio de trabajo.** El dueño probó el correo de la cuenta de prueba
con su propia cuenta abierta, en otro espacio de trabajo: «me llevó a la página principal, luego cargó un rato y como que me llevó
a otra parte… luego cambié de sección y ya no pude volver a entrar».

- **«Abrir en ANTON.IA»** es ahora la dirección del propio correo (`dropAppHref`): cae directo en la pantalla de los contactos.
  Los correos anteriores, que abrían «Hoy» con su enlace (`/dashboard?contactos=<enlace>`), pasan por ella desde el middleware,
  sin cargar «Hoy» primero.
- **Contactos de otro de tus espacios de trabajo**: `GET /api/lead-drops/<id>` responde 409 `other_workspace` con el espacio al
  que pertenecen; la pantalla se cambia a él (`organizationService.setCurrentOrganization`) y los abre. Le pasa a quien
  pertenece a varios equipos y recibe el correo de uno con otro a la vista.
- **Contactos de otra cuenta**: 404 `other_account`, con «Estos contactos son de otra cuenta de ANTON.IA, no de la que tienes
  abierta» y la vuelta a «Hoy». No se muestra nada de ellos ni se ofrece crear contactos para la cuenta abierta. La entrada del
  menú no aparece para esa cuenta si no tiene contactos propios: no es de ella.

Pruebas: «the address of the email shows nothing of its own…» en `drop-mail-flow.test.ts`; «Enriquecer los N of the morning
email lands inside the app…» y «Llamar of the email…» en `lead-drop-flow-ui.test.ts`; «Tus contactos de hoy is a screen of Hoy» en `navigation.test.ts`.
Recorridos: `contactos-desde-el-menu`, `contactos-del-correo-a-la-app`,
`contactos-del-correo-todos`, `contactos-del-correo-llamar` y `contactos-del-correo-sin-sesion`.

### Desde el 16 de noviembre: recomendados a medida (texto libre y mezcla de cargos)

El dueño, tras ver los filtros de «Así los buscamos»: «les das leads que tienen cargos muy altos, a lo mejor deberíamos hacerlo
mixto: leads que son directamente el que necesitan y también leads que podrían referirlos con la persona indicada», «cuando el
usuario da su evaluación… podría haber un parámetro libre que le deje poner qué es lo que le gustaría que le apareciera» y «que él
cuente más o menos qué es lo que hacen o qué quiere ofrecer y qué leads busca, para que con esa info no solo adaptemos los leads
recomendados sino también toda la app». Es la primera mitad de un plan de cuatro; faltan la búsqueda por empresa con expansión
automática y la calidad de los correos.

**«En tus palabras», en «Perfil» y en la ficha de la empresa.** Un texto libre (`targetNotes`, hasta 1.200 caracteres) junto a las
listas del cliente ideal. Cada uno tiene el suyo: el de la ficha dice a quién le vende el equipo; el de la persona, a quién busca
ella, y se puede escribir también cuando el equipo tiene ficha (sección «En tus palabras» de «Perfil»). El de la empresa nunca
reemplaza al de la persona (`withCompanyFields`). Lo leen:

- **el buscador** (`scoreDropCandidates`, `en_sus_palabras`), donde manda sobre las listas de cargos y rubros;
- **Cowork y el Redactor**, en el contexto del usuario (`idealCustomer.inOwnWords` y `teamInOwnWords`, `user-context.ts`).

**«Qué te gustaría recibir», al evaluar un contacto.** Después de «Me sirve» o «No me sirve», la ficha ofrece «Decir qué te
gustaría recibir»: un texto de hasta 300 caracteres que queda con la evaluación (`feedback.wish`). El buscador lee los cinco más
recientes de **esa persona** (`dropWishes`, `pedidos`), no los del equipo. Dos personas con el mismo cliente ideal y distintas
palabras o pedidos se puntúan aparte (`preferencesKey`).

**Quien decide y quien puede derivarte.** El puntaje pide una tercera nota, «deriva»: cuánto sirve la persona como puerta de
entrada cuando no decide (trabaja en el área, conoce a quien decide). Con «cargo» bajo 7 y «deriva» de 6 o más, el contacto queda
como `role: 'refer'`. De seis contactos, cuatro son de quienes deciden y los dos últimos cupos son para quien puede derivar; sin
ninguno, esos cupos siguen yendo a cargos vecinos («para explorar»), como antes. El contacto se muestra como «Puede derivarte»,
con su porqué («no decide la compra, pero puede decirte quién la ve o presentarte»), y su correo pide la orientación o la
presentación en vez de vender (`draftFor`).

Pruebas: `lead-drop-finder.test.ts` («who works in the area without deciding…», «what a person asked for…»), `lead-drops.test.ts`
(«the mix…»), `lead-drop-campaign.test.ts` (el pedido se guarda), `profile-mappings.test.ts`, `company-profile.test.ts`,
`user-context.test.ts` y `lead-drop-flow-ui.test.ts`. Recorrido: `contactos-a-medida`.

### Desde el 16 de noviembre: búsqueda por empresa y expansión automática

El dueño: «¿qué pasará cuando ya no halles más leads?, ¿expandirás la búsqueda? Lo mejor para buscar más es buscar por empresa o
industrias, evaluar cada empresa por separado y obtener todo el listado de trabajadores y ahí sacar los puestos que sean
interesantes: las empresas son las que pagan». Dos cosas se vieron al revisarlo con la búsqueda gratuita de Apollo:

- Una búsqueda por cargo la copan las dos o tres empresas más grandes: las primeras 25 jefaturas de «forestal» en Chile eran todas
  de una misma empresa. Cuando esas se agotan, el buscador decía que no había nadie nuevo.
- Los rubros que el proveedor no tiene en su lista («forestal», «celulosa», «puertos») **no se buscaban**: se dejaban fuera sin
  decirlo. Ahora van como palabras de la empresa (`industrySets`); un rubro con etiqueta y uno sin ella van en búsquedas
  separadas, porque juntos no dejan a casi nadie.

Para quien recibe varios contactos al día, el buscador ahora también lleva las empresas del cliente ideal
(`src/lib/server/lead-drop-accounts.ts`, tabla `lead_drop_accounts`):

1. **Las encuentra por sus cabezas.** Una búsqueda de dueños y gerentes generales de los rubros y lugares del cliente ideal
   (uno o dos por empresa) lista las empresas del rubro, en vez del personal de la más grande. Se suman las empresas de quienes
   trajo la búsqueda por cargo.
2. **Evalúa cada empresa una vez** (`scoreAccounts`, modelo chico): una nota de 0 a 10 de cuánto necesitaría lo que vende el
   equipo y una razón de una frase, con «En tus palabras» de la ficha a la vista. Distingue a quien opera de quien solo le
   vende a esos operadores (un proveedor del rubro queda en 3 o menos). La nota se guarda: no se vuelve a pedir.
3. **Abre las mejores cada día** (`accountsToOpen`: nota de 6 o más, doce por grupo): trae a toda su gente en los lugares del
   cliente ideal, sea cual sea el cargo, más los cargos buscados entre todas ellas. El puntaje de personas decide quién
   decide y quién puede derivar, partiendo de la nota de la empresa (`evaluacion_empresa`).
4. **Recuerda cuáles se agotaron.** Al terminar guarda cuánta gente que valga la pena le queda a cada empresa abierta
   (`people_left`). Una en cero descansa 30 días y las siguientes toman su turno; entre empresas de igual nota va primero la
   que hace más tiempo no se abre.
5. **Amplía sola cuando quedan pocos.** Si al cliente ideal le quedan menos de dos días de gente que valga la pena, el modelo
   propone hasta cuatro rubros vecinos (`expansionIndustries`), con las palabras con que esas empresas se describen. Solo entra
   la gente de las empresas que calzan (nota de 6 o más). Esos contactos llevan `expanded` («Rubro vecino») y su porqué lo dice:
   «ampliamos la búsqueda porque de tus rubros ya te mostramos a casi todos».

Qué ve la persona: en la ficha, «Por qué esta empresa» (`companyWhy`) y la marca «Rubro vecino»; en «Así los buscamos», cuántas
empresas calzan, cuántas se abrieron hoy y a qué rubros se amplió (`criteria.accounts`, `accountsLine`).

Todas las búsquedas son la gratuita de personas de Apollo: no se usa la búsqueda de empresas, que cuesta créditos. Todo es al
mejor esfuerzo: sin la tabla o con el modelo caído, el buscador sigue por cargo como antes. La tabla solo la lee y escribe el
servidor (RLS activa, sin políticas).

Pruebas: `lead-drop-accounts.test.ts`, y en `lead-drops-apollo.test.ts` «by company…» (dos días seguidos: la que se agota
descansa, y sin nadie que decida quedan quienes pueden derivar) y «when the customer's industries run out…».

### Desde el 16 de noviembre: una redactora propia para los correos de recomendados

El dueño, leyendo los de su cuenta de prueba: «no se notan muy buenos… la idea es que los usuarios no tengan que modificar tanto
los mails». Los escribía la Redactora de Cowork (`cowork/writer.ts`), cuyas reglas se afinaron para un correo que va a muchas
personas de un rubro y con los ejemplos de un solo producto. Con una persona investigada al frente producía una plantilla. En los
24 correos reales de ese día (seis contactos, cuatro correos cada uno):

| | Antes | Ahora |
|---|---|---|
| Abren con una hipótesis o una lección («cuando ocurre X, tu Y define Z») | 23 | 0 |
| Le preguntan «¿quién coordina…?» a quien justamente lo coordina | 11 | 0 |
| Le piden un dato de su operación («¿cuánto les toma…?») | 5 | 0 |
| Asuntos repetidos entre contactos | 4 | 1 |

Además: la misma prueba en todos («más de 15 años»), aunque el perfil tenía otras mejores; ningún seguimiento sabía del
anterior; la empresa del vendedor escrita de dos maneras y la firma irregular; y un ejemplo de las reglas se coló en otro rubro
(«si la nómina coincide con un cambio de turno», a una minera).

`src/lib/server/lead-drop-writer.ts` escribe ahora esos cuatro correos:

- **Parte de la persona.** El primero dice por qué se le escribe a ella: une algo cierto de su empresa (la novedad que encontró
  la investigación) o de su cargo con el servicio que le toca. No le describe su empresa ni le explica su trabajo.
- **Un servicio concreto y una prueba del perfil**, cada prueba una sola vez en la secuencia y distinta para cada contacto del
  día (`variant`). Lee también los clientes que el perfil permite nombrar y los problemas que dice resolver, que el contexto de
  Cowork no trae (`dropSellerOf`), y «En tus palabras».
- **Una petición que se contesta en una línea.** Primero una pregunta de interés; después un resumen de una página, una llamada
  de 15 minutos y, al cierre, si es otra persona quien lo ve. A quien «puede derivarte» solo se le pide eso.
- **Sus propias revisiones** (`dropEmailIssues`): hipótesis al abrir, preguntas de dato o de «quién», cifras que no vienen en
  los datos, trato de usted, largo, asuntos. Con observaciones corrige una vez y se queda con la versión que tenga menos.
- **Cierre igual en todos** (`finishDropEmails`): la empresa como la escribe el perfil y «Saludos,» con el nombre de quien firma.
- Las reglas no nombran ningún rubro ni producto, para que nada se cuele (lo vigila una prueba).

Modelo: `claude-haiku-5-5` (`LEAD_DROPS_WRITER_MODEL` lo cambia), que en la medición escribió más natural que Luna al mismo
precio. Una secuencia toma de 15 a 40 segundos y una o dos llamadas, menos que antes (redactora, revisora, corrección y pasada
de voz). Si el modelo falla, el contacto recibe sus correos de la Redactora de Cowork, como antes; `LEAD_DROPS_WRITER=off`
vuelve a ella del todo. Los modelos más caros siguen bloqueados en toda la app (`src/ai/blocked-models.ts`).

Pruebas: `lead-drop-writer.test.ts` y, en `lead-drops-apollo.test.ts`, «the emails of a recommended contact come from the drops'
own writer…» (con su respaldo).

### Desde el 17 de noviembre: los correos, como una página propia

El dueño: «sigamos mejorando el cómo se ven los mails que le llegan a los usuarios». Hasta ahora cada correo era una columna blanca
con tarjetas dibujadas con `div`: sin marca, sin texto de vista previa en la bandeja y, en el Outlook de escritorio (que ignora
`max-width`, el relleno y los márgenes de un `div`), con las tarjetas pegadas al borde y a todo el ancho de la ventana.

- **Marco común** (`src/lib/email-shell.ts`, `emailShell`): fondo gris suave, «ANTON.IA» arriba con una etiqueta de qué es el correo
  («Contactos de hoy», «Listos para aprobar», «Para llamar», «Campaña lista», «Tu día») y tarjetas blancas encima. Todo con tablas y
  con el color también como atributo, para que se vea igual en Gmail, Outlook y el teléfono, y legible en modo oscuro.
- **Vista previa en la bandeja** (`preheader`): después del asunto se lee a quiénes trae el correo («Marcela F. de Tiendas Aurora,
  Rodrigo P. de… y 3 más») o el siguiente paso, y no otra vez el saludo.
- **Titular** (`emailHeadline`): el saludo chico, qué pasó como título y qué hacer debajo.
- **Tarjetas** (`emailCard`): una por contacto. Lo que es cada contacto va como píldora junto a su nombre («Puede derivarte», «Para
  explorar», «Rubro vecino»), y «Campaña lista» y «Correo encontrado» también (`emailPill`).
- **Un botón principal por correo.** En el de la mañana, «Enriquecer los N»; «Con sus teléfonos» queda delineado y la app pasa a ser
  un enlace discreto («¿Prefieres la app? Abrir en ANTON.IA»). «Ver los N juntos» deja de ser un enlace suelto al final.
- **Los demás correos de la app** (informe del lunes, avisos de saldo, asignaciones de Oportunidades) reciben el mismo marco con su
  contenido en una sola tarjeta, sin cambiar su texto.

Nada cambia en qué dice cada correo, en sus enlaces ni en la versión de texto.

### Desde el 17 de noviembre: la corrida deja su traza

La primera corrida real con seis personas (17 nov) entregó sus 36 contactos con investigación y correos, pero la tabla de empresas
(`lead_drop_accounts`) quedó vacía (se leyó dos veces y nunca se escribió) y 32 de los 36 contactos traen el motivo fijo de la
asignación por cargo («Calza con tu cliente ideal por su cargo»), no el de la nota de la IA. La corrida no dejaba cómo saber por qué.

Desde hoy cada entrega del buscador guarda en `criteria.trace` cómo le fue, en números: `narrow` (personas que trajeron las búsquedas
por rubro), `broad` (si cayó a cargos y lugares), `terms` y `extra` (las búsquedas con los cargos escritos de otra forma), `hurried`
(quedaba poco tiempo y las empresas se dejaron para otra corrida), `known`, `learnt`, `scored`, `fit`, `opened`, `touched` y `saved`
(empresas leídas, nuevas, con nota, que calzan, abiertas, por guardar y si se guardaron), `candidates` y `worth` (personas
encontradas y las que la nota dio por buenas), `plain` (personas a las que se les asignó por cargo porque la nota no les dejó a
nadie) y `ms`. No se muestra en ninguna pantalla: es para revisar una corrida.

Para revisar errores de Postgres con el conector, el campo es `log_attributes['parsed.error_severity']` (sin `parsed.` la consulta
siempre devuelve cero).

### Desde el 18 de noviembre: donde hay planes por persona, el contacto del equipo se retira

El dueño, del contacto único de martes, miércoles y viernes que seguía recibiendo el resto de GrupoExpro: «quitemos ese
recomendado, ese es antiguo». De 27 enviados en noviembre a sus personas activas se abrió uno.

En un equipo donde alguien tiene un plan propio (`lead_drop_person_plans`), quien no tiene uno deja de recibir contactos: ni correo
de la mañana ni oferta en «Hoy» (`planOfPerson(..., byPerson)`, `NO_DROP_PLAN`). Un equipo donde nadie tiene plan propio sigue con
el plan del equipo, como antes. Para darle contactos a alguien de un equipo así se le crea su fila en `lead_drop_person_plans`.

### Desde el 18 de noviembre: a quien no ha entrado, el correo lo invita a volver

El dueño, de quienes no han abierto la app: «mandémosle 3 leads para ver si logramos hacerlos entrar, pero a esos claramente debemos
ponerles un mensaje distinto, para incentivarlos a meterse».

- **A quién:** a quien recibe varios contactos y no ha abierto ninguna pantalla de la app en 14 días (`AWAY_DAYS`), o nunca
  (`readAway` en `src/lib/server/daily-alerts.ts`, sobre `app_usage_views`). Si esa lectura falla, recibe el correo de siempre.
  Cuando vuelve a entrar, el correo vuelve a ser el de siempre sin que nadie cambie nada.
- **Asunto:** el primer contacto por su cargo y empresa, y que el trabajo está hecho: «Gerente HSE en Minera Andina y 2 contactos
  más, con su correo ya escrito» (`dropSubject(items, { away: true })`). Si los correos aún no están escritos dice «elegidos para ti».
- **Cuerpo:** «Te dejamos 3 contactos con el correo ya escrito», que se buscaron según lo que vende su equipo y que no hay que
  buscar nada; al pie, cómo entrar si olvidó la contraseña. Los contactos y sus botones son los mismos.
- **Conversación:** el asunto con que salió se guarda en `lead_drops.criteria.subject`, y «Listos», «Para llamar» y «Campaña lista»
  responden con ese mismo (`dropThreadSubject`), para seguir en la misma conversación.

Cuántos contactos recibe cada quien sigue saliendo de su plan (`lead_drop_person_plans`): el mensaje depende de si entra, no del plan.

### Desde el 18 de noviembre: las empresas se aprenden de la investigación de cada contacto

La traza de las dos primeras corridas reales (17 y 18 de noviembre) dijo por qué la búsqueda por empresa no arrancaba: `known 0`,
`learnt 0`, `opened 0`, con miles de candidatos. La búsqueda gratuita de personas de Apollo nombra la empresa de cada persona y nada
más: sin sitio, sin rubro, sin tamaño. La tabla `lead_drop_accounts` guarda cada empresa por su sitio, así que no había con qué
guardarla (las pruebas pasaban porque sus búsquedas de ejemplo sí traían el sitio).

Lo que sí encuentra el sitio de la empresa y qué hace es la investigación corta de cada contacto (`lead-drop-research.ts`). Ahí se
aprenden ahora las empresas (`learnResearchedAccounts` en `src/lib/server/lead-drop-accounts.ts`, llamada desde `writeDrop`):

- **Qué se guarda:** la empresa de cada contacto investigado con sitio, con su nota de 0 a 10 para lo que vende el equipo y su
  razón, puestas con lo que la investigación leyó de ella. Solo las nuevas: una que ya está conserva su nota y lo aprendido al abrirla.
- **Bajo qué clave:** la del cliente del grupo que buscó, que cada envío lleva en `criteria.accountsKey` (no siempre es el cliente
  propio de la persona).
- **Para qué:** a la mañana siguiente el buscador las lee (`known` deja de ser 0), abre las que calzan y trae al resto de su gente,
  como estaba previsto.

Depende de que la investigación corra: sin saldo en el buscador web (Serper) no hay sitio que aprender, como pasó el 18 de noviembre
desde las 02:41 de Chile (29 de 123 contactos con investigación).

### Desde el 18 de noviembre: quienes encabezan una empresa no se ofrecen como contactos

En la corrida del 18 de noviembre, 15 de los 24 contactos «para explorar» eran dueños, fundadores o gerentes generales de empresas
muy chicas («Main Owner», «Co-founder», «Entrepreneur»), que nadie había pedido. Venían de la búsqueda que encuentra las empresas del
cliente a través de quienes las encabezan (`COMPANY_HEADS`): esas personas entraban además como candidatas, y la nota las dejaba en
el lugar de explorar. Ahora solo nombran a sus empresas (`learn(accountsOf(...))`); quien quiera dueños los pone entre sus cargos y
la búsqueda por cargo los trae.

### Desde el 18 de noviembre: la preparación parte a las 02:00

Con todo GrupoExpro en planes por persona (13 personas con 6 contactos y 15 con 3: 123 al día) las nueve corridas de 05:00 a 07:40
no alcanzaban: una corrida escribe unos 16 contactos (dos rondas de hasta 8), y un contacto que no está escrito cuando sale el aviso
de las 08:00 no se envía ese día. `leadDropsTick` corre ahora de 02:00 a 07:40 de Chile, dieciocho corridas, sin cambiar cuántos se
escriben a la vez.

### Desde el 18 de noviembre: cada contacto con su porcentaje de recomendación, y solo se entregan los que alcanzan el mínimo

Pedido del dueño tras revisar la corrida del 18 de noviembre: «un módulo de IA que les asigne un porcentaje de recomendación y que haga volver a buscar si ese porcentaje es bajo para un lead, de esa manera solo le entregamos leads buenos».

**Qué fallaba.** El buscador ordena a cientos de personas solo por su cargo y el nombre de su empresa, que es todo lo que entrega la búsqueda gratuita de Apollo. Nunca supo a qué se dedica la empresa. Por eso llegaban dueños de firmas de una persona, consultores y empresas de otro rubro.

**Qué hace ahora** (`src/lib/server/lead-drop-gate.ts`, dentro de `writeDrop`):

1. **Investiga y después juzga.** Con la investigación corta de cada contacto ya hecha, un modelo lee qué vende quien recibe, a quién le vende (cargos, rubros, lugares, tamaños y lo que escribió «en sus palabras») y, de cada contacto, su cargo, su empresa, qué hace la empresa y qué está pasando ahí. Responde un porcentaje de 0 a 100, una frase con el motivo y el rubro de la empresa.
2. **Cómo se arma el porcentaje.** La mitad es la empresa (¿necesita lo que se vende?, ¿tiene dotación?, ¿es competencia?) y la mitad es la persona (¿es uno de los cargos declarados?, ¿tiene mando?). De 85 a 100 calza de lleno; de 70 a 84, con una reserva menor; de 60 a 69, vale el intento; bajo 60, no se entrega.
3. **Reemplaza a los que no alcanzan.** El planificador guarda, por persona, reservas: los siguientes mejores de la misma búsqueda, el doble del tamaño del envío (`criteria.spares`, mínimo 2 y máximo 12). Se ordenan por el puntaje del buscador con IA o, en los equipos de un contacto al día, por las palabras del cargo. Por cada contacto bajo el mínimo se investigan y juzgan dos reservas, y las mejores toman los lugares.
4. **Entrega solo los buenos, el mejor primero.** Quien sigue bajo el mínimo no se escribe ni se entrega. Si ninguno alcanza, el envío queda vacío con el motivo «Ningún contacto alcanzó el 60 % de recomendación hoy.» y ese día no sale correo.
5. **No los vuelve a traer.** Los rechazados quedan en `criteria.gate.rejected` y las búsquedas del equipo los excluyen mientras dure la memoria de envíos (180 días).

**Qué ve la persona.** Una etiqueta «92 % recomendado» en la tarjeta del contacto (con color solo desde 85 %), el porcentaje en la lista lateral, el motivo del juez sobre «Por qué te lo recomendamos», la etiqueta al inicio de la línea de por qué en el correo de la mañana y el porcentaje en el título del recuadro del PDF. Además, cuando Apollo no dijo el rubro, se muestra el que leyó el juez en vez de «Sin dato».

**Empresas sin repetir entre personas.** Cuatro vendedores recibieron el mismo día a alguien de la misma cadena, como «Walmart» y «Walmart Chile». Ahora la empresa se compara por nombre sin forma legal ni país (`companyKey`), y lo que una persona del equipo recibió hoy no se ofrece a otra, tampoco entre corridas distintas de la misma mañana (`knownPeople` devuelve `companies`).

**Medición con los 123 contactos reales del 18 de noviembre** (28 envíos de un equipo, modelo Haiku, US$ 0,04 en total, 2 a 10 segundos por envío):

| Grupo | Contactos | Promedio | Bajo 60 % |
| --- | --- | --- | --- |
| Cargos del cliente ideal | 82 | 74 % | 4 |
| «Puede derivarte» | 17 | 62 % | 7 |
| «Para explorar» | 24 | 38 % | 23 |

Los más bajos (12 a 30 %) fueron un consultor independiente, dueños de emprendimientos sin dotación y el gerente general de una empresa de software. Los más altos (85 a 88 %), gerentes de personas de mineras, de logística y de alimentos. Solo 28 de los 123 tenían investigación ese día (Serper sin saldo): sin ella el juez decide por el cargo y el nombre de la empresa.

**Límites conocidos.**

- **El mismo contacto puede variar unos 10 puntos entre dos corridas.** Cerca del mínimo, eso decide si entra.
- **Si las reservas tampoco alcanzan, la persona recibe menos contactos ese día, o ninguno.** No hay una segunda búsqueda en la misma mañana.
- **El reemplazo solo se intenta en el primer minuto del envío,** para que una noche lenta no deje un envío a medio escribir (`GATE_REPLACE_BEFORE_MS`). Pasado ese minuto, igual se dejan fuera los que no alcanzan.
- **Si el modelo no responde, nadie se juzga** y el envío sale como antes, sin porcentaje.

**Ajustes.** `LEAD_DROPS_MIN_RECOMMENDATION` (0 a 100, por defecto 60; con 0 el porcentaje solo se muestra y nadie se reemplaza ni se deja fuera) y `LEAD_DROPS_GATE_MODEL` (por defecto, el de `LEAD_DROPS_RESEARCH_MODEL` o Haiku 5.5). La traza del envío guarda cómo le fue: `criteria.gate = { min, judged, replaced, dropped, rejected }`.

### Desde el 19 de noviembre: con Apollo, la búsqueda sí baja más en la lista cuando todos son conocidos

**Qué fallaba.** Cuando la búsqueda solo trae personas que el equipo ya tiene, se busca una vez más, «tres veces más abajo». Esa segunda búsqueda tenía el tope de una corrida de Leads Finder (100). Con Apollo la primera búsqueda ya pide 100, así que la segunda nunca se ejecutaba. Un equipo de un contacto al día con un cliente ideal angosto se quedaba sin nadie en un par de semanas: el 18 de noviembre dos personas de un equipo quedaron con «La búsqueda no trajo contactos nuevos con correo».

**Qué hace ahora.** Con Apollo (gratis, hasta 1.000 por búsqueda) se pide hasta 300: primero el mismo cliente ideal, con sus rubros y tamaños, y solo si tampoco hay nadie nuevo, los cargos y lugares solos. Con Leads Finder sigue como antes. No aplica a los equipos con buscador con IA, que ya bajan en la lista según cuántas personas conoce el equipo.

### Desde el 19 de noviembre: la investigación que faltó se hace al abrir los contactos

Pedido del dueño: «haz que los mails que mandamos sí tengan investigación en la app».

**Qué fallaba.** La búsqueda web (Serper) se quedó sin saldo dos mañanas (18 y 19 de noviembre). Los contactos salieron con sus correos escritos, pero sin nada de su empresa: sin resumen, sin «Ahora» y sin «Cómo abrir». Nada lo reintentaba, así que quedaban así para siempre.

**Qué hace ahora** (`src/lib/server/lead-drop-late-research.ts`). Cuando la persona abre sus contactos en la app (su página o la sección de «Hoy»), la pantalla pide la investigación de los que llegaron sin ella (`POST /api/lead-drops/[id]` con `action: 'research'`):

- **Cuáles:** los que tienen empresa, no tienen investigación y no se intentaron en las últimas 20 horas (`lacksResearch`), de envíos de hasta 14 días. Hasta 10 por visita, todos a la vez.
- **Qué guarda:** lo mismo que habría guardado la corrida: la investigación, el resumen de la empresa, sus hechos y su sitio web si la búsqueda no lo traía.
- **Qué no toca:** los correos. La persona pudo haberlos cambiado o aprobado; quedan como estaban.
- **Si no encuentra nada:** el contacto queda marcado como intentado (`researchedAt`) y se reintenta al día siguiente, por si la búsqueda estaba caída.
- **Mientras tanto:** la pantalla muestra «Investigando las empresas de tus contactos…» y los contactos se pueden usar igual. Si falla, no se dice nada y la próxima visita lo intenta de nuevo.

**Límites.** Solo ocurre al abrir en la app: el correo de la mañana ya enviado y su PDF no cambian. Cuesta dos búsquedas por contacto, solo para quien abre.

### Desde el 19 de noviembre: el buscador avisa de los contactos recomendados

Pedido del dueño: «si el módulo de buscador es el más usado podríamos poner una alerta cuando entren a esa página para decirles que tenemos una nueva sección de leads recomendados del día».

**Por qué.** Esa semana nueve personas de un equipo usaron el buscador y gastaron ahí sus créditos, mientras solo cuatro abrieron los contactos ya elegidos para ellas. El buscador es donde están.

**Qué hace** (`src/components/search/SearchRecommended.tsx`, reglas en `src/lib/search/recommended-notice.ts`). Arriba de «Buscar prospectos», antes de los filtros, están los contactos recomendados que la persona todavía tiene por revisar, como resultados que ya están ahí: la sección «Ya buscamos por ti».

- **Qué muestra:** el título («Tienes 6 contactos recomendados para hoy» o «Te esperan 2 contactos recomendados») y una fila por contacto, la misma de «Hoy»: quién es, su porcentaje de recomendación, una línea de por qué y su paso siguiente («Enriquecer · 1 crédito», luego «Aprobar y programar»). El detalle y la campaña se abren en la misma fila.
- **Tres filas, y el resto a pedido:** «Ver los 6» trae los demás. En teléfono se muestra una fila, para que los filtros no queden lejos.
- **Las filas no desaparecen:** un contacto recién enriquecido se queda en su fila con el paso que sigue; el título cuenta lo que falta.
- **«Ocultar»** pliega la sección a una línea («Tienes 6 contactos recomendados para hoy. Mostrar»). Se recuerda en el navegador para esos contactos; los del día siguiente se muestran de nuevo.
- **Un contacto al día** (equipos sin plan de varios) es una línea con «Ver mi contacto».
- **Cuándo cuenta como abierto:** al primer gesto de la persona sobre la sección («Ver los N», abrir el detalle de una fila, enriquecer, aprobar, evaluar) se marca `opened_at`, igual que al abrir la página de sus contactos. Verla de paso hacia una búsqueda no cuenta.
- **Si no hay nada pendiente o la lectura falla,** no se muestra nada: la página es el buscador.

**Por qué cambió dos veces.** El 19 de noviembre fue una franja y, el mismo día, un aviso grande al centro con dos respuestas, a pedido del dueño («necesito que el aviso sea grande, que tenga dos opciones: o lo cierran o van a la sección»). En dos días el aviso no llevó a nadie a sus contactos: de 29 personas que los recibían, 3 abrieron alguno, y el 19 y el 20 no hubo ninguna apertura; quien entraba a buscar lo cerraba y buscaba. El 21 de noviembre el dueño eligió mostrar los contactos mismos en el buscador («hagamos el 3»), y el aviso emergente se quitó.

## Cómo funciona

1. **Preparación** (`leadDropsTick`, de lunes a viernes de 02:00 a 07:40 de Chile, cada 20 minutos, `/api/cron/lead-drops`; cada equipo solo en los días de su plan, por defecto martes, miércoles y viernes):
   - **Para quién:** quien recibirá el correo. Es decir, quien tiene los avisos encendidos y una dirección que no es de prueba, y a quien le llega el correo: con Resend, a todos; sin Resend, a quien tiene su Gmail u Outlook conectado (o con el correo de informes configurado). Una vez por persona, en el workspace de su equipo: el que tiene más personas.
   - **A quién buscar: el cliente ideal de cada persona** (desde el 29 de octubre):
     - el de su «Perfil», si lo declaró;
     - si no, el de la empresa (`companyDropCriteria`): el de la «Ficha de la empresa»; si no hay, el que más se repite en los «Perfil» del equipo (si empatan, el de un administrador); si nadie lo tiene, los cargos y rubros que más se repiten entre los contactos que guardó el equipo.

     Sin nada de eso no hay contacto, y queda dicho por qué (`status = empty`).
   - **Grupos para ahorrar Apify** (`groupDropPeople`): cada búsqueda paga el mínimo de Apify aunque traiga pocos contactos, así que quienes buscan algo parecido comparten una.
     - Alguien entra a un grupo si la mitad o más de las palabras de sus cargos y de sus rubros ya están en el grupo, y busca en un país que el grupo busca. Se comparan sin el nivel del cargo («Gerente», «Jefe») y en singular; «RR. HH.», «HR», «Personas», «Capital humano», «Talento humano», «People» y «Talento» cuentan como lo mismo.
     - La búsqueda del grupo suma los cargos y rubros de quien entra, hasta 6 de cada uno, y busca en el país de quien lo abrió.
     - Quien no se parece a ningún grupo tiene su propia búsqueda. El cliente ideal más repetido abre el primer grupo.
     - **Tope:** `LEAD_DROPS_MAX_GROUPS` búsquedas por empresa al día (5 por defecto). Pasado el tope, cada grupo chico se suma al más parecido.
     - **Historia:** hasta el 26 de octubre cada persona tenía su búsqueda (el 21, 35 personas de dos empresas hicieron 11 búsquedas, US$0,99). Del 27 al 29, una por empresa, y quien vendía otra cosa recibía contactos que no eran de su área (Facility recibía Recursos Humanos). Con los perfiles de GrupoExpro del 29 de octubre salen 4 búsquedas: Recursos Humanos (unas 25 personas), Recursos Humanos en servicios y logística (2), Perú (1) y Facility (1).
   - **Cliente ideal completado por ANTON.IA:** el 20 de octubre se completó el de las 31 personas de clientes que no lo tenían. A quien guardó 5 contactos o más, con los cargos y rubros de esos contactos; al resto, con uno por empresa (GrupoExpro: personal externo y RR. HH.; PSOL: selección). Queda marcado (`profile_extended.icpSource = 'anton'`) y «Perfil» lo avisa hasta que la persona lo guarda: si está de acuerdo, «Confirmar» lo deja como suyo sin editar nada.
   - **Una búsqueda por grupo:** Leads Finder (Apify, `code_crafter/leads-finder`) busca solo correos validados. Trae el doble de lo que el grupo necesita más cinco, con un mínimo de diez.
     - El tope de cada corrida nunca baja del de una búsqueda normal (`LEADS_FINDER_MAX_RUN_USD`, US$0,50). Apify rechaza topes bajo su mínimo (`max-total-charge-usd-below-minimum`), y uno de US$0,03 hizo fallar la primera prueba real (20 oct). Es solo el límite: el costo sale de los resultados que trae.
     - **Rubros:** van con el nombre que usa el actor (`leadsFinderIndustry`: «Seguridad privada» → *security & investigations*, «Logística» → *logistics & supply chain*). Un rubro que no reconoce se omite. En la búsqueda normal pasaría como palabra clave de la empresa, y junto a otro rubro casi nadie calza: así salió vacía la segunda prueba real.
     - **Sin nadie con esos rubros o tamaños,** se busca una vez más solo con cargos y lugares. Si tampoco hay nadie, la pantalla lo dice así («Esta vez no encontramos a nadie») y no como si el equipo ya los tuviera.
   - **Reparto:** un contacto por persona (`DROP_SIZE`), distinto entre compañeros y, mientras alcancen, de una empresa que nadie más del equipo recibió.
     - Primero quienes tienen teléfono y un cargo más cercano al cliente ideal de *esa* persona, aunque la búsqueda sea del grupo. Lo que se guarda y se muestra («Por qué calza») es su propio cliente ideal.
     - Nunca alguien que el equipo ya tiene en «Por escribir» o «Conversaciones», ni quien llegó otro día de los últimos 180.
     - **Nunca una empresa de otro país que el buscado** (`foreignDomain`). La búsqueda filtra por dónde está la *persona*, no la empresa: el 21 de octubre llegó un contacto «en Santiago» de Gou, una empresa de mudanzas de México (`gou.mx`), y quien lo recibió preguntó por qué era mexicano. Si el dominio es de un país (`.mx`, `.com.ar`) y los lugares del cliente ideal nombran otro («Chile»), se deja fuera aunque tenga teléfono. Un `.com`, un `.co` suelto o lugares sin país («Santiago») no dicen nada, y ahí no se descarta a nadie.
   - **Dónde queda:**
     - el correo y el teléfono, cifrados en `lead_search_vault` (30 días);
     - lo visible, en `lead_drops.items`: nombre, cargo, empresa, por qué calza y los datos de la empresa.
     - Desde el 29 de octubre también: el nivel y el área de la persona en español («Gerencia o jefatura», «Recursos humanos»), su región y país, el sitio y la página de LinkedIn de la empresa (públicos; el LinkedIn de la persona sigue en la bóveda) y **cómo calza, criterio por criterio** (`dropFit`):
       - **Cargo y rubro:** por sus palabras, sin el nivel del cargo y con los mismos sinónimos de los grupos («Head of People» calza con «Gerente de Personas»). Un rubro calza también si la búsqueda lo nombra igual: «servicios transitorios» se busca como *staffing & recruiting*, que es «Reclutamiento y personal».
       - **Lugar:** por nombre o por país. Si no nombra ninguno de los lugares pedidos pero está en el país, es «En parte» («Las Condes» para «Santiago»); si está en otro país, «No».
       - **Tamaño:** solo si el cliente ideal lo pide.
       - Lo que la búsqueda no trajo dice «Sin dato»: no se adivina.
     - El cargo va con «de» e «y» en minúscula («Jefe de Reclutamiento y Selección»), y el rubro en español, como lo dice «Empresas» del CRM (`industryLabel`): «logistics & supply chain» es «Logística».
2. **Redacción**, en la misma pasada o la siguiente:
   - Haiku resume en una frase qué hace la empresa, solo con la descripción que trajo la búsqueda.
   - **Por qué le sirve** (`adviseOn`, desde el 29 de octubre; idea del dueño: «agrégale más info para que el usuario sepa por qué es recomendado»): Haiku conecta la oferta de la persona («Perfil» o la ficha de la empresa: oferta, servicios, resultados, diferenciadores) con el cargo, el área y la empresa del contacto. Da 2 o 3 razones y una sugerencia de cómo abrir la conversación, sin redactar el correo.
     - Solo con esos datos: nunca el correo ni el teléfono. Una razón con una cifra que no está en los datos («baja la rotación un 30%») se descarta.
     - Sin oferta no hay nada que conectar y no se pide; si falla, el contacto queda igual, con la tabla de calce.
     - Corre a la vez que la Redactora y cuesta una llamada corta por contacto.
   - La **Redactora de Cowork**, con sus mismas reglas, sus chequeos y la Revisora, escribe el primer correo. Usa la oferta, las pruebas y la firma de «Perfil» (o la oferta del workspace).
   - El contacto queda `ready`.
3. **Envío:** el aviso de la mañana (`dailyAlertsTick`, 08:00) lo lleva, así que nunca hay dos correos el mismo día.
   - **Asunto:** «Tu contacto de hoy: Gerente de Personas en Ripley», salvo que haya algo más urgente, como una respuesta o un compromiso.
   - **Cuerpo:** un bloque por contacto (nombre, cargo · empresa, por qué calza y la primera razón de por qué le sirve), no una tabla: una tabla de tres columnas se rompe en un teléfono. Con el contacto va su botón «Ver y guardar», el único botón principal del correo: «Abrir ANTON.IA» pasa a ser un enlace. Si hay otras cosas en el aviso (una respuesta, un compromiso), van en la lista y el contacto no se repite como una línea más; si el contacto es lo único, el saludo lo dice («Tu contacto del día ya está listo») y no hay lista ni título.
   - **Por qué calza:** lo que coincidió, sin repetir el cargo que se ve al lado: «Calza con tu cliente ideal por su cargo y su rubro (logística), en Santiago.» («de tu equipo» o «de tu empresa» para quien no declaró uno) (`whyText`).
   - **Adjunto:** `contacto-del-dia-AAAA-MM-DD.pdf`, armado con el motor de documentos de la app (`dropDocument`, `src/lib/documents`), con el mismo diseño de los demás documentos:
     - el nombre como título, cargo y empresa debajo, y «Para» y la fecha en español («28 de octubre de 2026»);
     - «Ver y guardar en ANTON.IA» como enlace, no la dirección completa;
     - «Por qué te lo recomendamos» en un recuadro: por qué calza y, debajo, las razones de por qué le sirve;
     - «Cómo calza con tu cliente ideal», una tabla: criterio, este contacto, lo que buscas y ¿calza? (Sí, En parte, No, Sin dato);
     - «Sobre la persona»: nivel, área y qué datos de contacto trae (el lugar ya está en la tabla);
     - «Sobre <empresa>»: qué hace, y en una línea rubro y tamaño (si no están en la tabla), su sitio y su LinkedIn como enlaces;
     - «Cómo abordarlo» y el primer correo en su propio recuadro, con el asunto en su primera línea y la firma junta;
     - si hay varios contactos, uno por página.
     - Un contacto de antes del 29 de octubre, sin esas partes, muestra lo que tiene: por qué calza, «Lo que sabemos de la empresa» y el correo.
     Hasta el 29 de octubre se dibujaba a mano con jsPDF: la dirección larga a la vista, la fecha «2026-10-28» y todo con el mismo peso.
   - Una vez enviado, pasa a `sent`.
4. **En la app** (`/search/contactos/<id>`, dentro de «Buscar prospectos»):
   - **Título:** «Tu contacto del día» («Tus contactos del día» si son varios), no «Buscar prospectos».
   - **«Así lo buscamos»:** la primera vez que se abre en ese dispositivo, los filtros usados y los pasos de la búsqueda, uno a uno: «Buscando…», «Revisando que tengan correo verificado», «Quitando a quienes tu equipo ya tiene» y «Escribiendo un primer correo». Con movimiento reducido o con «Ver ahora», aparecen de inmediato. Al terminar se guarda que ya se vio (`localStorage`, `anton:drop-played:<id>`): volver a escribirle no espera la animación otra vez.
   - **Después, plegado:** «Así lo buscamos» queda como una fila bajo el contacto, con los filtros en una línea («Gerente de Personas +2 · Retail +1 · Chile»); se abre para ver cargo, rubro y lugar. Lo que se ve primero es el contacto.
   - **El contacto:** su nombre como título, cargo y empresa, y debajo nivel, área y lugar. «Por qué te lo recomendamos»: por qué calza, las razones de por qué le sirve, «Correo verificado» y «Teléfono» si lo hay. Luego cómo calza criterio por criterio («Calza», «Calza en parte», «No calza», «Sin dato», con lo que buscas debajo), su empresa con sus enlaces, cómo abordarlo y el primer correo, con «Copiar»; el asunto va con su nombre («Asunto: …»). Con varios contactos, el calce, la empresa y el correo van plegados en cada uno.
   - **Una acción a la vez:**
     - «Guardar en «Por escribir»» usa el correo y el teléfono de la bóveda, **sin créditos ni otra búsqueda**. Si ya estaba en «Por escribir» con ese correo, se enlaza sin duplicarse. La investigación, el borrador y las razones quedan en `enriched_leads.data.leadDrop`.
     - Después, «Investigar y escribirle» abre «Por escribir» con su investigación completa ya en marcha (`?investigar=<id>&empezar=1`). Toma unos minutos (3 en la prueba real del 20 de octubre); luego «Preparar correos» deja el correo listo para revisarlo y enviarlo desde ANTON.IA.
     - **Por qué no se envía el correo sugerido tal cual:** en ANTON.IA todo lo que se envía sale de una investigación completa, con sus chequeos y revisión. El sugerido sirve para decidir y se puede copiar con «Copiar»; «Redactar» sin investigación solo ofrece investigar.
     - «Investigar a este contacto», en «Redactar», también la deja en marcha. Si el contacto ya tiene una investigación, o una en curso, se abre para leerla y no se repite.
   - **Teléfono:** si falta, se busca desde «Por escribir» como siempre.
   - **«Hoy»:** la tarjeta «Contacto del día» muestra su nombre, su empresa y por qué calza, con «Ver y guardar», hasta que se guarda. Un día de contacto, el nuevo va antes que el que quedó sin guardar (`homeDrop`). Si no hay contacto por guardar, ver la sección siguiente.

   Si algún día `DROP_SIZE` sube, la misma pantalla los muestra como lista, con «Guardar los N».

## Desde «Hoy», sin correo

La preparación de la mañana es solo para quien recibirá el correo. Los demás, que hoy son la mayoría porque no tienen su Gmail u Outlook conectado, abren su contacto en «Hoy». Lo mismo vale para quien sí lo recibe por correo y entra antes.

- **Qué ofrece «Hoy»** (`pullStatus`, en `GET /api/lead-drops/latest` como `pull`) cuando no hay contacto por guardar:

  | `pull` | Cuándo | Botón |
  | --- | --- | --- |
  | `first` | Nunca recibió uno, o el último vino vacío por falta de cliente ideal. Cualquier día. | «Ver mi primer contacto» |
  | `today` | Martes, miércoles y viernes, si hoy aún no tiene. | «Ver mi contacto de hoy» |
  | `preparing` | El de hoy se está preparando. | «Ver cómo va» |
  | `profile` | No hay cliente ideal propio, del equipo ni inferido de lo guardado. | «Completar mi cliente ideal», a «Perfil» |

  No ofrece nada cuando el de hoy ya está, cuando el presupuesto del mes no alcanza para una búsqueda o con `LEAD_DROPS_ENABLED=off`.
- **Al abrir** `/search/contactos/nuevo`, la pantalla llama a `POST /api/lead-drops/now` (`pullDrop`). En la misma petición, de uno o dos minutos, se hace una búsqueda solo para esa persona (diez resultados, unos US$0,02 a US$0,035), con el mismo reparto, y luego la redacción.
  - Mientras tanto se ven «Así lo buscamos» y los pasos. Avanzan al ritmo del trabajo, sin marcar el último como listo.
  - Al terminar, la dirección pasa a `/search/contactos/<id>` y aparece el contacto.
- **Sin cliente ideal** no se busca ni se guarda nada, y la pantalla lleva a «Perfil». Apenas lo hay, el contacto se hace. Eso vale aunque la corrida de la mañana haya dejado uno vacío ese mismo día por ese motivo: se reemplaza, porque no costó nada.
- **Una sola búsqueda:** antes de buscar se reserva la fila del día (`pending`, sin contactos). Una segunda petición, desde otra pestaña o al volver desde «Hoy», responde `pending` y la pantalla espera.
- **Si la petición se corta,** «Hoy» muestra «Ver cómo va». Pasados 4 minutos sin avance, la siguiente petición retoma:
  - busca de nuevo si se cortó la búsqueda;
  - solo escribe el correo si ya tenía el contacto.

  La corrida de la mañana no toca las filas reservadas sin contactos.
- **Vacío por otros motivos** (sin presupuesto, búsqueda fallida o ningún contacto nuevo): la pantalla lo dice en simple, con el día del próximo contacto, y ofrece «Buscar con mis filtros». Si no hubo contactos nuevos, ofrece además ampliar el cliente ideal.
- **Costo:** desde «Hoy» la búsqueda es por persona y no por equipo, así que cuesta más por contacto que la corrida de la mañana. Cuenta para el mismo tope mensual.

## Costos y topes

- **Apify:** Leads Finder cuesta entre US$0,002 (`LEADS_FINDER_USD_PER_LEAD`, por defecto) y US$0,0035 por persona (prueba del 6 oct 2026).
  - Una búsqueda para una persona trae diez resultados, de US$0,02 a US$0,035.
  - En la corrida de la mañana, un equipo de 30 con el mismo cliente ideal comparte una búsqueda de 65, de US$0,13 a US$0,23.
- **Al mes**, con 13 días de contacto: unos US$0,26 a US$0,46 por persona que lo abre desde «Hoy».
- **Tope:** `LEAD_DROPS_MONTHLY_USD` limita lo que se gasta en el mes, sumando todos los workspaces (US$3 por defecto). Al llegar al tope, los contactos del día quedan vacíos con el motivo, y «Hoy» deja de ofrecerlos. Aparte del tope, si el plan de Apify se queda sin saldo, la búsqueda falla: por eso hay un aviso por correo cuando le quedan US$0,10 (`APIFY_ALERT_EMAILS`, ver `docs/deployment.md`).
- **Plan de Apify:** el de la cuenta es el gratuito, de US$5 al mes, y lo comparten Oportunidades y la búsqueda híbrida. Para todos los usuarios hace falta subir el tope y, probablemente, un plan pagado: es una aprobación pendiente.
- **Modelos:**
  - la Redactora usa el modelo de Cowork (`COWORK_WRITER_MODEL` o `COWORK_MODEL`);
  - el resumen de la empresa, las razones y la investigación corta usan `LEAD_DROPS_RESEARCH_MODEL` (Haiku 5.5 por defecto).
- **Apagar:** `LEAD_DROPS_ENABLED=off` lo detiene.

## Probar con una cuenta de prueba

Lo más simple es entrar con la cuenta de prueba en su propio workspace, con el cliente ideal completo, y pulsar «Ver mi primer contacto» en «Hoy». No hace falta ningún secreto, y el contacto queda en ese workspace.

También hay una corrida manual, con el mismo secreto del scheduler. Prepara el contacto solo para quienes se nombran, reciban o no correos: `POST /api/cron/lead-drops` con `{ "userIds": ["…"], "organizationId": "…" }`.

- **`organizationId` fija el workspace:** el contacto se hace ahí y solo para sus miembros. Así, una cuenta de prueba que también está en el workspace de un cliente nunca escribe en él.
- **Días:** como la corrida programada, solo los días del plan de ese equipo (martes, miércoles y viernes si no dice otra cosa).

## Datos

La migración `20261020180000_lead_drops.sql` crea la tabla `lead_drops`, solo para el servidor: RLS activo y sin permisos para `anon` ni `authenticated`.

- **Unicidad:** una fila por persona, workspace y día.
- **Estados:** `pending`, `ready`, `sent`, `empty` y `failed`.
- **Seguimiento:** el gasto (`cost_usd`) y el motivo cuando está vacío, además de cuándo se envió, abrió y guardó.

## Código

| Pieza | Archivo |
| --- | --- |
| Reglas (puro): días, tamaño, reparto, correo | `src/lib/lead-drops.ts` |
| Buscador con IA para equipos con varios contactos al día | `src/lib/server/lead-drop-finder.ts` |
| Investigación corta de cada contacto | `src/lib/server/lead-drop-research.ts` |
| Editar los correos, «me sirve / no me sirve», «Aprobar y programar» y el correo «Campaña lista para aprobar» | `src/lib/server/lead-drop-campaign.ts`, `src/lib/lead-drop-campaign-email.ts` |
| Preparación, redacción, guardado y PDF; desde «Hoy» (`pullStatus`, `pullDrop`, `homeDrop`) | `src/lib/server/lead-drops.ts` |
| En el aviso de la mañana | `src/lib/daily-alerts.ts`, `src/lib/server/daily-alerts.ts` |
| Adjuntos del correo | `src/lib/server/self-email.ts` |
| Cron | `src/app/api/cron/lead-drops/route.ts`, `functions/index.ts` (`leadDropsTick`) |
| API | `src/app/api/lead-drops/[id]` (leer y guardar), `[id]/pdf`, `latest` y `now` (hacer el de hoy) |
| Pantalla | `src/app/(app)/search/contactos/[id]/page.tsx`, `src/components/lead-drops/LeadDropFlow.tsx`, `DropContactCard.tsx` (varios contactos) |
| Desde el correo, sin sesión: enlace firmado, acciones del servidor, página y conexión del buzón | `src/lib/server/lead-drop-link.ts`, `src/lib/server/lead-drop-mail.ts`, `src/app/api/lead-drops/link/route.ts`, `src/app/contactos/[token]/page.tsx`, `src/components/lead-drops/DropMailFlow.tsx`, `src/lib/server/provider-oauth-link.ts` |
| «Hoy» | `src/components/home/LeadDropBanner.tsx` |
