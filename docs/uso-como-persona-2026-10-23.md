# Usar la app como una persona: Cowork, Oportunidades y borradores (23 de octubre de 2026)

Esta página sigue a `docs/cowork-claude-evaluacion-2026-10-23.md`. Allí se midió con modelos; aquí se **usó** la pantalla, como lo haría quien trabaja con ella, y se corrigió lo que estorbaba. Nada de esto toca producción. El banco de recorridos no llama a ninguna API; las conversaciones de Cowork y los borradores de la última parte sí usaron Luna y Haiku con llaves de prueba, bajo un tope de US$2 que una guardia hace cumplir (ver «Gasto» en `docs/borradores-ganchos-y-reglas.md`).

## Cómo se hizo, y hasta dónde llega

- **Banco de recorridos** (`npm run audit:journeys`): compila la app real, la abre en Chromium a 1440×900 y a 390×844, con una base Supabase falsa en memoria y sin salida a internet. Las escrituras se contestan 503 salvo las que el recorrido declara. Cada paso se hace como lo diría una persona (por rol y nombre, nunca por selector), saca una captura y cuenta los clics.
- **Dos personas:** Camila, administradora, y Diego, integrante de un equipo. 23 recorridos: 7 de Cowork (tres de ellos, los de tareas programadas, solo con `AUDIT_COWORK_SCHEDULES=true`, porque en producción están apagadas), 12 de Oportunidades y 4 de borradores que se agregaron hoy (`journeys/borradores.mjs`).
- **El límite:** lo que contestan las IAs en el banco son datos de prueba. Ahí se juzgó **la pantalla**, no la calidad de los textos. Esa se juzgó leyendo, en la sesión, lo que la app ya había generado, sin pagar ninguna llamada (ver «Borradores»).

## 1. Cowork frente a Claude Code y Claude Cowork

Lo que una persona que viene de Claude espera encontrar, y lo que se vio:

| Se espera | Lo que se vio | |
| --- | --- | --- |
| Lista de conversaciones por día, con su estado | Hoy / Ayer, hora, punto de color cuando algo espera o corre. En el teléfono es un cajón | Igual |
| Saber qué hizo antes de responder | «Buscó en la web «…» · 3 resultados», «Leyó una página web · cl.sodexo.com», y la que no pudo leer dice «no se pudo» | Igual |
| Fuentes que se pueden abrir | La respuesta lleva sus enlaces (3), con `rel=noopener noreferrer`, y avisa cuando una cifra viene de una fuente secundaria | Igual |
| Copiar, valorar, pedir otra versión | Copiar, 👍, 👎, «Otra versión» y un siguiente paso sugerido con su botón | Igual |
| Aprobar un plan antes de actuar | «Plan de la tarea»: 4 pasos, qué va a pasar y qué no, lo máximo que puede gastar y lo que nunca hace sin preguntar; «Aprobar el plan» y «Descartar plan» | Equivalente al modo plan de Claude Code; más claro en dinero y en límites |
| Detener, editar el mensaje, escribir con algo corriendo | «Detener», «Editar mensaje» y el mensaje en espera existen | Igual |
| `@` y `/` en el cuadro | `@` busca contactos guardados y `/` ofrece plantillas; adjuntar archivos; atajos de teclado (solo escritorio) | Igual |
| Que recuerde y que se pueda ver | «Memoria» (antes «Lo que Cowork recuerda») muestra y olvida lo que sabe de ti y de tu equipo | Igual |
| Tareas programadas | Lista con su horario, próxima corrida y última, «Nueva tarea», «Programar este pedido» desde el cuadro | Igual, **apagado** (`COWORK_SCHEDULES_ENABLED`) |
| Que no haga nada sin preguntar | Enviar, activar una campaña o escribir por LinkedIn siempre pasan por aprobación y por un tope de créditos | **Más estricto** que ambos, a propósito: es un asistente comercial, no un agente de propósito general |

**Lo que no tiene, y no debe:** archivos locales, terminal, conectores abiertos. Cowork es el asistente de ventas de la cuenta; ahí la comparación con Claude Code no aplica.

**Lo que falta de verdad** es de configuración, no de pantalla: la web, el harness de Claude, los subagentes y las tareas programadas siguen apagados en producción.

**Ocho conversaciones de verdad, con los dos motores** (mismos pedidos, mismas herramientas de prueba, una repetición): «hola», «¿a quién le escribo hoy?», «quiero buscar nuevos leads para yago», «mejora este correo», «¿cómo me ha ido esta semana?», «¿qué oportunidades hay hoy?», un pedido de varios pasos y «prepárale la respuesta a Marcela Rojas».

| | Bucle de Luna (el de hoy) | Harness con Haiku 5.5 (apagado) |
| --- | --- | --- |
| Casos que cumplen las verificaciones | 6 de 8 (82 de 85 verificaciones) | 7 de 8 |
| Llamadas al modelo | 14 | 13 |
| Costo de las 8 conversaciones | unos US$0,05 (US$0,006 cada una) | unos US$0,06 (US$0,007 cada una) |
| Lo que falla | «¿cómo me ha ido?»: las cifras salen en prosa, no como tarjeta de cifras; «¿qué oportunidades hay?»: nombra las licitaciones pero no dice cuándo cierran | «mejora este correo»: ofrece convertirlo en campaña sin que se lo pidieran y el correo no queda más corto |

Leídas como las leería quien las usa, las dos contestan con criterio: dicen lo que no saben (Luna: «el cargo no confirma por sí solo quién decide la compra», «no aparecen envíos en lo registrado en ANTON.IA; eso no confirma que nunca les hayas escrito por fuera»; Haiku: «ese dato no está en tu oferta, así que el borrador no lo resuelve»), proponen en vez de ejecutar, dicen el costo antes de gastar el cupo o los créditos, y a Marcela le preparan la respuesta **sin inventar el precio ni el plazo** y dicen desde dónde se envía. Con Haiku el harness lee más antes de proponer (mira cuántos contactos hay antes de armar la búsqueda), se presenta en el saludo («Soy Cowork… tengo cargado que vendes AXIS…») y da más contexto (quién escribió, cuándo, qué preguntó; en las oportunidades, los 6 avisos de bodega, 4 de reponedor y 4 de cajero de Retail Andes). El bucle de Luna es más escueto, con sugerencias para tocar en cada respuesta.

Dos cosas que corrige esta medición respecto de la anterior: encender el harness **con Haiku** (y no con Sonnet) cuesta del orden de un centavo de dólar por conversación de un solo turno, no US$0,10; y la diferencia entre los dos motores en estos 8 casos (7 contra 6) es de un caso, así que no decide nada por sí sola. Lo que sí queda a la vista es que el harness de Haiku no es más caro que el bucle de hoy y contesta con más contexto. La decisión de encenderlo (`COWORK_HARNESS_USER_IDS`) sigue siendo de quien administra. *(Actualización del 24 de octubre: el dueño decidió encenderlo para todas las cuentas, junto con las mejoras de borradores; ver `docs/piloto-borradores-cowork-2026-10-23.md`.)*

**Un defecto encontrado y corregido:** con las tareas programadas encendidas, el pie de la lista de escritorio (256 px) tiene tres controles y «Lo que Cowork recuerda» no cabía: el texto chocaba con el ícono del calendario. El botón dice ahora **«Memoria»** (el texto largo queda como ayuda al pasar el cursor y como título del diálogo). Hoy, con las tareas apagadas, solo se notaba al encenderlas.

## 2. Oportunidades: administradora e integrante

**Lo que anduvo bien** (clics para cumplir cada meta; todos los recorridos terminan):

| Meta | Clics |
| --- | --- |
| Administradora: asignar una recomendada a Diego desde el embudo | 4 (5 si elige la próxima acción) |
| Administradora: asignar desde la oportunidad abierta | 3 |
| Administradora: responder la decisión que pidió Diego (desde la novedad) | 2 |
| Administradora: cerrar una presentada como perdida, con su motivo opcional | 1 más el motivo |
| Integrante: abrir lo más urgente y empezar a gestionarlo | 2 |
| Integrante: reportar un bloqueo / proponer no postular / marcar presentada | 1 / 2 / 1 |

La ficha lee de arriba abajo en el orden en que se decide (qué es, cuándo cierra, quién la tiene, qué sigue), y las decisiones del equipo llegan al administrador como novedad, con su respuesta a un clic.

**Tres defectos encontrados y corregidos en este cambio:**

1. **No se veía qué filtro estaba activo.** El estado «seleccionado» usaba el color `secondary`, que sobre blanco es 1,1 a 1 de contraste: en la lista de la administradora el filtro activo casi no se distinguía de los demás, y en la lista del integrante **ninguno** salía marcado (la lista arrancaba con la clave de un filtro de administrador). Ahora lo activo es la píldora oscura (`filterChip`), igual en los filtros de la lista, en las pestañas de la ficha («Informe», «Cómo postular»…), en la elección «Necesito una decisión» / «Propongo no postular» y en «Usar un equipo» y «Próxima acción» del diálogo de asignar; «Mi trabajo» sale marcado desde el primer momento. Los recorridos lo comprueban con `aria-pressed` y con el contraste entre la píldora activa y las demás (3 a 1 o más, en claro y en oscuro).
2. **El buscador se cortaba en el teléfono** («Buscar por nombre, organismo o en…»). Dice «Nombre, organismo o empresa».
3. **Una oportunidad ya presentada, ganada o perdida seguía con «Cómo postular» como botón principal.** Ahora, terminada, baja a botón secundario (`isFinished`): una sola acción principal por pantalla y ninguna invitación a postular a algo que ya se postuló.

**Lo que se vio y no se cambió** (queda anotado para quien decida):

- **Administradora en el teléfono:** casi una pantalla entera de cabecera (título, cuatro botones, la línea de estado, las novedades, «Antes de postular a una licitación», las pestañas, el buscador y dos filas de filtros) antes de llegar al embudo. Se puede leer y operar, pero conviene plegar los filtros detrás de un «Filtros» en pantallas angostas.
- **Una oportunidad marcada «Presentada» sin informe** sigue ofreciendo «Prepara el informe completo» con botón azul, como si faltara decidir si postular.
- **El mismo estado «seleccionado» débil** (`variant={… ? 'secondary' : …}`) sigue en conmutadores de otras pantallas, unos doce archivos: el cambio de vista del CRM, el historial de campañas, «Solo mías» en conversaciones, el informe semanal, redactar correo y los diseñadores de secuencia y de estilo de correo, entre otros. `filterChip` está exportado para reutilizarlo.

## 3. Investigación de leads y borradores

**Las pantallas de fallo, vistas en el navegador** (`journeys/borradores.mjs`):

- **«No logré escribir un correo que se pueda respaldar»**: dice la causa en palabras de la persona («El correo se apoyaba en algo que la investigación de esta empresa no respalda»), deja intentar una vez más, y **al segundo fallo manda a investigar de nuevo al contacto** (ese enlace pasa a ser el botón principal) en vez de repetir el mismo intento. La cuenta de fallos sobrevive a recargar la página.
- **«El servicio de redacción no respondió»**: dice que no es un problema de la investigación, pide esperar un minuto y deja «Crear borrador para revisar» como acción principal. Se ve bien a 390 px.

**La pantalla donde se revisa el correo** («Revisar correo», con un borrador de prueba, en escritorio y teléfono) tenía cuatro cosas que una persona nota enseguida, ya corregidas:

- **No se veía desde qué cuenta saldría.** El proveedor elegido, «Outlook» o «Gmail», se distinguía del otro 1,1 a 1 (medido); lo mismo pasaba con «Sugerencia» y «Estilo» en «Preparación». Lo elegido es ahora la píldora oscura, como en Oportunidades.
- **Palabras sin tilde en lo que la persona lee:** «Necesita correccion», «Este contacto o dominio esta bloqueado para envios», «Hay senales…», «Falta un email valido», las verificaciones del correo («Personalizacion», «Confirmacion de lectura», «un primer envio»), la cronología comercial, la sesión de Outlook y los huecos del informe de investigación («No se encontraron hechos publicos verificables…»). Se corrigieron solo las tildes; los textos que lee el modelo no se tocaron.
- **Un error en inglés:** si no cargaban los seguimientos, la pantalla decía «No pudimos cargar los seguimientos» y, debajo, «Native draft not found». Ahora solo se muestra lo que el servidor dice en español (`readsAsSpanish`); un mensaje en inglés o un código como `NATIVE_DRAFT_NOT_FOUND` se reemplaza por las palabras de la pantalla.
- Queda anotado, sin cambiar: los avisos van **antes** del correo (hasta cuatro en el banco: Outlook sin conectar, revisión pendiente, «No contactar» y «Necesita corrección», estos dos diciendo lo mismo) y la persona tiene que bajar para leer lo que revisa. Conviene un solo aviso arriba y el resto plegado.

**La calidad de los textos** primero se leyó, sin pagar ninguna llamada, en los 8 borradores que la última medición había guardado:

- **0 de 8 se enviarían tal cual.** Los más cercanos son los de Besalco y Salfacorp.
- **El segundo párrafo repite la propuesta de valor en 6 de 8**, en vez de apoyar el ángulo del primero.
- **Cuando la evidencia es delgada, el gancho es malo:** una región que no tiene nada que ver con el negocio, o un tema sensible y ajeno a lo que se vende (la Fiscalía Nacional Económica en el correo a Gasco, «Renca y Talagante son comunas» en el de Aguas Andinas).
- Todo esto cuadra con lo medido antes: con una señal real y fechada la especificidad sube de 2,2 a 4,3.
- **Y se puede ver en lo ya medido, sin gastar nada nuevo.** De los 215 borradores que las corridas guardadas ya habían pasado por el juez (Opus, antes de la regla), los 72 que abren con contratación, vacantes, aperturas, obras o expansión puntúan más que los 143 que abren con otra cosa: «suena humano» 2,6 contra 2,1, especificidad 2,9 contra 2,3, tono 4,0 contra 3,8 y veracidad 5,0 contra 4,8. Dentro de una misma empresa la diferencia se mantiene (cuatro empresas tuvieron las dos clases: la de contratación gana en especificidad en las cuatro, +0,6 de media, intervalo de 90 % de +0,2 a +1,2). Es una asociación entre corridas con variantes distintas, no una prueba, y la clasificación es por palabras de la apertura; pero apunta a dónde está la palanca: que la investigación encuentre señales de ese tipo y que el redactor no use otras (una recomendación de la FNE sobre la distribución de gas, una región donde opera la empresa) como motivo del correo. Esa prueba es la que se hizo después, con Luna y bajo tope (abajo).

Con tu visto bueno (tope de US$2, solo Luna y Haiku, sobre investigaciones ya guardadas) se midió después con 9 variantes × 8 empresas × 2 repeticiones y una comparación por pares. El detalle, con las tablas, está en `docs/borradores-ganchos-y-reglas.md`. Lo esencial:

- **Encender las señales** (`DRAFT_SIGNAL_EVIDENCE_ENABLED`, que ya existía) es lo que más mueve: los correos que el juez manda a revisión humana bajan de 11 de 16 a entre 4 y 9, y los reintentos del redactor, de 8 de 16 a 3 o 4.
- **Dos mejoras nuevas, apagadas:** `DRAFT_HOOK_FILTER_ENABLED` saca antes de escribir los ganchos que no sirven (glosas, «son comunas», el debate de la FNE: de 6 a 2 correos de 16) y `DRAFT_ANCHOR_SPECIFICS_ENABLED` evita que el recorte de un hecho en la primera coma pierda su dato concreto (Enaex pasa de «vacantes abiertas en el norte» a nombrar Antofagasta y Atacama). Juntas, el juez habría enviado su correo en 24 de 32 comparaciones por pares contra 15 de la misma configuración contra sí misma.
- **No funcionó** pedirle al redactor, con reglas en el prompt, que escriba mejor: bajó la veracidad. Se quitó.
- **Sigue pendiente:** ningún brazo llega a «enviar» sin retoque (a lo más 1 de 16) y «suena humano» queda en 2,6 a 2,8 de 5. Lo que más ayudaría ahora no es de código sino del Perfil: un vendedor con una sola propuesta y una sola prueba obliga al redactor a repetir la misma frase.

## Qué decide quien administra

1. **Encender las banderas de borradores** (`DRAFT_SIGNAL_EVIDENCE_ENABLED`, `DRAFT_HOOK_FILTER_ENABLED` y `DRAFT_ANCHOR_SPECIFICS_ENABLED`) para una cuenta o campaña piloto, y completar el Perfil de vendedor con cifras y clientes que se puedan nombrar.
2. Si se enciende el harness de Cowork con Haiku para unas pocas personas (`COWORK_HARNESS_USER_IDS`), la web y los subagentes, o se deja el bucle de hoy.
3. Si se pliegan los filtros del embudo en el teléfono y se unifica el estado «seleccionado» en el resto de la app (los puntos de «Lo que se vio y no se cambió»).
4. El despliegue de todo lo anterior y las dos migraciones sin aplicar (tareas programadas y subagentes), que siguen siendo tuyos.

**Actualización del 24 de octubre.** Las decisiones 1, 2 (el harness con Haiku, sin la web ni los subagentes) y 4 se tomaron: las migraciones están aplicadas, `main` está desplegado y las mejoras de borradores, la cosecha de señales, el harness con Haiku y las tareas programadas quedaron encendidos **para todas las cuentas**. La web de Claude, los subagentes, el investigador con la web de Claude, la lectura de documentos con visión y el modo autónomo, que ese día quedaron apagados, se probaron y se encendieron la tarde del mismo 24 de octubre por pedido del dueño: `docs/funciones-apagadas-encendidas-2026-10-24.md`.
