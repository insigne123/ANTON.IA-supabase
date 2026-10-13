# Oportunidades: asignaciones, captación y expedientes

## Contrato de producto

El admin gestiona el catálogo, carga invitaciones privadas, confirma la oferta organizacional y asigna equipos. Los miembros reciben notificaciones y acceden únicamente a oportunidades asignadas. Dentro de ellas trabajan tareas/documentos, vinculan contactos, consultan la investigación y preguntan a la IA. Abrir una notificación no implica gestión ni envío.

Ambas señales LinkedIn: avisos laborales y publicaciones. La prioridad configurada en el contexto distingue la distribución de captación (GrupoExpro: contratación; PSOL: publicaciones), sin inventar el catálogo a partir del nombre. La oferta se confirma una vez, no se solicitan keywords al miembro.

## Concurrencia y reutilización

Se desarrolló en `feat/opportunities-workspace-20261012`, worktree aislado desde main; se incorporan los avances de redactora/cliente Claude de main sin sustituirlos. Se reutiliza `src/ai/openai-json.ts` y su adaptador Claude. Los modelos del resto de la app no cambian.

Tablas `commercial_opportunities` y `organization_reporting_groups` reutilizadas. Nuevas tablas son privadas/RLS/service-only; BFF comprueba workspace, rol y participación. Cowork/artefactos también aplican visibilidad por asignación. Storage privado con política restrictiva adicional; descargas por BFF autenticado para volver a comprobar permisos, no enlaces públicos.

## Activación

Defaults off: `OPPORTUNITIES_WORKSPACE_ENABLED`, `OPPORTUNITIES_AUTOMATION_ENABLED`. No se aplican migraciones remotas ni se despliega por integrar esta PR. Mantener apagado hasta validar esquema, proveedor y aceptación. Las migraciones locales son forward-only, una por vez:

1. `20261012160000_opportunity_workspace_assignments.sql`: permisos por objeto, equipos, revisión de asignación, actividad/notificaciones/tareas.
2. `20261012162000_opportunity_jobs_and_budget.sql`: contexto, jobs/claims, snapshots, reserva y liquidación.
3. `20261012164000_opportunity_document_expedients.sql`: documentos, fragmentos, reportes, chat, publicación cercada y Storage.
4. `20261012165000_opportunity_workspace_reads.sql`: listado paginado/filtrado y persistencia cercada de candidatos.
5. `20261012170000_opportunity_contact_trace.sql`: observaciones privadas de resultados y vinculación de contactos guardados.

Nuevo scheduler `opportunityWorkspaceTick` cada minuto, ruta `/api/cron/opportunity-workspace`, autenticación Firebase existente. El cron anterior encola cuando el nuevo workspace está activo y no ejecuta el circuito antiguo, evitando presupuesto paralelo.

Credenciales existentes servidor: ANTHROPIC_API_KEY, OPENAI_API_KEY para Luna si se configura, APIFY_TOKEN, ticket MP cifrado del administrador. Las tarifas de conector deben comprobarse y configurar `OPPORTUNITIES_POST_USD_PER_ITEM`; no se asume la publicidad «desde». Modelos permitidos `claude-haiku-5-5`, `claude-sonnet-5-5`, `gpt-6-luna`; variantes por rol `OPPORTUNITIES_SCREEN_MODEL`, `OPPORTUNITIES_EXTRACT_MODEL`, `OPPORTUNITIES_REPORT_MODEL`, `OPPORTUNITIES_CHAT_MODEL`. Luna requiere su snapshot de precio explícito.

Contexto público del cliente: Serper existente con `OPPORTUNITIES_SERPER_USD_PER_REQUEST` explícito, hasta dos consultas y cuatro páginas leídas, sin enviar texto de invitaciones privadas al buscador. Tarifa configurada y reservas cuentan dentro del mismo trabajo de investigación. Sin credencial/tarifa se registra la ausencia de investigación web; no se inventa contexto. Los prepago/mínimos del proveedor se verifican antes del piloto.

## Presupuesto y trabajos

Techo conjunto US$20/mes UTC/workspace: fuentes8, evaluación3, investigación6, chat2, reserva1. HastaUS$0,75 por expediente sumando pasos. El presupuesto incorpora el gasto legacy ya registrado al crear el bucket mensual; exposición incierta de meses anteriores sigue contando. Reserva transaccional previa, lease vigente, default fallback desactivado, un intento de modelo. Salida inválida conserva telemetry; timeout no cuenta cero. Cada resultado válido queda junto a su liquidación para recuperar sin otra llamada. Se incluye el output de razonamiento adicional del cliente Claude en la reserva.

Paid starts Apify: checkpoint `submitting` antesPOST, reserva y runId durable. GET recupera un run conocido; sin recibo no se repite el POST. Costo observado se liquida una vez; unknown permanece reservado. La captación acota resultados a presupuesto diario, comentarios/reacciones desactivados, consultas derivadas. MP guarda snapshot de lista y cursor antes de continuar persistencia, la evaluación conserva positivos/negativos/pendientes. El registro global de candidatos no es garantía de cobertura total de posts. Compra Ágil anuncia su límite de páginas.

## Expediente y reporte

Texto recibido, PDF, DOCX, XLSX, TXT/MD/CSV, hasta20MB por documento. PDF se lee página a página (hasta300/45s), Word con tablas, todas las hojas hasta límites del parser de planillas. Fragmentos citables con documento/ubicación, hash y cobertura. Nuevos documentos invalidan análisis en curso en vez de mezclarse silenciosamente. Modelos extraen hechos en bloques y Sonnet sintetiza estrategia, requisitos, condiciones, solución, riesgos, tareas, preguntas y escenarios. Citas se validan contra el texto; documentado sin soporte pasa a desconocido. Cálculos compartidos en código para web/PDF/Excel, sin asumir IVA ni probabilidades de adjudicación.

El informe es un contenido versionado, no compromisos contractuales. Profundidad basada en el PDF de referencia del usuario: decisión ejecutiva, estrategia de puntuación, ejecución, garantías, costos/capital de trabajo, riesgos, hoja de ruta y fuentes. Originales y capturas son datos, nunca instrucciones. Mini chat recupera fragmentos del expediente y cita; no ejecuta envíos o postulación.

Exportación PDF (tablas con encabezados, avance de requisitos, hitos), Word, Markdown, Excel y ZIP de originales/índice. Descargar reutiliza el informe sin gastar IA otra vez. ZIP hasta80MB, los demás originales se descargan individualmente.

## Cobertura que debe validarse antes de activar

El descargador automático procesa documentos y enlaces de adjuntos públicos de la página vinculada, con DNS público fijado y redirecciones controladas. No se garantiza un inventario exhaustivo de anexos del portal: páginas que requieren sesión/JavaScript o adjuntos sin enlaces directos quedan pendientes. Los PDF escaneados se señalan; OCR aún no está integrado. El detalle MP se incorpora con ticket, y las invitaciones privadas no requieren un código público. No se certifica un expediente completo con bases ausentes.

La búsqueda de decisores propaga un ID explícito y verificado; observaciones del BFF permiten vincular IDs proveedor a contactos realmente guardados. Historial de dispatches confirmados/respuestas se presenta como historial del contacto y puede ser anterior a la oportunidad; no se atribuye automáticamente a esta oportunidad. La atribución de todos los envíos LinkedIn/reuniones a oportunidad necesita ampliar los eventos originales antes de reportarse como exhaustiva.

### Piloto documental real · 13 oct 2026

Caso autorizado `1057049-332-LR26`, sin escrituras productivas, contacto o postulación. Navegación pública normal: ficha, siete formularios Word y 23 preguntas con sus 23 respuestas. El inventario general devuelve403 tras su validación reCAPTCHA; no se intenta saltarla. Se verificó también la descarga mediante los formularios WebForms públicos: siete binarios con el mismo SHA256 que la navegación normal. Se añade ese lector específico y el foro público al expediente, usando exclusivamente una sesión anónima propia y operaciones de lectura fijadas; no requiere navegador desatendido ni cookies del usuario. Bases completas/modificaciones no quedan certificadas. HTML de acceso denegado no cuenta como anexo.

El foro aporta dotación9 (3 analistas/implementadores,2backend,2frontend,2DevOps), turnosT8/T6/T4/T2 con precio unitario por turno, equipamiento provisto por el hospital y ausencia de proceso anterior según la respuesta publicada. Los formularios incluyen una inconsistencia de título en N°5 que debe conservarse y aclararse. Al corte del piloto la licitación está cerrada; la ficha muestra426reclamos de los últimos12meses, distinto del snapshot histórico del PDF. La exportación API muestra otra cifra sin período equivalente: no mezclar esas métricas ni inferir probabilidad de atraso. Estos datos son del caso, no reglas universales del módulo.

La [evaluación pagada y revisión de calidad](oportunidades-piloto-2026-10-13.md) registra costos, reserva incierta y brechas semánticas. La versión2 de síntesis transporta una cadena JSON externa y valida el contrato completo localmente, dentro de las reservas/replay existentes. No regenera reportes automáticamente ni cambia modelos globales. Las citas literales válidas no certifican la exactitud de una afirmación.

## Validación

Pruebas sin `.env.local`, proveedores o escrituras productivas: unitarias de permisos puros, identidad/citas, calendarios DST, precios/cache, finanzas; SQL real PGlite de asignación/aislamiento/notificaciones/revocación, leases/reservas/replay/caps, RLS/Storage; pgTAP en CI sobre el stack aislado. Revisión DOM/renderizada adicional con APIs sintéticas en claro/oscuro y móvil/escritorio. El piloto pagado necesita muestra, presupuesto y esquema aprobados antes de activación remota.

Verificación local: `typecheck`, Functions build y Next build (46 páginas); suite base completa en 17 lotes (primer comando agotó tiempo tras lote12; se reanudaron solo13–17). Pruebas nuevas de exportación/fechas ejecutadas después. SQL real aislado aprobado; ocho escenarios de Chrome (390/1440, admin/member, ambos temas) sin overflow, errores de página ni violaciones axe y revocación que retira el reporte. Pipeline binario comprobó todas las45 páginas de un PDF sintético, tablas Word y hojas Excel, y replay de resultado IA sin repetir llamada ni liquidar timeout en cero. Esto no acredita precisión de un modelo real ni obtención completa del DOM actual del portal.
