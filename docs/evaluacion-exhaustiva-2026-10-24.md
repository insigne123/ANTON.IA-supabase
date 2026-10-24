# Evaluación exhaustiva de ANTON.IA · 24 de octubre de 2026

Todo lo que se puede mejorar en la app, visual y funcionalmente, con foco en **Oportunidades** y **Cowork**. Cada punto dice qué pasa, dónde se vio y qué propongo. Este documento no cambia código ni producción: es el mapa para decidir.

Versión evaluada: `main` en `f6acc6b9` (con el agente de Oportunidades encendido y desplegado a las 06:41 UTC). Producción: proyecto Supabase `yfdelflsheurzaicwayi`, solo lectura.

## Cómo leer este documento

- Cada mejora lleva un **ID**, su **tipo**, el **impacto** (A alto, M medio, B bajo) y el **esfuerzo** (A alto, M medio, B bajo; B es de horas a un día, M de unos días, A de semanas).
- La **evidencia** dice de dónde sale: *código* (lo leí), *captura* (la vi en el banco visual), *navegador* (un recorrido lo comprobó), *producción* (consulta de solo lectura) o *linter* (el verificador oficial de Supabase).
- Al final están **lo que está bien y no hay que tocar** y **lo que descarté** (con el motivo), para que nadie pierda tiempo con ello.

## 1. Resumen

### 1.1 Cómo se evaluó

| Fuente | Qué cubre |
| --- | --- |
| Pantallas | 141 visitas (3 personas, datos completos y vacíos, 390 y 1440 px, claro y oscuro) = 528 capturas, con axe-core en cada una |
| Interacciones | 61 recorridos: cada menú, diálogo y pestaña (con flechas), el foco con Tab, lecturas que fallan, lecturas lentas de 3 s y textos tres veces más largos |
| Uso | 23 recorridos de persona (administrador, integrante, teléfono, Cowork, borradores) más 6 propios de esta evaluación: cada sección de una oportunidad, cambio de etapa, lista, mercado público, asistente y teléfono |
| Código | las pantallas de Oportunidades (la viva y la antigua), Cowork, Hoy, Pipeline y las demás, y los servidores y funciones de base de datos que las alimentan |
| Producción | uso, fallos, tiempos y costos de 30 días; el plan de ejecución de la consulta principal; los avisos del linter de Supabase |
| Mediciones previas | los informes con modelo real de esta carpeta (`uso-como-persona-2026-10-23.md`, `funciones-apagadas-encendidas-2026-10-24.md`) |

**Límites.** (1) Nadie ha usado Cowork desde que están encendidos el harness de Haiku y la web (el último turno fue el 23 oct 13:10 UTC), así que su latencia y su calidad con el motor nuevo no tienen datos de producción. (2) El banco visual usa datos de prueba: algunas cosas que se ven raras son del banco, no de la app (están en «Lo que descarté»). (3) No probé con lector de pantalla, no medí Core Web Vitals reales ni hablé con usuarios. (4) Esta evaluación no llamó a ningún modelo: lo que dice de modelos viene de las mediciones anteriores.

### 1.2 Lo central, en cinco líneas

1. **La app está bien construida.** Cada menú y diálogo abre, enfoca, cierra con Esc y devuelve el foco; el foco con Tab se ve en todas las páginas; ningún texto largo desborda; en 141 visitas axe encontró un solo problema (el contraste de una pestaña). Oportunidades y Cowork tienen buen diseño. Lo que más frena no es la pantalla.
2. **Oportunidades no ha arrancado como trabajo en equipo.** 28 personas habilitadas, 0 asignaciones en 11 días, 0 documentos de la empresa, 0 competidores seguidos, 0 tickets propios. Por diseño solo el administrador ve el radar, y solo la asignación avisa por correo.
3. **Los informes, el corazón del producto, fallan casi la mitad de las veces**: de 15 en 30 días, 7 terminaron, 6 se bloquearon (tras ~16 min de espera) y 2 fallaron; el 32 % del gasto en informes no entregó informe, y las promesas de tiempo son 2–3 veces más optimistas que la realidad.
4. **Cowork está a la altura de lo visible** (plan aprobable, huella de herramientas, tareas programadas) pero vive aparte de Oportunidades, no avisa fuera de la pestaña y el 79 % de sus conversaciones son de un solo turno.
5. **Hay un aviso de seguridad sobre la base de datos.** Este repositorio es público, así que sus detalles no están aquí: se entregan por un canal privado.

### 1.3 Las 12 prioridades

| # | Mejora | Por qué ahora | Esfuerzo | IDs |
| --- | --- | --- | --- | --- |
| 1 | Atender el aviso de seguridad de la base de datos (entregado aparte) | es el único punto con riesgo para los datos | M | privado |
| 2 | Que Oportunidades llegue a la gente: «Me interesa», avisos por correo (asignación, decisión, bloqueo, cierres) y un bloque en «Hoy» | 0 asignaciones; el aviso diario es 100 % de prospección | M | OPP-01, OPP-02, OPP-03 |
| 3 | La consulta de la lista, de 577 ms a 8,8 ms | 65 veces más rápida; una migración pequeña | B | OPP-35 |
| 4 | Informes que terminan: dividir por documento, costo antes de generar, tope autorizable, tiempos reales | 8 de 15 no terminaron; 16 min de espera para enterarse | M–A | OPP-18, OPP-19 |
| 5 | Bases sin cuatro pasos a mano (extensión de Chrome o arrastrar el ZIP) | la mayor fricción del flujo central | A | OPP-17 |
| 6 | Descartar con motivo y acciones masivas | ~1.200 «Por revisar» abiertas y ninguna salida | M | OPP-08, OPP-09 |
| 7 | Lo importante sobre el pliegue: embudo compacto, ficha sin duplicados | con 900 px de alto, la primera tarjeta de trabajo empieza en y≈990 | M | OPP-39, OPP-40 |
| 8 | Cowork con Oportunidades: herramienta con puntaje, monto y cierre; efectos aprobables; «Seguir en Cowork» | hoy son dos productos | M | COW-01, COW-02, OPP-32 |
| 9 | Avisos de Cowork fuera de la pestaña y propuestas sin resolver | 10 esperando aprobación en 30 días; 9 con más de 2 días | M | COW-04, COW-16 |
| 10 | Cerrar el ciclo: adjudicación automática y motivos estructurados | nadie sabe qué pasó después de «Presentada» | M | OPP-29, OPP-30 |
| 11 | «Hoy» con estado de error, contraste de su pestaña y un solo `SegmentedControl` | la pantalla más visitada no avisa cuando falla | B–M | APP-02, APP-03, APP-04 |
| 12 | Un solo camino para cambiar de etapa | «Plan y tareas» deja cerrar una oportunidad con un clic y sin motivo | B | OPP-31 |

### 1.4 Mejoras de una tarde

OPP-31 (quitar la fila «Cambiar estado»), APP-03 (contraste de «Tu semana»), OPP-37 (tope mensual leído de la variable), OPP-26 (hitos sin fecha), OPP-44 (aviso que empuja la página), OPP-47 (estrellas con etiqueta), OPP-25 (acción para documentos leídos en parte), COW-27 y COW-20 (dos textos), APP-17 (placeholder cortado), APP-12 (avisos plegados en «Revisar correo»), OPP-45 (etapas cerradas con aspecto de botón).

### 1.5 Decisiones que necesito de ti

1. **Seguridad (aviso privado).** Te lo entrego por chat y en un archivo fuera del repositorio. Lo que decides es si autorizas preparar, de a una y con verificación, las migraciones que haga falta. Hasta que lo pidas no toco producción.
2. **Modelo de trabajo (OPP-01).** ¿Dejamos que un integrante diga «Me interesa» y se asigne solo, o el administrador sigue decidiendo todo?
3. **Vocabulario (APP-05).** «Oportunidades», «Pipeline» y «Embudo» se parecen demasiado. ¿Renombramos?
4. **Pantalla antigua de Oportunidades (OPP-38).** Apagada desde el 13 oct pero incluida en el paquete de todos. ¿La borramos?
5. **Tono lúdico (OPP-46).** Los personajes del informe (Mensajero, Becario, Analista, Jefe): ¿se quedan o pasan a una sola fila de pasos?
6. **Ley 21.719 (APP-20).** ¿Se revisa con asesoría legal antes de diciembre?

---

## 2. Base de datos (DB)

*Los hallazgos de seguridad de esta evaluación no se publican aquí: el repositorio es público. Se entregan por un canal privado.*

- **DB-01 · Mantenimiento de la base** · Rendimiento · **M / M**

  401 claves foráneas sin índice (116 de tablas de Oportunidades y Cowork), 199 políticas RLS que reevalúan `auth.uid()` fila por fila (34 de esas tablas; se arregla con `(select auth.uid())`), 201 casos de políticas permisivas múltiples, 338 índices sin uso y 4 duplicados. Hoy no duele (la tabla mayor de Oportunidades tiene 9.000 filas); crece con el uso. *Evidencia:* linter de rendimiento de Supabase.

---

## 3. Oportunidades (OPP)

*Pantalla viva: `OpportunityWorkWorkspace` (la antigua está apagada, ver OPP-38).*

### 3.1 Adopción, avisos y modelo de trabajo

- **OPP-01 · Modelo solo de empuje: si nadie asigna, nadie ve nada** · Producto · **A / M**

  Un integrante solo ve lo que un administrador le asigna (`opportunity_can_read` exige ser administrador o participante) y su pantalla se reduce a «Mis oportunidades | Asistente». Con 0 asignaciones en 11 días, las 28 personas habilitadas (31 miembros) encuentran «Aún no tienes oportunidades en esta vista. Las oportunidades que te asigne un administrador aparecerán aquí…»: una sala vacía, sin nada que hacer y sin mirar el radar. El cuello de botella es la persona que revisa ~1.200 «Por revisar» y asigna a mano.

  *Evidencia:* código (SQL y `OpportunityWorkWorkspace.tsx:483`) y producción (`opportunity_work` = 0, `opportunity_participants` = 0). La pantalla antigua tenía «Me interesa» para cualquier integrante (ver OPP-08); se perdió en el cambio.

  *Propuesta:* (a) «Recomendadas» de solo lectura para integrantes con «Me interesa» (se asigna sola y avisa al administrador); (b) «Pedir que me asignen una»; (c) un estado vacío con tres pasos y qué esperar; (d) reglas de asignación (OPP-06).

- **OPP-02 · Los avisos de Oportunidades no llegan a quien debe actuar** · Producto/Notificaciones · **A / M**

  Los diálogos prometen «Se lo avisamos a los administradores y a quien está a cargo» y «Un administrador te responderá aquí mismo», pero solo la **asignación** envía correo (`workspace-assignment-notice.ts`); decisiones, bloqueos e informes listos crean una línea en «Novedades» dentro de la pantalla. Si el administrador no entra, la decisión queda esperando sin plazo ni recordatorio. El aviso diario por correo es de prospección para todos: 76 correos entre el 21 y el 23 oct a 35 personas, **los 76 con la línea «Meta de la semana…»** de prospección (que además sirve de asunto cuando la meta va atrasada), 33 con el «Contacto del día» y solo 4 líneas de licitaciones («cierra pronto», a 2 personas por día). El resumen semanal «Tu semana» sí tiene una sección «Oportunidades», pero solo para los «gestores» que nombra un administrador (hoy `organization_report_roles` = 0) o, si no hay, para administradores; `weekly_reports` = 0: el primer lunes con la función es el 26 oct.

  *Evidencia:* código (`weekly-report.ts`, `daily-alerts.ts`, `help/manual.ts`) y producción (`daily_alerts`: 76 enviados; líneas por tipo).

  *Propuesta:* correo (y Web Push, COW-04) al pedir una decisión o reportar un bloqueo; recordatorio al cumplirse la fecha pedida; «Esperando respuesta hace 2 días» visible para quien preguntó; contador de «Decisiones pendientes» en la franja del administrador y en «Hoy»; contenido del aviso diario según el acceso de la persona (APP-15); nombrar gestores por defecto a quienes tienen acceso a Oportunidades.

- **OPP-03 · «Hoy» no menciona Oportunidades** · Producto · **A / M**

  La pantalla más visitada no tiene ningún bloque de licitaciones; la sección «Oportunidades» existe solo dentro de «Tu semana» (una pestaña «Oportunidades» y la sugerencia «Asigna 1 oportunidad que cierra esta semana») y solo para gestores/administradores. Para quien solo trabaja licitaciones, «Hoy» es irrelevante (lista «Guarda tus primeros contactos / Envía tu primer correo», «Meta de la semana: personas contactadas»).

  *Evidencia:* código (`src/components/home/*`) y capturas Hoy 1440 (con datos y vacío).

  *Propuesta:* un bloque «Tus licitaciones» (asignadas a ti, cierran esta semana, decisión pendiente, informe listo) para toda persona con acceso, y que «Hoy» se adapte al acceso (el panel de administración ya guarda `opportunityAccess` por persona).

- **OPP-04 · Gestores de oportunidades: nadie nombrado** · Producto · **M / B**

  Ver OPP-02: el resumen semanal de Oportunidades solo lo reciben administradores mientras no haya «gestores». *Propuesta:* los gestores son, por defecto, quienes tienen acceso a Oportunidades, y el administrador los reduce si quiere.

- **OPP-05 · Primera vez: la base de la empresa no se configura** · Producto · **A / M**

  0 documentos de la empresa (certificados, experiencia, garantías con vencimiento), 0 competidores seguidos, 1 ficha para licitaciones, 0 tickets propios. Los documentos viven dentro de la hoja «Ficha para licitaciones» (`CompanyDocuments.tsx`), escondida tras un botón de la franja de administración, y alimentan el calce (`workspace-fit.ts`) y el kit de postulación («Documento de tu empresa», «Los certificados deben estar vigentes»): sin ellos la IA no puede decir «te falta el certificado X» ni «tu garantía vence antes del cierre».

  *Evidencia:* código y producción.

  *Propuesta:* lista de primera vez «Prepara tu empresa» (oferta ✓ · documentos 0/5 · equipo 0/28 · competidores 0), avisos de vencimiento por correo y, en cada informe, «te falta X» con el botón de subirlo.

- **OPP-06 · Reglas de asignación y carga por persona** · Producto · **M / M**

  «Asignar» muestra a las personas sin su carga (cuántas abiertas tiene cada quien) ni su especialidad. *Propuesta:* reglas («seguridad → Diego, aseo → María» por rubro, monto o región) que dejen al administrador solo las excepciones, y la carga visible al asignar.

- **OPP-07 · El panel de administración no mide Oportunidades ni Cowork** · Producto · **M / M**

  «Uso y resultados» y «Personas» solo miden prospección (contactos, respuestas, tasa): no hay uso ni costo de Cowork, ni trabajo de Oportunidades (asignadas, vencidas, ganadas), ni adopción por persona, justo lo que habría mostrado que, en 30 días, entre 1 y 3 de las 28 personas habilitadas hicieron cada tipo de acción y que nadie ha asignado. Tampoco hay una vista común de los tres topes (créditos diarios de prospección, libro de Cowork y US$20 mensuales de Oportunidades). *Evidencia:* código (`admin-usage-data.ts` no menciona ninguno).

### 3.2 Descubrir y priorizar

- **OPP-08 · No se puede descartar con motivo** · Funcional · **A / M**

  En «Por revisar» y «Recomendadas» una oportunidad sin equipo solo ofrece «Asignar» y «Abrir». Las acciones del servidor son asignar, actividad, tarea, estado, informe, chat, vínculo, reconsiderar, marca, oferta, precios, calce, decisión… ninguna descarta. Quedan ~1.200 licitaciones «Por revisar» abiertas (de 1.768) y ~55 «Recomendadas»; las que no calzan se acumulan hasta que cierran, y la IA no aprende qué no sirve.

  *Evidencia:* código (`/api/commercial-opportunities/workspace`) y producción (inventario).

  *Contexto:* la pantalla antigua sí tenía «Me interesa» y «Descartar» (estados nueva, te interesa, descartada y convertida; Plan 15) y se perdieron al pasar a la nueva: en producción las 8.979 filas siguen en `new` y ninguna tiene `claimed_by`. Restaurarlo es volver a usar una columna y una API que ya existen.

  *Propuesta:* «No es para nosotros» con motivo en una línea (precio, región, rubro, ya participamos, no hay plazo) que alimente «Qué buscamos» y la mande a «Archivadas».

- **OPP-09 · Sin acciones masivas en la Lista** · Funcional · **M / M**

  El administrador revisa decenas de hallazgos por día y solo puede asignar o abrir de a una. *Propuesta:* selección múltiple con asignar, descartar con motivo y mover de etapa.

- **OPP-10 · Sin búsquedas guardadas ni alertas** · Funcional · **M / M**

  Ya existen el Plan Anual de Compras («Demanda futura») y «Contratos por vencer», pero no hay «avísame cuando salga una licitación de más de $50 M en la Región Metropolitana con “seguridad”» ni «seguir a Hospital X». Las únicas alertas son la línea de cierres del aviso diario y las notificaciones de informe. *Propuesta:* búsquedas guardadas con aviso por correo o en Cowork y «seguir comprador».

- **OPP-11 · Sin vista «Esta semana» ni recordatorios de cierre** · Funcional · **M / M**

  El embudo muestra una etapa a la vez; el «N cierran en menos de 7 días» está por etapa, pero no hay una tira de lo urgente entre etapas ni recordatorios por correo a 7, 3 y 1 día. *Propuesta:* tira «Cierran esta semana» sobre el camino y recordatorios al responsable.

- **OPP-12 · Las tarjetas del embudo no muestran monto, región ni fecha exacta** · Funcional · **M / B**

  Solo «Cierra en N días»; el orden admite Prioridad o Cierran antes. *Propuesta:* monto y región en la tarjeta, orden por monto y filtro por región y rango de monto.

- **OPP-13 · «Por revisar» significa dos cosas** · Consistencia · **M / B**

  En el embudo es «sin equipo todavía» (1 en el banco); en la Lista es «evaluación de la IA = por revisar», que incluye las ya asignadas, en gestión y presentadas (4 en el banco). Al asignar, la oportunidad no sale de «Por revisar» de la Lista: la bandeja del administrador no se vacía. *Evidencia:* capturas del embudo y de la Lista y SQL de `opportunity_workspace_list_terms`. *Propuesta:* la Lista usa las etapas del embudo y la evaluación de la IA pasa a ser un segundo filtro con otro nombre.

- **OPP-14 · Los filtros no están en la URL** · Funcional · **M / B**

  Solo `?op=`. No se puede compartir «las licitaciones de salud en Por revisar» ni volver con Atrás al filtro anterior. *Propuesta:* `?vista=lista&filtro=review&fuente=tender&q=`.

- **OPP-15 · No se ve la salud de las fuentes ni de qué ticket se alimenta** · Producto/Confianza · **M / B**

  `sourceStatus` solo trae «búsqueda diaria programada/pausada». En 30 días fallaron 19 de 70 sincronizaciones de licitaciones (27 %; 9 de ellas «Compra Ágil respondió 504») y 4 de 10 de publicaciones de LinkedIn. La tabla `commercial_opportunity_tickets` tiene 0 filas: **todo el radar corre con el ticket global compartido** (un solo punto de falla y una sola cuota), y nadie lo ve. Hoy un radar sin novedades es indistinguible de uno roto. *Propuesta:* «Última búsqueda hoy 07:12 · Licitaciones ✓ · Compra Ágil ⚠ reintentando», reintentos con espera creciente para 504, aviso al administrador si una fuente falla dos días seguidos, e invitar a conectar el ticket de la organización (botón «Empresa del workspace»).

- **OPP-16 · El historial de ChileCompra se carga a mano** · Operación · **M / B**

  Base de «Cómo ganar», «Contratos por vencer» y «Competidores» (205 mil licitaciones, 548 mil ofertas, 50 mil proveedores): se cargó el 19 oct con `scripts/load-public-procurement.mjs`; no hay cron. Las vistas dicen «datos hasta octubre de 2026» (bien), pero se atrasarán. *Propuesta:* cron mensual (el día 2) con aviso al administrador si falla.

### 3.3 Preparar y postular

- **OPP-17 · Las bases se bajan a mano en cuatro pasos** · Funcional · **A / A**

  Abrir «Ver anexos», resolver «No soy un robot», «Descargar todos» y subir el ZIP (`OpportunityExpedient.tsx`). Es la mayor fricción del flujo central; sin bases el informe sale «sin las bases». La extensión de Chrome existe, pero solo para LinkedIn (`manifest.json`).

  *Propuesta:* ampliar la extensión a mercadopublico.cl con «Enviar bases a ANTON.IA»; mientras, aceptar soltar el ZIP en cualquier parte de la pantalla y pegar desde el portapapeles, y subir el límite de 20 MB por documento con subida por partes.

- **OPP-18 · Los informes grandes se bloquean al final** · Funcional · **A / M**

  De 15 informes en 30 días: 7 listos, **6 bloqueados** (4 «el contexto supera el presupuesto del trabajo; divide los documentos», 2 «se alcanzó el presupuesto disponible») y 2 fallidos. El informe es una sola síntesis de todos los documentos y su reserva (US$0,75) se comprueba en la **última** llamada (`workspace-ai.ts:81`), después de leer y cribar todo: se espera una mediana de **16 min** y se gastan ≈US$0,10 por informe bloqueado para enterarse. El mensaje dice «un informe o el mes» sin precisar cuál tope, pide curar los documentos a mano y «Intentar de nuevo» falla igual. En 30 días se gastaron US$2,85 en informes y US$0,92 (32 %) no produjeron informe.

  *Evidencia:* código (`workspace-ai.ts`, `report-view.ts`, `OpportunityExpedient.tsx`) y producción (`opportunity_jobs`, `opportunity_budget_reservations`).

  *Propuesta:* estimar el tamaño al subir los documentos y avisar de inmediato («Estas bases son largas: el informe saldrá resumido por documento, ≈US$0,40»), resumir por documento y sintetizar desde los resúmenes (la lectura y el cribado ya trabajan por bloques), y que un administrador pueda autorizar un tope mayor para ese informe con un clic.

- **OPP-19 · Las promesas de tiempo no se cumplen** · UX · **M / B**

  «Suele tardar entre 2 y 5 minutos» (informe de licitación; 1–3 para señales) frente a una mediana de 8,1 min y p90 de 15,4; «Tarda unos minutos» para Demanda futura y Contratos por vencer frente a medianas de horas en una muestra chica (322 min). *Propuesta:* estimar con la mediana móvil real, mostrar el paso en que va y precalcular de noche lo de mercado.

- **OPP-20 · El informe no dice qué cambió** · Funcional · **M / M**

  «Actualizar informe» reemplaza al mostrado (solo se ve `reports[0]`). *Propuesta:* franja «Cambios desde el informe del 12 oct» con 3–5 líneas (documentos nuevos, requisitos resueltos, nuevas preguntas del foro).

- **OPP-21 · «Crear tarea» es de a una** · Funcional · **M / B**

  *Propuesta:* «Convertir el plan en tareas» con responsable sugerido y fechas relativas al cierre, con vista previa editable.

- **OPP-22 · Las preguntas al comprador solo se copian** · Funcional · **M / B**

  La app ya conecta Gmail y Outlook. *Propuesta:* «Abrir borrador en mi correo» con las preguntas y el plazo de consultas.

- **OPP-23 · Tres lugares para pensar el precio, y se guarda en el navegador** · Funcional · **M / M**

  «Los números» (neto/IVA en «Cómo postular»), «Oferta económica» (hoja del borrador) y «Calcular el precio» (costo y valor hora). Este último guarda costos y márgenes solo en `localStorage` por persona y oportunidad: se pierde al cambiar de equipo y nadie más puede revisarlo. *Propuesta:* un solo bloque «Precio» con tres pasos (costo → puntaje frente al rival → hoja de la oferta), guardado en el servidor visible para quienes fijan precios, con historial, «Usar este valor en la oferta económica» y, como punto de partida, el rango ganador histórico del comprador y del rubro que ya calcula «Cómo ganar».

- **OPP-24 · El borrador de oferta es de solo lectura** · Funcional · **M / M**

  Se descarga el Word; no se puede editar una sección, pedir «reescribe esta con más énfasis en X» ni comparar versiones. *Propuesta:* edición en línea por sección, regenerar una sección con indicaciones, historial de versiones y marca «revisado por» antes de presentar.

- **OPP-25 · Un documento «leído en parte» no ofrece acción** · UX · **B / B**

  «Aclaraciones del foro.pdf: Leído en parte · 12 de 24 páginas» (naranja) no dice cómo completarlo. *Propuesta:* «Subir el resto» junto a cada documento leído en parte.

- **OPP-26 · Hitos sin fecha como texto libre** · Datos · **B / B**

  Se guardan como «Sin fecha informada», «Sin información», «Sin fecha publicada» dentro de `milestones[].date`; no se pueden ordenar ni convertir en recordatorios. 2 de los últimos 8 informes no tienen hitos. *Propuesta:* normalizar a `null` y mostrar «—» o esconder. (Las fechas con hora sí salen bien en hora de Chile.)

- **OPP-27 · «Plan y tareas» es mínimo** · Funcional · **M / M**

  Sin fecha editable, sin cambiar responsable en la fila, sin vencidas resaltadas, sin eliminar ni duplicar; el estado de cada tarea es un `<select>` nativo y muestra fecha y hora («23 de octubre de 2026, 03:46») aunque el vencimiento es del día. *Propuesta:* lista con fecha límite, responsable, vencidas en rojo y una vista «Mis tareas» entre oportunidades.

- **OPP-28 · «Actividad» solo admite notas** · Funcional · **M / M**

  Sin menciones (@persona) que notifiquen, sin editar ni borrar, sin adjuntar.

### 3.4 Cierre y aprendizaje

- **OPP-29 · Tras «Presentada» nadie sabe qué pasó** · Producto · **A / M**

  El estado del portal (`LICITACION_STATES`: 7 desierta, 8 adjudicada, 18 revocada, 19 suspendida) se lee al sincronizar, pero no mueve la oportunidad ni avisa; `automaticMove` solo avanza a «En gestión» y «Presentada». En una oportunidad ya presentada la ficha sigue mostrando «Prepara el informe completo: sube los documentos / genera el informe».

  *Propuesta:* «La licitación fue adjudicada a X por $Y: ¿ganamos o perdimos?» con un clic, aviso a quien la trabajó y registro del ganador y su precio (alimenta «Competidores» y «Calcular el precio»); lo mismo para desiertas y revocadas; y en lo presentado, la ficha pasa a «seguimiento» (fecha estimada de adjudicación, registrar resultado, aclaraciones del comprador).

- **OPP-30 · El motivo de ganar o perder es una línea de texto** · Funcional · **M / B**

  «Adjudicaron a otra empresa con menor plazo de entrega.» (opcional, libre): no se puede contar («¿cuántas perdimos por precio?») ni alimentar la búsqueda ni la calculadora. *Propuesta:* motivos en chips (precio, plazo, requisitos, sin capacidad, competidor, desierta), ganador y monto adjudicado opcionales, y una vista «Lo que hemos aprendido» por trimestre.

- **OPP-31 · «Cambiar estado» de «Plan y tareas» salta los diálogos y no marca el estado actual** · Funcional · **M / B**

  Hay dos caminos para cambiar de etapa: la franja «Tu avance» (con motivo para Ganada/Perdida y nota para Bloqueada) y una fila «Cambiar estado» al pie de «Plan y tareas» (`OpportunityWorkWorkspace.tsx:570`). Comprobado en el navegador: el administrador pasa a **Perdida con un clic**, sin motivo ni confirmación (estado final `lost`); el integrante que pulsa «Bloqueada» no ve el diálogo y recibe un 400 «Cuenta qué te bloquea…» del servidor. La fila son seis botones idénticos (En gestión, Bloqueada, Presentada, Ganada, Perdida, Archivada), sin marca del estado actual ni color distinto para los que cierran. El propio comentario de `MemberWork.tsx` dice que esa fila debía desaparecer.

  *Evidencia:* navegador (`eval-estado-sin-motivo`, `eval-bloqueo-sin-nota`) y captura.

  *Propuesta:* quitar la fila; queda un solo camino.

### 3.5 Integración con Cowork y asistentes

- **OPP-32 · Tres chats que no se conocen** · Producto · **A / M**

  «Preguntar a la IA» (por oportunidad), «Asistente» (de la sección) y Cowork son tres chats paralelos con historiales distintos. Cowork lee `opportunities.list` (primera página, 20 como máximo, **sin** puntaje, monto, evaluación ni resumen, sin orden por cierre) y no puede actuar: no existe ningún efecto de Cowork para asignar, mover de etapa, crear tareas, pedir un informe o preparar una oferta. Desde una oportunidad no hay «Seguir en Cowork».

  *Propuesta:* pasar puntaje, monto, evaluación, equipo y próxima acción a la herramienta, ordenar por cierre o prioridad, sumar efectos aprobables (asignar, mover, crear tarea, pedir informe) y el botón «Investigar al comprador / escribirle al contacto con Cowork»; a largo plazo, un solo chat con habilidades de Oportunidades. Ver COW-01 y COW-02.

- **OPP-33 · El asistente es más pobre que el chat de Cowork** · Funcional · **M / B**

  Responde con texto y tarjetas pero solo ofrece «Copiar»: sin regenerar, sin opinión (👍/👎) y sin avance mientras responde («Revisando tus oportunidades…»). Además la caja de preguntar queda en y≈1015 en una pantalla de 1030 px: bajo el pliegue de un portátil; en Cowork el compositor sí queda fijo abajo. *Propuesta:* igualar las acciones de respuesta, mostrar el avance y acotar el panel con `height: calc(100dvh − cabecera)`.

- **OPP-34 · «Novedades» básicas** · Funcional · **B / B**

  «Marcar como leídas» limpia todo de una vez; la lista muestra tres y «Ver N más»; sin filtro por tipo (informe listo, asignación, decisión pendiente) ni enlace «Ir a la decisión».

### 3.6 Rendimiento y operación

- **OPP-35 · La consulta de la lista, 65 veces más lenta de lo necesario** · Rendimiento · **A / B**

  `opportunity_workspace_list*` (144 llamadas, media 475 ms, máxima 1,46 s; 69 s de base de datos, el 57 % del tiempo de todas las consultas que nombran Oportunidades, 123 s en total) llama a `opportunity_can_read(org, usuario, id)` **una vez por fila** (≈9.000 filas de la organización): 577 ms y 92.531 accesos a memoria para «Por revisar» de un administrador. La misma consulta sin esa llamada (comprobando una sola vez si la persona administra y, para integrantes, uniendo con `opportunity_participants`) tarda **8,8 ms con 1.400 accesos**. Con la actualización automática cada 60 s por pestaña abierta, el costo crece con el uso.

  *Evidencia:* producción (`EXPLAIN ANALYZE` de solo lectura y `pg_stat_statements`).

  *Propuesta:* reescribir con un `exists` único y un semi-join; índice `(organization_id, score desc, updated_at desc, id)`; prueba de equivalencia de resultados. Una migración pequeña hacia adelante.

- **OPP-36 · Cada guardado recarga en cadena** · Rendimiento · **M / B**

  `perform()` recarga el detalle y luego la lista en serie (`await loadDetail(id); await load();`), y `loadDetail` pide detalle y luego chat: 3–4 viajes encadenados por guardado, siendo independientes. *Propuesta:* `Promise.all` y respuesta optimista del cambio.

- **OPP-37 · El tope mensual está escrito a mano** · Dato · **B / B**

  «Límite mensual US$20» (`OpportunityWorkWorkspace.tsx:458`) y `cap: 20` en el servidor (`workspace-store.ts:67`) aunque existe `OPPORTUNITIES_MONTHLY_USD_CAP`: si se cambia la variable, el texto y el tope mostrado mienten. *Propuesta:* leer el tope de la variable y mostrar «US$X de US$20 usados» con barra.

- **OPP-38 · La pantalla antigua viaja en el paquete de todos** · Código · **M / B**

  `page.tsx` importa de forma estática `OpportunitiesWorkspace` (86 KB de fuente) y `OpportunityWorkWorkspace` (81 KB) y elige una según la bandera; la antigua lleva apagada desde el 13 oct. Es parte de los 384 kB de primera carga de /opportunities, y mantener dos pantallas con pruebas que leen ambos archivos confunde (me pasó a mí). *Propuesta:* borrar la antigua con sus pruebas, o cargarla con `next/dynamic`.

### 3.7 Visual y accesibilidad

- **OPP-39 · Lo importante queda bajo el pliegue (administrador)** · Visual · **A / B**

  Con 900 px de alto lo primero que se ve es configuración y un gráfico: cabecera, franja de estado con tres botones («Empresa del workspace», «Ficha para licitaciones», «Actualizar oportunidades»), «Novedades», «Antes de postular», selector de vistas, dos filas de filtros y el embudo en onda (≈400 px). La primera tarjeta de trabajo empieza en y≈990. «Novedades» y «Antes de postular» siguen visibles en «Mercado público», donde no pintan nada. *Propuesta:* onda → barra de etapas de ≈64 px (o colapsable tras el primer uso); configuración y «Antes de postular» a «Ajustes del radar»; novedades como una línea con contador que se expande.

- **OPP-40 · La ficha: cabecera de 540 px y datos repetidos** · Visual · **M / B**

  Repite el equipo tres veces (línea «Equipo», botón «Asignar equipo» que debería decir «Cambiar equipo» cuando ya hay, y el bloque «Equipo de trabajo» con ilustración de escritorios), el botón primario «Cómo postular» duplica la pestaña del mismo nombre mientras la activa es «Informe», y hay dos avisos amarillos (decisión pedida y «este informe se hizo sin las bases») antes del resumen. Con 900 px de alto, el veredicto «Postular» y su resumen quedan en y≈850, y cada pestaña empieza bajo el pliegue. *Propuesta:* el veredicto y el resumen justo debajo de las pestañas; equipo en una sola fila compacta; un solo botón primario que dependa de la etapa; avisos en una franja con prioridad; cabecera compacta o fija al desplazarse.

- **OPP-41 · Tarjetas del integrante demasiado densas** · Visual · **M / B**

  Hasta 9 líneas: tipo, chip «Postular/Evaluar», «cierra mañana», estrellas sin etiqueta, estado, título, resumen, comprador, «Palabra clave: guardias», «Cierre… · Monto…», «Próxima acción…», «Objetivo…» y botón. Y la tarjeta solo se abre con «Abrir y trabajar». *Propuesta:* título, comprador, cierre y monto en una línea, chip, objetivo y próxima acción; quitar «Palabra clave» (dato interno del calce); toda la tarjeta clicable con foco visible.

- **OPP-42 · Móvil: 1.400 px antes de la primera tarjeta y pestañas en tres filas** · Visual · **M / B**

  A 390 px el administrador recorre dos botones apilados, la franja de estado, «Novedades», «Antes de postular», el selector de vistas (que envuelve «Asistente»), la búsqueda, dos filas de chips (que se cortan en el borde sin sombra) y las seis etapas apiladas. Las ocho secciones de una oportunidad ocupan tres filas (≈110 px). *Propuesta:* una sola fila de acciones (menú «⋯»), etapas como un selector («Por revisar · 1 ▾»), chips en una hoja «Filtros» y las secciones en una fila con desplazamiento horizontal y la activa visible.

- **OPP-43 · Pestañas, vistas y chips sin un patrón accesible común** · Accesibilidad/Código · **M / M**

  `role=tab` solo en «Mercado público»; las vistas (Embudo/Lista/Mercado/Asistente) y las ocho secciones de la ficha son botones `aria-pressed` y se ven igual que los chips de filtro: sin flechas de teclado ni «pestaña 3 de 8». En toda la app hay 45 archivos con `aria-pressed` frente a 6 que usan el primitivo `Tabs`. *Propuesta:* un único `SegmentedControl`/`Tabs` en `components/ui` con roving tabindex y desplazamiento en móvil (resuelve también APP-04).

- **OPP-44 · El aviso de acción empuja la página** · Visual · **B / B**

  «Pasó a «Presentada».» entra en el flujo, arriba del todo y por encima de «← Oportunidades»: salto de ≈46 px. *Propuesta:* toast flotante accesible (`role=status`) o espacio reservado.

- **OPP-45 · Etapas cerradas poco visibles; rejilla con huecos** · Visual · **B / B**

  «Perdidas 1 · No recomendadas 3» son botones pero se ven como texto gris bajo la onda; «Por revisar» muestra una sola tarjeta a media anchura con un hueco a la derecha.

- **OPP-46 · Los personajes del informe** · Visual/Tono · **B / B**

  `ReportOffice` (Mensajero, Becario, Analista, Jefe) es entrañable pero decorativo: ocupa ≈250 px y repite el texto de espera. Para el estilo silencioso de `AGENTS.md`, una sola fila de pasos con el actual resaltado. Decisión de tono.

- **OPP-47 · Estrellas sin etiqueta** · Accesibilidad · **B / B**

  El calce se muestra como estrellas sin texto. *Propuesta:* «Calce 4 de 5».

---

## 4. Cowork (COW)

### 4.1 Producto e integración

- **COW-01 · Cowork no sabe de Oportunidades como producto** · Producto · **A / M**

  La guía «Lo que puedo hacer por ti» (7 grupos y web), los 6 chips de inicio y «Para hoy» no traen nada de licitaciones, Compra Ágil ni cierres. Para GrupoExpro, Cowork y Oportunidades son dos productos. *Propuesta:* chips y guía de Oportunidades para quien tiene acceso, `@` de oportunidades en el compositor, y una herramienta `opportunities.list` con puntaje, monto, etapa, equipo y orden por cierre. Hoy devuelve como máximo 5 de cada tipo (empresas que contratan, licitaciones y proyectos del SEIA) y sus campos `status` y `mine` son del modelo antiguo (siempre «nueva» y falso, porque la pantalla nueva ya no los cambia).

- **COW-02 · Cowork no puede actuar sobre Oportunidades** · Producto · **A / M**

  Ninguno de sus efectos asigna, mueve de etapa, crea tareas, pide informes u ofertas. *Propuesta:* efectos aprobables (asignar, mover, crear tarea, pedir informe) con la tarjeta de aprobación que ya existe, y «Seguir en Cowork» desde cada oportunidad (OPP-32).

- **COW-03 · Cruzar investigación y mercado público** · Producto · **M / M**

  Tras investigar una empresa (captura Sodexo), Cowork podría cruzarla con Mercado Público (contratos por vencer y adjudicaciones ya cargados) para sugerir «¿Busco sus licitaciones abiertas y los contratos que vencen en 2027?». Hoy la respuesta sugerida solo propone buscar contactos.

- **COW-04 · Nada avisa fuera de la pestaña** · Funcional · **A / M**

  Sin notificaciones del navegador, service worker ni correos de Cowork (aprobación esperando, tarea larga lista, tarea programada ejecutada). 10 conversaciones «esperando aprobación» en 30 días, 9 con más de 2 días, de 5 personas. *Propuesta:* aviso opt-in por correo o Web Push con resumen y enlace, y el número de pendientes junto a «Cowork» en la barra lateral.

- **COW-05 · Memoria y proyectos** · Producto · **M / M**

  «Lo que Cowork recuerda» solo permite ver y olvidar: no se puede añadir ni editar un recuerdo a mano, no hay instrucciones permanentes (tono, firma, qué evitar, qué priorizar) ni carpetas con archivos propios como en Claude. *Propuesta:* instrucciones por persona y por organización, y proyectos.

- **COW-06 · Sin biblioteca de prompts** · Funcional · **M / M**

  Las plantillas del `/` son los 6 chips fijos más el pedido guardado «Programar». *Propuesta:* «mis prompts» y del equipo, y guardar un pedido bueno como plantilla compartida.

- **COW-07 · Conectores** · Producto · **M / A**

  Gmail y Outlook sí; Calendario y Drive, no (reuniones pedidas por clientes, archivos). *Propuesta:* leer el calendario para proponer horarios en las respuestas que piden reunión.

### 4.2 La conversación

- **COW-08 · Solo se puede editar el último mensaje** · Funcional · **M / A**

  Solo el último mensaje se edita y solo la última respuesta tiene «Otra versión»; no se puede corregir uno anterior y ramificar. Para cambiar algo de hace 4 mensajes hay que empezar de nuevo (y el 79 % de los hilos ya son de un turno). *Evidencia:* código (`onEdit`/`onRegenerate` solo en el último turno).

- **COW-09 · La búsqueda de conversaciones filtra solo por título** · Funcional · **M / B**

  Y aparece con más de 6 conversaciones. *Propuesta:* búsqueda de texto completo con extracto, y por contacto o empresa mencionada.

- **COW-10 · No se puede exportar ni compartir una conversación** · Funcional · **M / B**

  El menú de descarga es por tarjeta, documento o tabla; no hay enlace de solo lectura para mostrarle un hilo a un colega.

- **COW-11 · Sin imágenes ni pegar desde el portapapeles** · Funcional · **M / B**

  Acepta CSV, JSON, MD, TXT, XLSX, PDF y DOCX (20 MB) pero no imágenes (capturas, foto de una tarjeta de visita o de un aviso) ni PPTX, y el compositor no tiene `onPaste`. Haiku 5.5 ve imágenes y la visión de documentos ya está encendida. *Propuesta:* subir y pegar imágenes (tarjeta → guardar contacto; captura de LinkedIn → investigar).

- **COW-12 · Sin fijar, archivar ni carpetas** · Funcional · **M / B**

  La lista solo permite «Renombrar» y «Eliminar» (con «Deshacer»); los hilos recurrentes («Licitaciones del lunes») no tienen dónde anclarse.

- **COW-13 · Sin dictado por voz** · Funcional · **B / M**

  Útil para comerciales en el teléfono.

- **COW-14 · El tope de la conversación avisa tarde y no ayuda a seguir** · UX · **M / B**

  Al llegar a 25 llamadas o 100 mil tokens el mensaje dice «escríbeme en una conversación nueva y retomo con lo que necesites de esta», pero no hay botón ni resumen que lo haga, ni aviso previo. *Propuesta:* «Seguir en una conversación nueva» con un resumen y los adjuntos, y un indicador discreto cuando queda poco.

- **COW-15 · El uso del asistente solo se descubre al chocar** · Producto · **M / B**

  Las tarjetas de aprobación muestran créditos («Te quedan N créditos») pero no hay medidor del uso de IA de Cowork. *Propuesta:* un indicador discreto y, para administradores, el uso por persona (APP-14).

### 4.3 Aprobaciones y autonomía

- **COW-16 · Las propuestas sin resolver se acumulan** · Funcional · **M / B**

  No caducan ni se recuerdan, no hay «Descartar todas las pendientes» ni una vista «Pendientes de mi aprobación» entre conversaciones (en el inicio solo salen 3). Entre las propuestas, 7 `lead_prepare_batch` quedaron sin resolver (frente a 21 aprobadas y 3 rechazadas): la tarjeta que más se abandona. *Propuesta:* caducidad, recordatorio, vista de pendientes y revisar por qué esa tarjeta no se resuelve.

- **COW-17 · El modo «Autónomo» no se recuerda ni se explica a la vista** · UX · **M / B**

  `useState('approval')` lo reinicia en cada carga y conversación; su explicación (qué aprueba, tope de 3 pasos) vive en el `title` del selector (invisible en el teléfono). Sin confirmación la primera vez, sin marca en el hilo de qué se aprobó solo. *Propuesta:* confirmación única con la lista, chip visible en la conversación y registro «aprobado automáticamente» en el resumen.

### 4.4 Tareas programadas

- **COW-18 · Programar tiene poco alcance** · Funcional · **M / M**

  Solo se crea desde el diálogo o «Programar este pedido»; no desde el chat con tarjeta, ni «cada N horas», ni por evento («cuando alguien responda», «cuando aparezca una licitación recomendada»); tope de 5 activas; el resultado queda como una conversación nueva sin aviso (COW-04). *Propuesta:* «Programar esto» como tarjeta tras una respuesta, disparadores por evento y resumen por correo.

- **COW-19 · «Tareas programadas» es un ícono sin texto** · Descubribilidad · **M / B**

  Junto a «Atajos» en el pie del riel; el único con texto es «Memoria». Una de las funciones con más valor frente a Claude Cowork tiene la entrada menos visible. *Propuesta:* «Programadas (N)» con las próximas ejecuciones.

- **COW-20 · El formulario no dice la zona horaria** · UX · **B / B**

  «A las» no dice que es hora de Chile (la lista sí) y la frecuencia y el día son `<select>` nativos mientras el resto de la app usa selectores propios.

### 4.5 Rendimiento y confiabilidad

- **COW-21 · Latencia** · Rendimiento · **A / M**

  Con el bucle anterior un turno completado tardó mediana 49,5 s y p90 145 s (87 turnos; antes se midió 34 s/128 s con otra definición). Con la respuesta retenida (`COWORK_ANSWER_HOLD_ENABLED`) el texto no se muestra mientras se escribe: solo marcadores y «Escribiendo… Revisando…». No hay datos del harness de Haiku en producción. *Propuesta:* medir p50/p90 en cuanto haya uso, mostrar el texto en cuanto exista para respuestas sin tarjetas y paralelizar lecturas.

- **COW-22 · Fallas del 8 %** · Confiabilidad · **M / M**

  De 125 conversaciones en 30 días: 83 % completadas, 8 % fallidas («tardó demasiado», tope del hilo, «No se pudo completar la respuesta», «No logré armar una respuesta válida», «El contacto no está disponible en tu organización») y 8 % esperando aprobación. *Propuesta:* reintento automático de lo transitorio y «Continuar donde quedó» en los fallos.

- **COW-23 · Pendiente de medir** · Dato · **—**

  79 % de las conversaciones son de un solo turno (99 de 125). Hipótesis: el cierre de un turno no invita a seguir y el inicio empuja a «nueva conversación». Medir con el motor nuevo.

### 4.6 Visual y móvil

- **COW-24 · El inicio muestra las mismas conversaciones dos veces** · Visual · **B / B**

  En el riel (Hoy/Ayer) y en «Continúa donde quedaste». En escritorio sobra una, o debería mostrar solo las que piden acción. Además el punto naranja de «necesita aprobación» es muy sutil y las horas restan ancho a los títulos (truncados «Investiga qué hace Sode…»).

- **COW-25 · Sugerencias sin licitaciones** · Producto · **M / M**

  «Para hoy» (2 sugerencias de prospección) no incluye «2 licitaciones cierran esta semana sin equipo» ni «tienes una decisión pendiente».

- **COW-26 · Los chips no cambian con el contexto** · UX · **B / B**

  Con cero contactos el inicio dice «Aún no tienes contactos guardados: empieza buscando prospectos nuevos» pero los chips siguen siendo «Escribir a mis contactos» y «¿A quién le escribo hoy?». Deberían reordenarse (primero «Buscar prospectos nuevos»).

- **COW-27 · «sin resultados» contradice a «2 fuentes»** · Copy · **B / B**

  La huella «Buscó en la web · 2 fuentes · sin resultados» se refiere a una página que no se pudo leer. *Propuesta:* «1 página no se pudo leer».

- **COW-28 · Móvil: una fila entera para un ícono** · Visual · **B / B**

  En el teléfono el inicio gasta una fila de cabecera (≈48 px) para el ícono de historial. *Propuesta:* llevarlo a la barra de arriba.

---

## 5. El resto de la app (APP)

- **APP-01 · «Hoy» apila siete bloques (y tres más a la derecha) y repite contenido** · Visual · **M / B**

  El héroe «Lo primero hoy» repite la primera fila de «Lo que te espera» (la misma persona, dos veces); «Contacto del día» y «Recomendados para ti» son dos bloques que recomiendan contactos; «Tu cuenta está lista…» ocupa una fila para decir que no falta nada; «Suma una llamada y LinkedIn» es otra activación; la columna derecha termina a los ~760 px de una página de ~2.000. *Propuesta:* un héroe + la lista sin repetirlo, fundir «Contacto del día» en «Recomendados», esconder el aviso de cuenta lista tras la primera semana y hacer pegajosa la columna derecha.

- **APP-02 · «Hoy» y «Tu semana» no tienen estado de error** · Estados · **A / B**

  Con las lecturas fallando, «Hoy» se queda en esqueletos grises y «Tu semana» en «Preparando tu informe…» con un spinner (el banco esperó a que se asentaran las lecturas), sin mensaje ni «Reintentar» (el único aviso es el de la barra lateral: «No pudimos cargar tus workspaces»). Oportunidades y Cowork sí lo hacen bien (banner rojo con «Reintentar»). *Evidencia:* navegador (interacciones, comprobación «error»). *Propuesta:* tras ~8 s de esqueleto, «No pudimos cargar tu día. Reintentar».

- **APP-03 · Contraste de la pestaña inactiva de «Hoy | Tu semana»** · Accesibilidad · **B / B**

  `text-muted-foreground` (215 16,3 % 46,9 %) sobre `bg-muted` (210 40 % 96,1 %) = 4,3:1 con texto de 14 px (mínimo AA 4,5:1). Es el único hallazgo de axe en las 141 visitas (18 avisos de un componente, `dashboard/page.tsx:57`). *Propuesta:* `text-foreground/70` (como ya hace la franja de vistas de Oportunidades) u oscurecer 3 puntos `--muted-foreground`.

- **APP-04 · El estado «seleccionado» débil sigue en 8 conmutadores** · Accesibilidad/Visual · **M / B**

  `variant={… ? 'secondary' : …}` (≈1,1:1 sobre blanco): cambio de vista del Pipeline (Panel/Tablero/Empresas), filtros del historial de campañas, «Solo mías» de Conversaciones, «Esta semana/Semana pasada», diseñador de estilo de correo, editor de secuencia, modo de público de la campaña masiva y plan de seguimientos. Ya se anotó el 23 oct; Oportunidades usa la píldora oscura (`filterChip`). En «Tu semana» conviven tres estilos de selección en la misma pantalla: la píldora clara de «Hoy | Tu semana», la gris de «Esta semana | Semana pasada» y la azul de «Personal | Equipo | Oportunidades». *Propuesta:* un único `SegmentedControl` (OPP-43) y migrar los 8.

- **APP-05 · «Oportunidades», «Pipeline» y «Embudo»** · Vocabulario · **M / B**

  El subtítulo de Pipeline dice «Prioriza oportunidades y mueve cada contacto…»; «Oportunidades» son licitaciones y empleo, con su propio «Embudo»; Cowork las mezcla en `opportunities.list`. *Propuesta* (decisión de producto): «Licitaciones» (o «Licitaciones y empleo») para la sección y «Seguimiento comercial» para Pipeline, y una sola palabra en Cowork.

- **APP-06 · La información de la empresa vive en tres lugares** · Producto · **A / M**

  Perfil → «Tu oferta» (prospección), Oportunidades → «Oferta compartida confirmada» y «Ficha para licitaciones», y «Lo que Cowork recuerda». El puente «Usar la oferta de tu empresa» es de un solo sentido y se confirma por separado. *Propuesta:* una ficha única que alimente prospección, licitaciones y Cowork, con fecha de revisión y aviso de cambios.

- **APP-07 · Perfil: una página de 3.200 px** · UX · **M / M**

  Mezcla quién eres, tu empresa, tu oferta, tu cliente ideal, la analítica «Lo que dicen tus resultados» y la contraseña, sin índice ni botón de guardar fijo. «Tu perfil: 10 de 10» mide campos llenos, no riqueza (un caso de éxito basta). *Propuesta:* índice lateral o pestañas («Tú», «Empresa y oferta», «Cliente ideal», «Seguridad»), mover los resultados a Pipeline/Hoy y pedir 3 propuestas y 3 pruebas con cifra (ver APP-16).

- **APP-08 · Pipeline: el anillo y el móvil** · Visual · **M / B**

  El anillo «Pipeline abierto por etapa» usa seis tonos de un mismo azul (más de tres no se distinguen, peor con daltonismo) y repite lo que muestran las barras de «Avance por etapa». En 390 px el botón de actualizar queda solo en una fila y los tres selectores ocupan ≈160 px antes del primer dato. *Propuesta:* dejar solo las barras con escala secuencial y etiquetas directas; en el teléfono, chips con desplazamiento o una hoja «Filtros».

- **APP-09 · Tabla de datos: en el teléfono solo se ve «Nombre» y «Acción»** · Funcional · **M / M**

  Dice «7 columnas visibles» pero no se ve correo, empresa ni cargo; en escritorio la columna «Industria» queda cortada («Ret», «Log») por la columna fija de acción sin sombra que avise de que hay más. *Propuesta:* tarjetas con 3 datos en móvil y sombra de desplazamiento en escritorio.

- **APP-10 · Campañas: la lista no muestra resultados** · Funcional · **M / B**

  Solo «N destinatarios · 2 correos por persona» y el estado (Borrador/Aprobada): sin enviados, rebotes ni respuestas. *Propuesta:* «3 de 6 enviados · 1 respuesta» y orden por actividad.

- **APP-11 · Conversaciones: el panel derecho vacío** · UX · **M / M**

  En escritorio queda «Elige una conversación» aunque haya tres por responder (no abre la más urgente: «Andrea Soto solicitó una reunión»); las alturas de los dos paneles no coinciden (≈620 px contra ≈850); cada tarjeta dice «1 registro» (jerga; «1 mensaje»). *Propuesta:* abrir la primera «Por responder», igualar alturas con panel pegajoso y cambiar el texto.

- **APP-12 · «Revisar correo»: los avisos van antes del correo** · UX · **M / B**

  Hasta cuatro (Outlook sin conectar, revisión pendiente, «No contactar» y «Necesita corrección», estos dos diciendo lo mismo) y hay que bajar para leer lo que se revisa. *Propuesta:* un solo aviso arriba y el resto plegado.

- **APP-13 · «Por escribir» mueve datos al cargar** · Código/Datos · **B / M**

  Cada carga mueve los contactos guardados con correo (`addDedup` y luego `removeWhere`, dos escrituras sin transacción): una pantalla que se mira borra filas. *Propuesta:* escribir directo en «enriquecidos» al guardar (o una migración única) y quitar el efecto de la carga.

- **APP-14 · Administración: tres presupuestos sin vista común** · Producto · **M / M**

  Créditos diarios de prospección (Administración → Créditos), libro de Cowork (llamadas por turno, conversación y día) y US$20 mensuales de Oportunidades. Ver OPP-07 y COW-15.

- **APP-15 · El aviso diario por correo es de prospección para todos** · Notificaciones · **A / B**

  35 de 35 personas reciben la línea «Meta de la semana: …» el 21 y el 23 de oct (y, si van atrasadas, es el asunto del correo), incluidas las que solo trabajan licitaciones. *Propuesta:* contenido según el acceso, apagar la línea de meta a quien no prospecta y sumar líneas de Oportunidades (asignada a ti, decisión pendiente, informe listo, cierra en 3 días). Ver OPP-02.

- **APP-16 · Calidad de los borradores** · Calidad · **A / A**

  Ningún brazo llega a «enviar» sin retoque (a lo más 1 de 16) y «suena humano» queda en 2,6–2,8 de 5; el segundo párrafo repite la propuesta de valor en 6 de 8; con evidencia delgada el gancho es malo. Lo que más ayudaría no es código sino el Perfil (APP-07): con una sola propuesta y una sola prueba el redactor repite la misma frase.

- **APP-17 · Un placeholder cortado** · Visual · **B / B**

  «Por escribir» a 390 px: el buscador dice «…cargo o cor».

- **APP-18 · Carga lenta sin indicador** · Estados · **B / B**

  «Privacidad» y «Centro de ayuda» no muestran que cargan durante 3 s y luego cambian de golpe.

- **APP-19 · El Centro de ayuda abre con el camino de prospección** · Producto · **B / B**

  «Tu camino al primer correo» (6 pasos) no tiene su par «Tu camino a la primera licitación», aunque el manual sí tiene secciones de Oportunidades y Cowork.

- **APP-20 · Ley 21.719 de datos personales** · Legal · **A / M** · *No verificado*

  Según lo publicado, entra en vigencia en diciembre de 2026; ANTON.IA trata datos de prospectos (nombre, correo, teléfono, perfiles). Ya hay «Solicitudes de privacidad», «Incidentes» y «Bajas». Conviene revisar con asesoría legal la base de licitud de la prospección, la oposición, la retención y el registro de actividades antes de esa fecha.

- **APP-21 · La entrada habla solo de prospección y ofrece solo Google** · Copy/Producto · **B / M**

  «Prospecta, escribe y da seguimiento desde un solo lugar.» no menciona licitaciones ni Cowork; además del correo y la contraseña solo hay «Google», y las empresas con Microsoft 365 (Outlook ya se conecta para enviar) no tienen «Entrar con Microsoft». *Propuesta:* un lema que incluya licitaciones («Prospecta, licita y da seguimiento desde un solo lugar») y Microsoft como segundo botón.

- **APP-22 · «workspace» en un texto en español** · Copy · **B / B**

  Aparece en el selector («WORKSPACE»), en «Hoy» («Tus pendientes en este workspace»), en errores («No pudimos cargar tus workspaces», «Cambiando workspace…») y en Oportunidades («Empresa del workspace»). *Propuesta:* una sola palabra en español: «organización» o «espacio de trabajo».

---

## 6. Apuestas más grandes (ideas que juntan varios puntos)

1. **Radar diario en Cowork.** Una tarea programada («cada mañana») que use una herramienta de Oportunidades más rica y mande por correo: licitaciones nuevas que calzan, las que cierran esta semana sin equipo y las decisiones que esperan respuesta. Junta COW-01, COW-02, COW-18 y OPP-02.
2. **Bases en un clic.** Extensión de Chrome en mercadopublico.cl que sube los anexos de la sesión de la persona a la oportunidad (OPP-17).
3. **Biblioteca de la empresa.** Documentos, declaraciones y anexos reutilizables con vencimiento, que prellenan los formularios de las bases y avisan antes de que venza un certificado (OPP-05, OPP-24).
4. **Calibración del calce.** Cada descarte, ganada y perdida con motivo ajusta «Qué buscamos» y el orden de «Recomendadas» (OPP-08, OPP-30). El historial de ChileCompra ya cargado (548 mil ofertas) permite además que «Calcular el precio» arranque con el rango ganador del comprador y del rubro (OPP-23).
5. **Calendario compartido de cierres.** Un feed iCal o Google Calendar con los cierres, las consultas y las próximas acciones del equipo, y recordatorios a 7, 3 y 1 día (OPP-11).
6. **Un solo asistente.** Un chat con habilidades de Prospección, Oportunidades y Cowork en lugar de tres que no se conocen (OPP-32).

---

## 7. Lo que está bien y no hay que tocar

- **Accesibilidad de base:** cada menú, diálogo, hoja, selector y desplegable abre, enfoca, pasa axe, cierra con Esc y devuelve el foco; las pestañas se mueven con flechas; el foco con Tab se ve en cada una de las 16 primeras paradas de cada página; ningún texto 3 veces más largo desborda (34 páginas); 0 desbordes horizontales a 390 px; enlaces externos con `rel=noopener noreferrer`; el modo oscuro tiene la misma jerarquía y ningún aviso de axe.
- **Estados de error de Oportunidades y Cowork** (banner con «Reintentar»; el riel dice «No pudimos cargar tus conversaciones»).
- **El plan de la tarea de Cowork:** «Qué va a pasar / Qué no pasa», pasos con etiquetas, «Lo máximo que puede gastar», «Nunca sin preguntarte», «Descartar plan / Aprobar el plan».
- **La huella de herramientas plegada** («Buscó en la web · 2 fuentes») con enlaces dentro de la respuesta, copiar/👍/👎/«Otra versión» y la respuesta sugerida con su botón.
- **El diálogo de tareas programadas:** estado «Pausada porque no pudo iniciarse tres veces seguidas», «2 de 5 activas».
- **Los diálogos del integrante:** «Reportar un bloqueo» (una pregunta), «Plantear una decisión» (dos tipos, ejemplo en el campo, fecha opcional) y «Asignar y notificar» como verbo.
- **El estado vacío de la ficha** («Prepara el informe completo» con dos pasos numerados y zona para soltar archivos) y el índice «En este informe» pegajoso.
- **El agente de Oportunidades:** 34 de 34 en el chat y 7 de 7 en el asistente con Haiku (`funciones-apagadas-encendidas-2026-10-24.md`), a ≈US$0,0007 por pregunta.
- **Costos:** todo en Haiku; US$0,33 en 30 días de Cowork (217 llamadas); el libro de presupuesto de Oportunidades reserva antes y liquida después.

## 8. Lo que descarté (y por qué)

- «La lista del cliente filtra lo que ya filtra el servidor» (era mi hipótesis sobre `OpportunityWorkWorkspace`): el servidor sí filtra por vista, consulta y fuente; no hay hallazgo.
- «Fechas del informe en UTC» (en el banco se ve `28-10-2026 06:40` junto a «03:46» en la cabecera): es el formato de los datos de prueba; en producción los hitos salen como «22 de octubre de 2026, 17:00», coherentes con el cierre en hora de Chile.
- «Aún no cargamos el historial de ChileCompra» (en Cómo ganar, Contratos por vencer y Competidores): es del banco; en producción el historial está cargado hasta octubre de 2026.
- «Calce» en blanco, «No pudimos calcular algunas probabilidades de calce» y el informe de uso del administrador en error 503: respuestas bloqueadas del banco (las escrituras y algunas lecturas se contestan 503 a propósito).
- «Un error no se avisa» en el Centro de ayuda: es contenido estático.
- «`mm/dd/yyyy`» en los campos de fecha: es el formato de Chromium sin configuración regional; en un navegador chileno sale `dd/mm/aaaa`.
- «Falta la preparación» junto a «Cargando preparación» en «Tu secuencia de contacto»: es la pantalla sin parámetros; con ellos no ocurre.

## 9. Anexo: cómo repetirlo

- **Banco visual:** `npm run audit:visual`, `audit:interactions` y `audit:journeys` (con `AUDIT_COWORK_SCHEDULES`, `AUDIT_COWORK_AUTONOMY`, `AUDIT_COWORK_WEB`). Uso un servidor falso de Supabase en el puerto 54321 y la app en el 9005: no se pueden correr en paralelo. `.next-audit` pesa ≈1,1 GB: bórralo al terminar.
- **Producción (solo lectura), consultas que usé:**
  - Uso de Oportunidades en 30 días: conteos por tabla (`opportunity_work`, `opportunity_participants`, `opportunity_tasks`, `opportunity_company_documents`, `opportunity_competitors`, `commercial_opportunity_tickets`).
  - Tiempos y costos de informes: `opportunity_jobs` (mediana y p90 de `updated_at − created_at` por `kind` y `state`) unida a `opportunity_budget_reservations` (`cost_micro_usd`).
  - Avisos por correo: `daily_alerts` agrupado por `alert_date` y por `kind` de cada línea de `payload->'lines'`.
  - Rendimiento: `pg_stat_statements` (por `opportunity_workspace_list`) y `EXPLAIN (ANALYZE, BUFFERS)` de `opportunity_workspace_list_terms(<organización>, <administrador>, 'review', '', 0, '{}', '{}')`: 577 ms y 92.531 accesos; sin `opportunity_can_read`, 8,8 ms y 1.400.
  - Cowork: `cowork_runs` (profundidad 0, por estado) y conteos de `pg_stat_user_tables` con prefijo `cowork`.
  - Mantenimiento de la base: `get_advisors` de rendimiento.
- **Mediciones con modelo:** `scripts/evaluate-opportunities-assistant.ts` y `scripts/evaluate-opportunities-harness.ts` (solo con `--live`, llave de prueba y la guardia de gasto).
