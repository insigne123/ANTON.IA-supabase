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
- **Escribir tarda más:** un envío de 6 contactos son 24 correos. La corrida escribe los 6 a la vez y junta en una ronda hasta 8 contactos.
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

## Cómo funciona

1. **Preparación** (`leadDropsTick`, de lunes a viernes de 06:00 a 07:40 de Chile, cada 20 minutos, `/api/cron/lead-drops`; cada equipo solo en los días de su plan, por defecto martes, miércoles y viernes):
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
