# Panel de LinkedIn renovado (Plan 8, fase 4, PR-4a)

El panel lateral de la extensión se reordena alrededor de la persona abierta en LinkedIn. Arriba se ve dónde está ese contacto y un solo botón con el paso siguiente; el resto queda en cuatro pestañas. Usa la paleta de la app, en claro y en oscuro, y sigue el perfil abierto sin consultar cada segundo.

## Estructura

**Encabezado:**
- la organización y la cuenta conectada;
- los créditos de hoy, los mismos que muestra la app (`quota/status`): una sola asignación para buscar correos y teléfonos e investigar;
- el botón para desconectar.

**La persona** (`chrome-extension/ui/person-status.ts`):
- **Estados:** «Guardado» o «Sin guardar», «Con correo» o «Correo verificado», «Teléfono pendiente», «Investigando…», «Investigado», «Investigación con problemas» y «Mensaje enviado». Cada uno dice su estado en texto, no solo con color.
- **El paso siguiente,** en el orden en que un contacto queda listo:
  1. «Enriquecer perfil»;
  2. «Guardar lead»;
  3. «Buscar correo»;
  4. «Investigar lead»;
  5. «Escribir mensaje», o «Revisar el mensaje» si ya hay un borrador.
- **Mientras se investiga o después de enviar,** no hay botón: lo dicen los estados.
- **Las pestañas no repiten el botón de la tarjeta:** lo que ofrece la tarjeta, la pestaña lo deja fuera. Así no hay dos botones iguales a la vista.

**Pestañas** (con las flechas del teclado, `Inicio` y `Fin`):

| Pestaña | Qué tiene |
|---|---|
| Resumen | Qué buscar al enriquecer, los datos del contacto, «Guardar cambios» y «Buscar teléfono» |
| Investigación | El estado con los tres pasos de la app (buscar y leer fuentes, escribir y revisar el informe, listo para escribirle), el informe, el PDF y «Investigar de nuevo» |
| Mensaje | El mensaje de LinkedIn (redactar, opciones, preparar, copiar y enviar con confirmación) y el correo (secuencia, primer correo y campaña existente) |
| Más | Trabajos de Cowork, barrido de red y bandeja, e historial de LinkedIn |

## Cómo sigue el perfil abierto

**Antes,** el panel preguntaba por el perfil cada 1,5 segundos y por la sesión cada 10.

**Ahora, solo con eventos:**
- **La página de LinkedIn avisa** (`prospecting-content.js`) cuando cambia el perfil en pantalla:
  - por la URL o por el nombre, que LinkedIn dibuja después de la URL;
  - lo detecta con un `MutationObserver` y `popstate`, con 300 ms de espera.
- **El aviso es solo una señal:** el panel vuelve a leer el perfil por el worker, con sus validaciones de siempre. Solo acepta avisos de la propia extensión, desde una pestaña de LinkedIn.
- **El navegador avisa** cuando cambia la pestaña (`tabs.onActivated` y `tabs.onUpdated`).
- **La sesión cambia en el almacenamiento** (`storage.onChanged`) y se revisa cuando el panel vuelve a estar visible.

## Estados de error y reconexión

- **Sesión terminada:** si la sesión desaparece sin «Desconectar» (expiró o cambió la cuenta), la bienvenida lo dice y ofrece conectar de nuevo.
- **Panel desactualizado:** si la extensión se actualizó con el panel abierto, una tarjeta lo explica y ofrece «Recargar panel». Los borradores se conservan.
- **Sin internet:** un aviso dice que lo que se haga se reanuda al volver la conexión.
- **Mientras abre:** esqueletos de carga.
- **Avisos:** lo que corre, lo que falló o lo que se hizo va en una barra al pie, que entra y sale sin tapar el área de trabajo. Un solo aviso anunciado a lectores de pantalla.

## Aspecto

- **Tokens:** `chrome-extension/ui/panel.css` importa `src/styles/design-tokens.css` y usa sus alias `cw-*`. No hay colores propios. El modo oscuro sigue al sistema (`html.dark`), como la app.
- **Movimiento** (`docs/ui-ux/motion.md`):
  - lo que entra lo anima CSS: tarjeta, estados y pestaña;
  - la barra de avisos entra y sale con `framer-motion`, con `MotionConfig reducedMotion="user"`;
  - con «reducir movimiento», solo queda el indicador de trabajo.
- **Tamaño del panel:** sube 29 KB comprimido, por `framer-motion`.

## API

La extensión suma la acción `quota` en `/api/extension/workspace`:
- no pide un perfil;
- devuelve `{ credits: { used, limit, remaining, resetAt } }` de la persona y la organización conectadas;
- otra cuenta u organización en el pedido responde 409 antes de leer nada.

## Pruebas

- **`chrome-extension/tests/person-status.test.mjs`:** el orden de los pasos, sin botón mientras se investiga, los estados y los tres pasos de la investigación.
- **`chrome-extension/tests/profile-announce.test.mjs`:**
  - un perfil nuevo y su nombre se anuncian una vez cada uno;
  - lo que no cambia el perfil no se anuncia;
  - una navegación sin recargar sí se anuncia;
  - sin la extensión, la página no se rompe.
- **`src/app/api/extension/workspace/route.test.ts`:** los créditos de la persona, sin perfil, y otra cuenta rechazada.
- **`scripts/test-linkedin-extension-browser.mjs`** (Chromium, con la frontera de Chrome simulada):
  - el flujo completo, en claro y oscuro, a 320, 380 y 520 px;
  - créditos, estados y el paso siguiente;
  - pestañas con teclado;
  - el cambio de perfil por aviso, y que sin aviso no se consulta nada en 2 segundos.
  - Para correrlo sin Chrome estable: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<ruta de Chromium>`.

## Marca en cada perfil (PR-4b)

Junto al nombre de cada persona en LinkedIn aparece lo que la organización sabe de ella. Se ve en su perfil y en los resultados de búsqueda de personas que ya están en pantalla, sin abrir el panel.

**Qué dice, en este orden** (`src/lib/extension-presence.ts`):
1. **Otra persona del equipo la trabaja,** con la colaboración activa:
   - «Guardado por Ana»;
   - «En conversación con Ana»;
   - «Contactado por Ana · libre desde el…»;
   - «Ganado por Ana».
   - Son los mismos textos de los bloqueos de equipo (`teamLockNotice`). Si bloquea, el panel pide coordinar antes de escribirle.
2. **«Respondió hace N días»,** si la respuesta es posterior al último contacto.
3. **«Contactado hace N días por LinkedIn» o «por correo»:**
   - LinkedIn: el último envío confirmado desde la extensión;
   - correo: el último envío registrado.
4. **«Guardado»,** o «Guardado en tu organización» si lo guardó otra persona.

Sin nada que decir, no hay marca.

**Cómo se lee** (`src/lib/server/extension-presence.ts`, acción `presence`):
- **Pedido:** hasta 50 perfiles por llamada, los de una página de resultados.
- **Lecturas con el cliente de la persona,** como los bloqueos de equipo:
  - contactos guardados;
  - «Por escribir»;
  - envíos de correo.
- **Lectura con la clave de servicio,** acotada a la organización activa: los envíos de LinkedIn, porque esa tabla no da permisos a los miembros.
- **Se compara el perfil exacto:** «ana» no es «ana-perez».

**En la página de LinkedIn** (`prospecting-content.js`):
- **La marca** va en un shadow DOM cerrado, junto al nombre. No toca el texto del nombre ni los estilos de LinkedIn.
- **Sus propias inserciones no disparan otra consulta.**
- **No hace clics ni desplazamientos.**
- **Sin cuenta conectada,** no hay marcas.

**Caché:**
- el worker guarda cada respuesta 5 minutos;
- al guardar, enviar, ejecutar un trabajo de Cowork o desconectar, la borra y avisa a las pestañas de LinkedIn para que pregunten de nuevo.

**En el panel,** la misma línea se suma a los estados de la tarjeta (sin repetir «Guardado»).

**Pruebas:**
- **`src/lib/extension-presence.test.ts`:** el orden y los textos.
- **`src/lib/server/extension-presence.test.ts`:**
  - todo acotado a la organización;
  - solo envíos confirmados;
  - el perfil exacto;
  - el bloqueo de equipo antes que lo propio;
  - un tope de 50.
- **`chrome-extension/tests/presence-marks.test.mjs`:**
  - la marca junto al nombre, que se actualiza y se quita;
  - los resultados sin repetir;
  - sin un bucle por las marcas propias;
  - sin cuenta, nada.
- **La ruta:** una prueba para otra cuenta y una para más de 50 perfiles.
- **El navegador:** el aviso de coordinar en la tarjeta.

## Guardar en lote desde la búsqueda (PR-4c)

En una búsqueda de personas de LinkedIn (`/search/results/people/`), el panel muestra a las personas que ya están en pantalla. Desde ahí se pueden guardar varias de una vez.

**Lo que se ve:**
- **Encabezado:** «N personas en esta búsqueda».
- **Una casilla por persona:** con su nombre, su titular y la marca de PR-4b, si la organización ya la conoce.
- **«Seleccionar disponibles»:** marca solo a quienes la organización todavía no tiene, hasta 25.
- **Quien trabaja otra persona del equipo** («En conversación con Ana») no se puede elegir.
- **«Guardar N en Anton.IA»:** guarda el lote y responde en una línea. Por ejemplo: «2 contactos guardados en tu organización. 1 ya estaba guardado. No se guardó Pedro Díaz (En conversación con Ana).»

**Qué se lee de la página:**
- solo lo que LinkedIn ya muestra: el enlace `/in/`, el nombre y el titular;
- el cargo y la empresa, cuando el titular los dice («Jefa de Operaciones en Minera Norte», «… at …», «… | …»);
- hasta 50 personas, sin desplazar, sin hacer clic y sin abrir perfiles;
- **Sales Navigator** no muestra el perfil público. El panel lo dice y pide abrir el perfil para guardarlo.

**API: acción `save-batch`** en `/api/extension/workspace`:
- recibe hasta 25 perfiles;
- quita los repetidos;
- relee los bloqueos de equipo en el servidor, aunque el panel ya los haya filtrado;
- usa el mismo guardado de un perfil (`saveExtensionLead`), sin pisar lo que ya estaba;
- devuelve `saved`, `already`, `blocked` (con el motivo) y `failed`.

**Después de guardar,** la marca de cada persona se vuelve a pedir: ahora dice «Guardado».

**«Preparar»** (buscar correo e investigar a varios con una sola aprobación) sigue en Cowork (`contacts.prepare_batch`). El texto de ayuda lo menciona.

**Pruebas:**
- **`src/lib/server/extension-batch.test.ts`:** el tope de 25, los repetidos, los bloqueados, los que ya estaban y los errores por persona.
- **La ruta:** `save-batch` para otra cuenta y para más de 25 perfiles.
- **`chrome-extension/tests/search-results.test.mjs`:**
  - la lectura de los resultados (nombre, titular, cargo y empresa);
  - fuera de una búsqueda no hay nadie;
  - el tope de 50.
- **`chrome-extension/tests/search-batch.test.mjs`:** «Seleccionar disponibles», los perfiles que se envían y el resumen.
- **El navegador:**
  - la persona bloqueada no se puede elegir;
  - «Seleccionar disponibles» marca a las otras dos;
  - «Guardar 2 en Anton.IA» envía exactamente esos dos perfiles y muestra el resumen;
  - la marca se vuelve a pedir;
  - sin desborde a 320, 380 y 520 px, en claro y oscuro.

## Ficha de empresa (PR-4d)

En una página de empresa de LinkedIn (`linkedin.com/company/…`), el panel muestra una tarjeta «Empresa». Va arriba de todo, también en sus pestañas «Acerca de» y «Personas».

**Lo que se ve:**
- **El nombre y una línea con lo que muestra la página:** sector, tamaño y sede.
- **«Está contratando»** (solo para las cuentas de `OPPORTUNITIES_ALLOWED_EMAILS`, la cuenta piloto):
  - la señal de la oportunidad, con la misma frase que en la página y en Cowork («Minera Norte publicó 6 avisos de empleo en los últimos 30 días…»);
  - el enlace «Ver en Oportunidades».
- **«N contactos guardados»:** los de la organización en esa empresa, cada uno con la marca de PR-4b («Respondió hace 2 días», «En conversación con Ana»). El nombre abre su perfil.
  - Se muestran hasta 20.
  - Sin contactos, el panel dice qué hacer.
- **«Buscar decisores en Anton.IA»:** abre la Búsqueda de la app con la empresa, su dominio y los cargos de «Perfil» (`companySearchHref`). La persona revisa y busca ahí, con el costo de siempre. La extensión no busca ni gasta créditos.
- **«Ver sus personas en LinkedIn»:** abre la pestaña «Personas» de la empresa. Ahí se puede elegir y guardar a quienes se ven, con el lote de PR-4c («N personas de Minera Norte en pantalla»). Su empresa es la de la página cuando el titular no la dice.

**Qué se lee de la página:**
- el nombre (el `h1`);
- los datos del encabezado: sector, sede y empleados (no los seguidores);
- en «Acerca de»: sitio web, sector, tamaño y sede;
- el sitio web se saca del enlace de redirección de LinkedIn;
- sin clics, sin desplazar y sin abrir otras pestañas.

**API: acción `company`** en `/api/extension/workspace`, solo lectura.

Busca los contactos en `enriched_leads` y `leads` de la organización activa por:
- la página de LinkedIn de la empresa (`leads.company_linkedin`);
- el dominio (`organization_domain`, el dominio del correo y `company_website`);
- el nombre sin sufijo legal («Minera Norte S.A.» es «minera norte»).

Un nombre contenido en otro no cuenta: «Falabella» no es «Banco Falabella». La misma persona guardada dos veces cuenta una.

La oportunidad:
- se lee con el cliente de servicio, después de comprobar la cuenta con `isOpportunitiesUserAllowed`;
- usa el mínimo de avisos del perfil de búsqueda;
- no incluye las descartadas;
- si falla, la tarjeta igual muestra los contactos.

**`PROSPECT_OPEN`** ahora también abre `/search?…` y `/opportunities` de la app.

**Pruebas:**
- **`src/lib/extension-company.test.ts`:** la URL de la empresa, el dominio, el nombre sin sufijo y «la misma empresa».
- **`src/lib/server/extension-company.test.ts`:**
  - cada contacto una vez, con su marca;
  - solo la organización activa;
  - el enlace de búsqueda con los cargos de «Perfil»;
  - la oportunidad solo para la cuenta piloto, sin confundir «Minera Norte» con «Minera Norte Grande»;
  - sin nada que buscar, no se lee nada.
- **La ruta:** la empresa llega con sus claves; sin empresa, con una página que no es de empresa o con otra cuenta, se rechaza.
- **`chrome-extension/tests/company-page.test.mjs`:**
  - la lectura del encabezado y de «Acerca de», con el sitio sacado de la redirección;
  - la pestaña «Personas» como resultados;
  - los textos de la tarjeta.
- **El navegador:**
  - la tarjeta con su línea de datos, los contactos y la señal;
  - «Buscar decisores» y «Ver en Oportunidades» abren la app;
  - la pestaña «Personas» con el lote;
  - sin desborde a 320, 380 y 520 px, en claro y oscuro.

## Apertura con su actividad reciente (PR-4e)

Al redactar un mensaje de LinkedIn, el panel lee las publicaciones recientes de la persona en su perfil abierto. La Redactora puede abrir la conversación desde una de ellas.

**Qué se lee y cuándo:**
- **Cuándo:** solo al pulsar «Redactar», «Generar otra versión» o «Crear 3 opciones», y solo si la pestaña activa es el perfil de esa persona (`PROSPECT_ACTIVITY` compara el perfil).
- **Dónde:** en el perfil, la sección «Actividad»; en `/in/…/recent-activity/`, su feed.
- **Qué:** hasta 3 publicaciones, con su texto (máximo 600 caracteres), la fecha relativa que muestra LinkedIn («2 sem») y si la publicó, la compartió o la comentó.
- **Cómo:** solo lo ya renderizado, sin clics, sin «ver más» y sin desplazar.

**La Redactora** (`linkedin-conversation/v2`):
- recibe `recentActivity` y, si una publicación sirve al objetivo, abre desde ella: la cita o la parafrasea con fidelidad, dice si la publicó, la compartió o la comentó, y la conecta con la pregunta;
- devuelve cuál usó (`activityIndex`). Un índice que no corresponde a ninguna publicación cuenta como ninguna.

**Guarda:** si no recibió publicaciones y el mensaje dice «vi tu publicación», «compartiste», «your post» o algo parecido, se corrige como cualquier otro problema editorial.

**API:**
- la acción `message` acepta `recentActivity` (hasta 3);
- la publicación usada vuelve primera en `sources` (`kind: 'activity'`, con su texto y su fecha), junto con `activityRead`.

**En el panel:**
- **sobre el borrador:** «Abre desde su publicación · 2 sem» y la cita;
- **en el aviso:**
  - «revisa que la cita sea fiel» cuando el mensaje abre desde una publicación;
  - «No vimos publicaciones recientes en su perfil»;
  - «Sus publicaciones recientes no calzaban con tu objetivo»;
  - «Abre su perfil en LinkedIn para usar sus publicaciones recientes», cuando la pestaña es otra.
- **La cita viaja con las fuentes del borrador:** al volver al perfil se ve igual.

**Pruebas:**
- **`src/lib/server/linkedin-message-writer.test.ts`:**
  - abre desde la publicación dada y dice cuál;
  - un índice fuera de rango no cuenta;
  - sin publicaciones, «vi tu publicación» se corrige;
  - «postventa» no es una publicación.
- **La ruta:**
  - la actividad llega a la Redactora;
  - la publicación usada vuelve primera en las fuentes;
  - más de 3 publicaciones, o una de más de 600 caracteres, se rechaza;
  - sin actividad, la lista va vacía.
- **`chrome-extension/tests/activity.test.mjs`:**
  - la sección «Actividad» con publicación, compartida y comentario, hasta 3;
  - el feed de actividad, con el corte en 600;
  - fuera del perfil no se lee nada;
  - los textos del panel.
- **El navegador:** el borrador muestra «Abre desde su publicación · 2 sem», la cita y el aviso, y la petición lleva la publicación leída.

## Publicación

- **Se compila con `npm run extension:build`.** El ZIP para la tienda y la versión (4.1.0, al cerrar la fase 4) los publica el mantenedor.
- **Permisos:** no hay permisos nuevos.
