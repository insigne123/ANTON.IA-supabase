# Administración · uso, resultados y créditos

## Entrega

La entrada de Administración (`/dashboard/admin`, alias `/dashboard/admin/usage`) muestra un informe agregado: quién usa la app, qué trabajo se registra, qué resultados comerciales hay y qué necesita atención. No comienza con logs individuales.

- Período: hoy, ayer, 7/30/90 días o rango personalizado de hasta un año.
- Alcance: administrador de empresa, solo su organización activa; administrador de plataforma autorizado, todas las empresas o una empresa concreta.
- Resumen, Personas, Comercial e Histórico diario. Abrir una persona conserva período/empresa y ofrece su resumen, pendientes e histórico.
- Resumen por día con participantes, funciones, trabajo y créditos. Drawer con teclado/foco; móvil y claro/oscuro con los tokens existentes.
- CSV del alcance observado, con protección de fórmulas de spreadsheet.

## Referencia y adaptación

Problema de layout, flujo y lectura de datos. Referencias consultadas: [Figcomponents dashboards](https://www.figcomponents.com/components/dashboard) para filtros/tablas/paneles y [PostHog dashboards](https://posthog.com/docs/product-analytics/dashboards) para período compartido, desglose y drilldown. Se rescata la progresión resumen → persona/día → contexto, adaptada a `src/components/ui/*`, Recharts y la paleta de ANTON.IA. Sin assets, branding ni tipografías de esas referencias.

## Definiciones

- **Personas activas/días con uso:** visitas autenticadas observadas y búsquedas con actor humano explícito. Los workers, respuestas recibidas y trabajos atribuidos a una cuenta no prueban que la persona estuvo en la app.
- **Trabajo:** entidades operativas deduplicadas, con resultado/estado separados de las visitas. Cowork y sus procesos no exponen solicitudes, mensajes ni documentos al administrador.
- **Comercial:** contactos guardados/contactados, investigaciones terminadas, borradores, respuestas humanas clasificadas, interés y solicitudes de reunión; reunión registrada con fecha, reunión marcada realizada y etapas/cierres declarados en CRM son hechos diferentes. La app no verifica compras externas ni asistencia a reuniones.
- **Conversión de correo:** primer contacto del período por destinatario/empresa, ventana común de 7/14/30/60 días y denominador maduro. Respuesta automática no oculta una respuesta humana posterior. Interés posterior se conserva aunque la primera respuesta humana haya sido neutral. Falta de enlace/clasificación/sincronización no es cero.
- **Comparación:** cohortes del período anterior de la misma longitud y ventana de observación. No se divide “respuestas recibidas este mes” por “envíos de este mes” de otra población.
- **Diagnósticos:** hechos pendientes/técnicos/configuración/protección y señales comerciales. Se muestran causas conocidas y próximos pasos, no puntuaciones de culpa ni benchmarks inventados. Los pendientes son actuales, explícitamente separados del trabajo del período.

## Créditos de la app

Se conservan las reglas de consumo. Una operación híbrida descuenta dos cupos de control, pero se cuenta una vez como consumo lógico. Los movimientos se registran en la misma transacción del débito o devolución; una denegación no crea un gasto. La devolución corresponde al día de cupo original.

El histórico anterior se reconstruye desde los contadores y políticas disponibles, descontando la parte que ya está en el journal. El reparto individual antiguo de un cupo de equipo puede ser desconocido: permanece sin atribuir, no se reparte arbitrariamente. El contador legacy de cuenta no tiene empresa; solo la vista global puede mostrarlo sin empresa atribuida.

Actividad/horas: America/Santiago. Créditos: día de cupo UTC, como el reinicio real. El panel lo indica en el gráfico y en el detalle diario. El saldo de hoy utiliza `get_antonia_credit_status_v2` y sus snapshots, no una reconstrucción de límites.

## Datos y permisos

- `app_usage_views`: evento/session UUID, empresa, actor, equipo, módulo y reloj del servidor. No query strings, contenidos, IPs, actividad de teclado ni tiempo de pestaña abierta. Idempotencia y tope por minuto; fallar la captura no bloquea el trabajo.
- `admin_credit_movements`: recurso, unidades firmadas, modo, empresa/persona/equipo y día de cupo.
- `admin_commercial_facts`: IDs opacos y metadatos de estados/resultados, reuniones y respuestas. Retiene la atribución del equipo al registrar el trabajo; no mueve trabajo completado al cambiar de equipo después.
- RPCs de informe/nombres/captura solo para service_role, tablas con RLS y sin acceso directo de browser. BFF verifica sesión, correo confirmado y rol vigente antes de usar el cliente de servicio.
- `ADMIN_USAGE_PLATFORM_USER_IDS`: capacidad explícita de lectura global, inicializada para el dueño. No se hereda de `ADMIN_DASHBOARD_ALLOWED_EMAILS` ni de user_metadata; no concede edición global de créditos o membresías.
- Exintegrantes conservan historia agregada. Una empresa no consulta su perfil Auth actual fuera del roster autorizado.
- Los agregados SQL no descargan cuerpos de correo/documentos al frontend y no llaman proveedores. Roster con paginación; drift de alcance se rechaza.
- Cambios de alcance/período retiran resultados viejos, respuestas tardías no los restauran y 401/403 retiran información privada. Un 503 durante refresh conserva los datos observados del mismo alcance.

## Activación pendiente

Implementación en código y migraciones candidatas. No aplicadas a producción durante este encargo. Ejecutar una por vez, verificando esquema, permisos, RLS y logs:

1. `20261010090000_admin_usage_foundation.sql`: tablas y escritura de metadatos/nombres.
2. `20261010093000_admin_usage_capture_credits_commercial.sql`: instrumentación transactional de cuotas y captura de hechos. El parche verifica anclas únicas del cuerpo instalado; un contrato desconocido aborta, no cambia las reglas a ciegas.
3. `20261010100000_admin_usage_reports.sql`: agregación privada por alcance/día y cohortes.

Después, desplegar main limpio y comprobar empresa/usuario/ventana/actor real sin envíos a prospectos. El permiso global requiere la binding RUNTIME de `apphosting.yaml`. Antes de completar las fuentes, el panel dice que se prepara la medición; no presenta cero actividad.

## Cobertura histórica

No existe navegación anterior a su fecha de captura. Estados mutables y clasificación antigua no se convierten en historial inmutable por inferencia. Los registros comerciales antiguos disponibles se muestran con clasificación actual y cobertura parcial; las tasas requieren evidencia enlazada suficiente. No se recorre ni reclasifica contenido privado al abrir el informe.

## Verificación

- Node 22, typecheck/build y suite completa: **2.762/2.762**, 501 archivos/16 lotes; después se añadieron dos casos HTTP y pasaron junto a los otros cinco casos de seguridad del servidor. La CI del head final debe verificar los **2.764** casos completos. La primera ronda detectó una aserción antigua del guard y falta transitoria de recursos locales; se corrigió el contrato del guard y la repetición secuencial pasó. Fallos simulados dentro de tests no son fallas de la suite.
- SQL real aislado: modos híbrido/equipo/legacy, denegación/devolución, journal+contadores sin duplicación, idempotencia, scope/roles, metadata privada, reunión vs llamada, enlace y madurez de cohortes, reasignación e inputs legacy malformados.
- Chrome fixture: 8 anchos/temas (360/390/768/1440, claro/oscuro), cero overflow/page errors/violaciones axe; persona, drawer/Escape/foco, refresh/error/revocación, fuente sin activar y captura con StrictMode sin queries/contenidos.
- Evidencia local en Temp `admin-usage-rendered-20261010/`. No es aceptación autenticada productiva ni estudio con usuarios. No se cargó `.env.local`, no hubo modelos/proveedores/envíos ni escrituras productivas.
