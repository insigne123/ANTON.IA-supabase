# Oportunidades · preparación de activación (13 oct 2026)

## Estado

El usuario autorizó terminar la activación y pidió identificar sus aportes pendientes. Se aplicaron las cinco migraciones de Oportunidades en producción `yfdelflsheurzaicwayi`, una por una, tras revisar el SQL y aprobar el circuito aislado PGlite. No se ejecutaron seeds, resets ni suites contra producción.

| Archivo en Git | Versión remota aplicada | Nombre |
|---|---|---|
| `20261012160000_opportunity_workspace_assignments.sql` | `20261013172814` | `opportunity_workspace_assignments` |
| `20261012162000_opportunity_jobs_and_budget.sql` | `20261013173026` | `opportunity_jobs_and_budget` |
| `20261012164000_opportunity_document_expedients.sql` | `20261013173202` | `opportunity_document_expedients` |
| `20261012165000_opportunity_workspace_reads.sql` | `20261013173313` | `opportunity_workspace_reads` |
| `20261012170000_opportunity_contact_trace.sql` | `20261013173400` | `opportunity_contact_trace` |

**No reaplicar por la diferencia de versiones:** el MCP asigna el timestamp de aplicación; estos nombres y SQL corresponden a los archivos revisados.

Después de cada paso se comprobó esquema, funciones, RLS, grants y locks. Las 18 tablas nuevas tienen RLS, sin grants para `anon`/`authenticated` y con acceso de `service_role`. Las funciones tienen `search_path` fijado y ejecución solo del servidor. Bucket `opportunity-documents` privado, límite20MB y política restrictiva adicional para clientes. Se conservaron las311 oportunidades existentes. No se crearon oportunidades, contextos, jobs ni usuarios de prueba en producción.

Logs de Cloud Run: cero entradas ERROR en las ventanas examinadas, hasta17:34:24Z; revisión `studio-build-2026-10-12-001`, tráfico100%. El MCP disponible no expone logs Postgres: verificaciones de catálogo/locks no sustituyen esos logs. No afirmar observación exhaustiva ni salud futura.

## Proveedores y presupuesto

Preflight readonly17:36Z: cuenta Apify FREE, secretos de Apify/Serper/MP presentes, ticket global MP válido. Metadata autenticada de los actores:

- HarvestAPI posts: US$0,002/post; arranque US$0,00005 porGB (corrida1GB); US$0,001 por consulta sin resultados. `short`, sin enriquecimientos opcionales, comentarios/reacciones apagados. El anuncio «desdeUS$1,50/mil» corresponde a otros tiers.
- Fantastic Jobs: US$0,005/aviso + US$0,01/arranque en FREE; filtro opcional de recruiter apagado.
- Serper: tarifa conservadora de reposición Starter publicada US$1/mil respuestas exitosas. Se reutiliza la credencial/saldo existente; no se compró el prepago mínimoUS$50, ni se certificó saldo o tarifa efectiva de la cuenta. Un error conserva la reserva.

Las tarifas de posts incluyen arranque y consultas vacías antes de distribuir resultados por query. Cálculo en microUSD: el canal secundario de contratación admite exactamente10avisos bajoUS$0,06, evitando el redondeo binario que lo bloqueaba. El hard cap Apify y el ledger de US$20/mes por workspace permanecen; hastaUS$0,75 por expediente con reservas incluidas. El consumo legacy del mes se incorpora al primer bucket: GrupoExpro teníaUS$0,3272 de costo estimado al revisar, no se resetea.

## Oferta compartida y acceso

El perfil antiguo de GrupoExpro tenía la oferta personal YAGO del operador; no es una aprobación de oferta GrupoExpro. PSOL no tenía oferta compartida. El endpoint nuevo deja de sugerir el perfil personal. No se crean contextos `approved_by` hasta recibir la oferta real y su confirmación administrativa.

Configuración preparada: workspace/automatización habilitados a nivel de runtime en el próximo rollout; la búsqueda diaria de cada empresa permanece pausada hasta confirmar su contexto y marcarla. Ticket global permitido a los administradores previstos (dueño, G. Meneses, D. Salgado), siempre con email confirmado. El13oct la cuenta administradoraPSOL `dsalgado@grupoexpro.com` estaba sin confirmar: debe terminar su invitación/verificación; no se cambia ese estado por SQL ni se envían correos automáticamente.

## Reporte: regresión y corrección

Se ejecutó el pipeline integrado versión2, con fuentes/modelos reales y stores locales: cinco llamadas (4Haiku+1Sonnet), nueve documentos, doce secciones, nueve requisitos, seis tareas, seis riesgos y siete preguntas. Duración153.385ms; costo adicionalUS$0,211351. Generación/exports aprobados bajo un único job de hastaUS$0,75. Ledger conjunto: conocidoUS$0,451110, inciertoUS$0,421736, exposiciónUS$0,872846, capUS$2.

Revisión: ahora cita el par pregunta/respuesta de equipamiento y conserva el título clínico delFormulario5, pero persiste el falso truncamiento y se degradan a desconocidos datos presentes en ficha. Causa observada: extracción con puntos suspensivos, unión de pasajes o chunkId equivocado; el validador correctamente retira esas citas, pero la síntesis no veía el original.

Versión3 añade a la síntesis fragmentos originales completos hasta48.000bytes UTF8, con id/documento/localizador y conteo de fragmentos omitidos. Ese texto está incluido en la reserva de costo antes de la llamada. La síntesis puede recuperar citas literales desde esos fragmentos, sin debilitar la validación ni interpretar una mala cita de extracción como fuente ausente. Se explicita la fórmula de margen del calculador compartido para evitar confundir markup con margen. No se crea una reparación/fallback pagado automático.

La muestra versión3 se ejecutó desde el código congelado `f0a93001db33694d8f703e077cbcebda291400e9`: cinco llamadas y **US$0,237061** adicionales. Reserva máxima de síntesisUS$0,618740 más extracción ya observadaUS$0,011107 = exposición previa a síntesisUS$0,629847, bajo el capUS$0,75 del mismo job. El informe recupera los datos de ficha con citas (ponderaciones, pagos, garantías), reconoce la continuación de la respuesta7690765, cita equipamiento con respuesta y conserva el objeto distinto delFormulario5. La recomendación vuelve a no avanzar por proceso cerrado.

El primer exportPDF de versión3 falló explícitamente por la notación matemática `Σ(P x Q)`; el JSON/Markdown y recibos pagados ya estaban conservados. Se añadió transliteración local de sumatoria al export de Oportunidades, sin alterar el texto original editable ni debilitar el rechazo de idiomas/glifos no soportados. Exportar de nuevo usa el reporte guardado, sin ninguna llamada al modelo. Los escenarios vacíos muestran un mensaje de datos pendientes en vez de un encabezado vacío.

Ledger total de16llamadas: conocido **US$0,688171**, reserva incierta original **US$0,421736**, exposición **US$1,109907**, dentro deUS$2. Originales y las tres versiones conservadas; no se liberó incertidumbre ni se repitió un paid start. La revisión semántica confirma las mejoras señaladas, pero no acredita precisión universal: todavía faltan bases completas, oferta real y respaldo explícito de todas las afirmaciones compuestas. El informe llama inconsistencia a bruto/neto, que puede ser una distinción de conceptos normal; debe revisarse al usarlo comercialmente.

## Rollout pendiente del mantenedor

El mantenimiento del repo reserva despliegue/rollback al mantenedor. Esta preparación no inicia un rollout ni publica Functions.

Desde `main` canónico limpio y actualizado, con CI del head exacto aprobada:

1. Comprobar estas cinco migraciones por nombre/versiones y el secretoClaude versión1 ENABLED/permisos.
2. Publicar solo `functions:opportunityWorkspaceTick` al proyecto `leadflowai-3yjcy`. Confirmar ACTIVE Node22, scheduler cada minuto, retry0, binding `FIREBASE_SCHEDULER_SECRET`. Antes del rollout la ruta puede responder404 en la revisión antigua; eso no valida el módulo.
3. Publicar `apphosting:studio` desde ese main con `apphosting.yaml` integrado. Confirmar READY, commit/build correcto, secretoClaude bound, flags runtime y100%tráfico.
4. Smoke sin sesión: `/api/onboarding/tour`401, `/cowork`200, `POST /api/cowork/wake`401, workspace/documentos/chat/export privados rechazados, `POST /api/cron/opportunity-workspace`401 sin secreto. Tick autorizado y sin contextos: processed0, sin gasto.
5. Con cuentas reales: admin confirma oferta, crea/carga oportunidad, asigna; miembro ve solo la asignada y sus documentos. Revocación retira acceso. Completar análisis/chat/descargas con presupuesto medido, sin envíos.
6. Registrar logs, tráfico y smoke; etiquetar `prod-YYYY-MM-DD` al deploy bueno. Conservar el último tag anterior. Rollback por revert+redeploy+smoke, conservando el esquema aditivo y los datos.

## Aportes imprescindibles del usuario

- La oferta de **GrupoExpro** y de **PSOL** ya fue [investigada desde fuentes públicas y registrada](oportunidades-investigacion-empresas-2026-10-13.md) por solicitud posterior del dueño. No es necesario aportar brochures para iniciar. Catálogo e inferencias separados; experiencia certificable, costos y disponibilidad permanecen por acreditar en cada propuesta.
- Confirmación del correo/invitación de la cuenta administradoraPSOL.
- Bases administrativas/técnicas originales para cerrar la aceptación documental del caso1057049-332-LR26, o una oportunidad equivalente con expediente completo. Los formularios y foro ya obtenidos no las reemplazan. PDFs escaneados requieren texto legible: OCR todavía no está integrado.
- Ejecución del rollout por el mantenedor y prueba de sesión real para verificar el circuito autenticado.

## Hallazgo previo de seguridad registrado

La inspección del catálogo comprobó25tablas antiguas sin RLS y con grants de lectura/escritura a roles cliente, incluidas `chat_histories`, `search_queue` y tablas de otros proyectos. Es independiente del esquema nuevo de18tablas privadas. Su corrección requiere revisar los consumidores y definir políticas; no habilitar RLS a ciegas, porque interrumpiría esos flujos. Se deja registrado para remediación separada.
