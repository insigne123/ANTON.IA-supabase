# Funciones del 19 oct · Evaluación en producción

## Cómo se evaluó
- **Dónde:** producción (`studio--leadflowai-3yjcy`), con la cuenta QA «Pruebas ANTON.IA».
  - Es administradora de un workspace de cliente (31 personas que trabajan licitaciones), y ese es su workspace activo. Ahí solo se leyó: no se guardó, envió, pospuso, subió ni gastó nada.
- **Modos:** escritorio claro (1440 px), teléfono oscuro (390 px) y teclado.
- **Qué se registró:** errores de página, peticiones fallidas, desborde horizontal y tiempos reales, desde la navegación hasta ver el contenido.
- **Pauta (1 a 5):** utilidad, facilidad, claridad visual, robustez (errores, carga, estados vacíos, tiempos) y teléfono/oscuro/teclado. Es la misma de la evaluación local de los 7 PRs.
- **Versiones medidas:**
  - build-2026-10-19-002 (#435), pasada completa;
  - build-2026-10-19-003 (#436 a #438), segunda medición;
  - build-2026-10-19-005 (#439, video del informe semanal), pasada final completa. El 004 falló por un error de la plataforma (`RPC::DEADLINE_EXCEEDED` al consultar Cloud Build) y se reintentó.
  - build-2026-10-20-001 (#440: resúmenes, carga desde documento y «Empresa del workspace»), build-2026-10-20-002 (#441: «Contratos por vencer») y build-2026-10-20-003 (#442: resúmenes con la ficha oficial), build-2026-10-20-004 (#443: resúmenes por cierre) y build-2026-10-20-005 (#444: tarjetas en teléfono), la pasada final de estas funciones.

## Resumen
- **Promedio 4,65 en las 11 funciones. Ninguna queda bajo 4,5.** Las 5 del 20 de octubre (abajo) promedian 4,7, también todas sobre 4,5.
- **Pasada final (build 005), en escritorio y en teléfono:** 14 pantallas por modo, sin errores de página ni peticiones fallidas, y desborde horizontal 0. La pasada del build 002 dio lo mismo.
- **Lo que encontró la evaluación y quedó arreglado hoy:**
  - Mercado público fallaba con 500 porque las consultas tardaban más que el límite: #434 (índice de trigramas) y #435 (límite de 30 s del servidor y estado «no pudimos calcular» con «Reintentar»).
  - «Equipo» mostraba 31 filas en cero a un equipo que no escribe correos (#437).
  - «Firmas y estilo → Agenda» tardaba 7 s (#438).
  - Diez videos no calzaban con la app (#436, #439). Ahora producción (build 005) sirve los 16 videos idénticos a los del repositorio, y la duración que muestra la ayuda calza con cada archivo.
  - La lectura del mes de «Contratos por vencer» fallaba con lotes de 120 (#441). La frase del total no mencionaba los recién vencidos (#442).
  - Los resúmenes bajo el nombre no leían la ficha oficial y traían relleno (#442).
  - Se rehacían por puntaje, mientras el tablero muestra primero lo que cierra antes (#443).
  - En teléfono las tarjetas del Embudo se salían por la derecha (#444).
- **Lo que no depende del código:** la base del plan gratuito tiene unos 430 MB de memoria y hace swap. Cada consulta cuesta entre 0,2 y 0,9 s, y eso fija el piso de los tiempos (ver «Producción en el plan gratuito» en `docs/oportunidades-mercado-publico.md`).
  - También produce picos: en la pasada final, la verificación de sesión de Supabase (`/auth/v1/user`) llegó a 11,9 s y una carga de Empresas tardó 28 s. Minutos después, en teléfono, Empresas cargó a su ritmo normal.

## Notas

| Función | Utilidad | Facilidad | Claridad | Robustez | Tel/oscuro/teclado | Nota |
|---|---|---|---|---|---|---|
| Cowork para todos | 5 | 5 | 4,5 | 4,5 | 4,5 | 4,7 |
| Para retomar | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Agenda | 4,5 | 5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Llamadas y LinkedIn | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Mercado público | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Empresas y parecidas | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Informe semanal | 5 | 5 | 5 | 4,5 | 4,5 | 4,8 |
| Contratos por vencer | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Carga desde un documento | 5 | 5 | 4,5 | 4,5 | 4,5 | 4,7 |
| «Empresa del workspace» | 4,5 | 5 | 4,5 | 5 | 4,5 | 4,7 |
| Resumen bajo el nombre | 5 | 5 | 4,5 | 4,5 | 4,5 | 4,7 |

## 20 oct: Embudo con búsqueda y fuente, «Tu semana» en Hoy y Empresas con logos (#447, #448)

**Cómo se midió:**
- **Builds:** build-2026-10-20-008 (#447) y build-2026-10-20-009 (#448).
- **Cuenta y pauta:** la misma cuenta QA y la misma pauta, en escritorio claro y teléfono oscuro.
- **Solo lecturas:** «Empresa del workspace» se abrió y se cerró con «Cancelar».
- **Lecturas con costo:** abrir «No recomendadas» pidió el resumen de sus 60 tarjetas, como hace la página para cualquiera. Abrir una empresa leyó su sitio público una vez.

| Función | Utilidad | Facilidad | Claridad | Robustez | Tel/oscuro/teclado | Nota |
|---|---|---|---|---|---|---|
| Embudo con búsqueda, fuente y «Cargar más» | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| «Sugerir próximos pasos» (antes «Revisar con IA») | 4,5 | 5 | 5 | 4,5 | 4,5 | 4,7 |
| «Empresa del workspace» en grupos | 4,5 | 5 | 5 | 5 | 4,5 | 4,8 |
| «Tu semana» en Hoy | 5 | 5 | 5 | 4,5 | 4,5 | 4,8 |
| Empresas con logo, datos y qué hace | 5 | 4,5 | 5 | 4 | 4,5 | 4,6 |

**Evidencia:**
- **Embudo:**
  - Abre en 7,8 s (8,0 s en teléfono), con 913 por revisar, 76 recomendadas y «No recomendadas 3347» bajo el camino.
  - Elegir «Compra Ágil» tarda 1,8 s: quedan 28 por revisar, todas con la etiqueta «Compra Ágil». «LinkedIn» deja 35 y 2.
  - Buscar «aseo» tarda 2,1 s y da 51 y 31, con títulos de aseo.
  - «Cargar 16 más» tarda 1,6 s (de 60 a 76 recomendadas).
  - «No recomendadas» abre en 1,9 s con 60 tarjetas, cada una con su «Por qué no».
  - La Lista con «LinkedIn» muestra el grupo «LinkedIn 2».
  - Sin errores de página y sin desborde horizontal.
- **«Sugerir próximos pasos»:** el workspace no tiene oportunidades en curso, así que el botón no aparece, que es lo diseñado. Con trabajo en curso lo cubren las pruebas de la UI. Funciona igual que antes: la IA revisa hasta 25 oportunidades y nada cambia sin que lo aceptes.
- **«Empresa del workspace»:**
  - Los cuatro grupos se ven en oscuro: «Qué vende tu empresa» (13 servicios), «Alcance», «Búsqueda diaria» y «Mercado Público».
  - Al llegar al final, los botones siguen a la vista.
- **«Tu semana»:**
  - Abre en 1,9 s, en `/dashboard?vista=semana`, con «Tu semana», «Equipo» y «Oportunidades».
  - «Informe semanal» ya no está en el menú, y `/weekly-report` lleva a la misma vista.
- **Empresas:**
  - 249 empresas sin desborde.
  - El logo sale del sitio (GrupoExpro, Manelsa, ARIS); sin logo, las iniciales.
  - «Qué hace» de GrupoExpro llega en 13,8 s, con una línea de carga mientras tanto: «Ofrece outsourcing de recursos humanos y de procesos, además de servicios de hunting, reclutamiento y selección de personal.»
- **Lo que se arregló en la misma pasada (#448):**
  - La primera versión leía solo la portada, y la de GrupoExpro únicamente pide elegir país; ahora se usa el lector de «Perfil».
  - Las iniciales tomaban «de» («MD» → «MO»).
  - «Usa» listaba 23 nombres; ahora muestra tres y «y 22 más».
- **Por qué robustez 4 en Empresas:**
  - leer el sitio y escribir la frase toma de 3 a 14 s (el navegador lo guarda un día);
  - un dominio que no existe (mop.gov.cl, sin DNS) queda sin descripción;
  - el ícono que falta deja un 404 en la consola del navegador, sin efecto en la pantalla.

## Evidencia por función
- **Cowork para todos:**
  - El build que sirve producción tiene `COWORK_OPEN_TO_ALL=true`, leído de la configuración del build en App Hosting.
  - La base tiene `cowork_access_policy.open_to_grants = true`, y `cowork_open_access` responde `true` para cualquier correo.
  - `/api/cowork/access` responde 200 `{ available: true }`. Cowork abre en 0,9 s y aparece en el menú, también en el menú del teléfono.
  - El permiso de cada persona se crea cuando abre la app, porque el menú consulta `/api/cowork/access`. La prueba local lo verificó con una miembro que no estaba en la lista anterior.
  - **La primera visita, comprobada en producción** (registros de Supabase, 19 oct, 23:26:44–23:27:06 UTC). Una persona real sin permiso, que no es la dueña, ni la cuenta QA, ni estaba en la lista anterior, abrió Cowork:
    1. `cowork_has_access` respondió sin acceso.
    2. Se creó su permiso (`POST cowork_access_grants` → 201).
    3. La segunda verificación pasó, y Cowork cargó sus propuestas, borradores y ejecuciones (todas 200).
  - Hoy hay 3 permisos: la dueña, la cuenta QA y esa persona. Los 3 con correo confirmado.
- **Para retomar** y **Llamadas y LinkedIn:**
  - `/api/reconnect` y `/api/touches` responden 200.
  - La cuenta QA no envió correos en ninguno de sus workspaces, así que las tarjetas no aparecen, que es lo diseñado: no hay a quién retomar ni a quién llamar.
  - Los flujos visibles se evaluaron con IA real en la integración local: tres motivos, posponer y deshacer, guion de llamada y resumen de una grabación.
- **Agenda:**
  - La pestaña carga en 2,2–2,8 s; antes de #438 tardaba 6,3–6,8 s.
  - Las tres formas de usar el enlace se ven en claro y oscuro.
- **Mercado público:**
  - «Competidores» trae 8 perfiles. Las personas naturales aparecen sin RUT, en la lista y en su perfil («Persona natural»).
  - «Demanda futura» y el perfil de cada proveedor cargan.
  - **«Contratos por vencer»:**
    - **El reintento automático:**
      - La lectura del mes se reintentó sola a las 23:58 UTC, ya con el historial cargado, y falló con «La evaluación no terminó».
      - Los recibos lo explican: con 120 contratos por llamada, en un rubro donde casi todo calza, Haiku pasaba de las 100 coincidencias que admite la respuesta o se quedaba sin espacio.
      - #441 filtra 40 por llamada. La pantalla ya no muestra el error interno: dice «Tardó más de lo esperado. Vuelve a intentarlo: suele resolverse al segundo intento.»
    - **La lectura con «Actualizar»:** con tu aprobación, ya con el build 002, se pulsó una vez. Terminó en una pasada: revisó 600 contratos y dejó 476 (453 de calce alto).
    - **La pantalla:**
      - Carga en 8,6 s en escritorio y 7,8 s en teléfono.
      - Tarjetas con organismo, quién lo tiene, monto y plazo, y motivo.
      - Las personas naturales aparecen sin RUT.
      - Filtros por región y calce, y «Ver 24 más», con foco visible.
      - Sin errores ni desborde.
    - **Un detalle de texto:** la lectura parte un mes atrás, así que la lista abre con «Venció en septiembre» bajo «476 contratos vencen en los próximos 6 meses». #442 agrega «o vencieron el último mes».
  - Es la pantalla más lenta: 7–9 s hasta ver los competidores, de los cuales la consulta del radar toma 4,2 s, limitada por la base.
- **Empresas y parecidas:**
  - 248 empresas en 3–4 s.
  - El detalle muestra quién decide, usa y paga, y ofrece «Buscar empresas parecidas» en las empresas con rubro.
  - «Buscar empresas parecidas», con tu aprobación del crédito, en «Organizacion de prueba» (no guarda nada):
    - Desde CSI LTDA. (outsourcing) trajo 5 empresas en 8,6 s, cada una con su motivo: SSI Outsourcing, LatinHire, ATCOM Chile, GrupoExpro y Proyectum Chile.
    - La búsqueda (`/api/leads/search`) y la elección de la IA (`/api/crm/companies/similar`) respondieron 200, sin errores de página.
- **Informe semanal:**
  - «Tu semana», «Equipo» y «Oportunidades» funcionan, y se llega a «Semana pasada» con Tab y Enter, con foco visible.
  - Un equipo que no escribió ve una frase («Nadie del equipo envió correos esta semana») y «Ver Oportunidades», en lugar de 31 filas en cero.
  - Carga en 3,7–3,8 s.

- **Carga desde un documento** (build 002, en «Organizacion de prueba», cancelada sin guardar):
  - Un PDF de solicitud de propuesta ficticio completó el formulario en 11,5 s. Todos los campos quedaron bien:
    - nombre: «Servicio de guardias de seguridad - Obra Edificio Mirador del Parque»;
    - cliente: Constructora Andes Sur S.A.;
    - enlace;
    - tipo: «Solicitud de propuesta»;
    - contexto completo;
    - cierre: 30-10-2026 16:00;
    - monto: 95.000.000 CLP.
  - El aviso «Completamos el formulario con…» no listó faltantes, porque no faltaba nada. El PDF quedó en «Bases y anexos» con «Quitar».
  - Sin errores. El workspace activo volvió al de antes.
- **«Empresa del workspace»** (GrupoExpro, abierto y cerrado con «Cancelar»):
  - El diálogo mide 768 px de ancho.
  - Los campos miden 9, 6, 2 y 4 líneas (198, 138, 80 y 98 px) y se pueden agrandar.
  - Cada etiqueta queda junto a su campo.
- **Resumen bajo el nombre (GrupoExpro):**
  - **Primera versión (build 001), nota 3,5:**
    - El trabajo corrió, pero no leyó ninguna ficha oficial. Nadie en GrupoExpro tiene ticket propio, y el compartido se pedía en nombre de quien abrió el Embudo.
    - Los textos repetían el nombre con relleno: «Solo consta el nombre de la licitación, sin más detalles».
    - El orden tampoco calzaba con el Embudo. GrupoExpro tiene unas 990 oportunidades abiertas y el Embudo muestra 180: #440 ya resume las tarjetas que se vieron, en su orden.
  - **#442 (build 003):**
    - El ticket es el de la búsqueda diaria: el del administrador que confirmó la oferta.
    - Los resúmenes hechos solo con el nombre se rehacen una vez, con la ficha.
    - El prompt va directo a lo que se compra, y `cleanSummary` quita las frases sobre lo que falta.
  - **Medido después:**
    - El trabajo lee unas 14 fichas por pasada (31 en los primeros 4 minutos) y rehace el resto en las pasadas siguientes.
    - Los 31 textos con ficha miden entre 90 y 183 caracteres, empiezan por lo que se compra, nombran organismo, lugar, plazo y monto cuando la ficha los trae, y ninguno comenta lo que falta. Por ejemplo:
      - «Guardias de seguridad para resguardar personas y bienes de las dependencias municipales de Tomé, con siete puestos de vigilancia durante 18 meses, en la Región del Biobío.»
      - «Contratación de 50 evaluaciones psicolaborales para candidatos en procesos de selección de la SEREMI de Salud de Antofagasta, por unos 3 millones de pesos.»
  - **Completo (01:22 UTC):**
    - El trabajo terminó en 12 pasadas: 134 resúmenes con ficha, ninguna ficha rechazada.
    - Quedan 6 licitaciones con resumen viejo hecho solo con el nombre, fuera de las tarjetas que muestra el Embudo. Se rehacen solas cuando aparezcan.
  - **El orden (#443):** con el build 003, las tarjetas de arriba (las que cierran mañana) se rehacían al final. Ahora el trabajo sigue el orden del tablero.
  - **La pantalla:**
    - Las 60 tarjetas visibles del Embudo muestran el organismo arriba y su resumen con ficha. Por ejemplo, «Vigilancia y resguardo permanente de la oficina de Comercio Exterior del SAG en el Aeropuerto Arturo Merino Benítez, Pudahuel, por 250.000.000 CLP».
    - El Embudo carga en 8,1 s en escritorio y 7,6 s en teléfono, sin errores.
  - **En teléfono:**
    - La captura mostró las tarjetas cortadas por la derecha. El organismo (`truncate`, una línea) ensanchaba la única columna de la grilla, y el contenedor recortaba lo que sobraba: por eso la medición de desborde daba 0.
    - #444 da a la columna `grid-cols-1` (`minmax(0, 1fr)`) y a la tarjeta `min-w-0`. En Chromium, a 358 px, la tarjeta medía 810 px y ahora mide 318.
    - Con el build 005, en teléfono oscuro, cada tarjeta ocupa el ancho de la pantalla. El nombre baja de línea, el resumen se lee completo y «Abrir» queda visible.
  - **El video «Oportunidades»** (123 s, regrabado en #440) muestra la interfaz actual:
    - el paso «De qué se trata», con el organismo arriba y el resumen bajo el nombre;
    - el paso «La IA completa el formulario», con un documento.
    - Producción sirve el mismo archivo que el repositorio (mismo SHA-256).
    - #441–#444 no cambian lo que muestran los videos: todos se graban en escritorio, y los contratos del video «Mercado público» vencen en 38, 64 y 112 días.
  - **Lo que baja la nota:** una sigla queda tal cual («REAS HC»). La región es la que informa la ficha, que a veces es la del organismo central.

## Tiempos reales en producción (escritorio)

| Pantalla | build 002 | build 003 |
|---|---|---|
| Hoy | 0,3–0,8 s | 0,6–1 s |
| Cowork | 1,1 s | 0,9 s |
| Centro de ayuda | 0,3–0,8 s | 0,4–0,5 s |
| Empresas | 3,1–3,7 s | 3–4 s |
| Informe semanal | 3,9–5,8 s | 3,7–3,8 s |
| Agenda | 6,3–6,8 s | 2,2–2,8 s |
| Competidores | 8,9–11 s | 7,3–8,9 s |

En todas las pantallas, `/api/organizations` y `/api/quota/status` toman entre 0,7 y 3 s; es la misma base. El build 005 solo cambió un video, así que sus tiempos son los del 003.

## Lo que queda
- **Rendimiento:** pasar la base a un plan con más memoria es la mejora de tiempos más grande que queda. Es una decisión de costo.
