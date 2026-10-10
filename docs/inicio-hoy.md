# «Hoy»: un inicio que dice qué hacer

**Fecha:** 1 de octubre de 2026.

**Reemplaza** el Dashboard: cuatro cifras en cero y tres enlaces fijos (CRM → campaña → leads) que no decían qué hacer.

## Por qué

En producción (solo lectura y agregada), en la organización con más usuarios:
- **28 personas:** 15 nunca entraron.
- **Correo conectado:** 1 de 28.
- **Oferta en «Perfil»:** 3 de 28.
- **Contactos con correo:** 94 esperando.
- **Correos enviados:** ninguno, nunca.

El embudo se corta antes del envío y el inicio no lo decía (hallazgos H02 y H04 de `docs/ui-ux/informe-recorrido-grupoexpro-2026-09-12.md`).

## Qué muestra

1. **Lo primero hoy.** Una sola acción, en este orden:
   1. quien te respondió (una solicitud de reunión va antes que todo);
   2. lo que impide enviar (perfil sin oferta, correo sin conectar);
   3. un compromiso que vence hoy;
   4. «Escríbeles a tus N contactos con correo»;
   5. completar el correo de los guardados;
   6. buscar prospectos.
2. **Lo que te espera:**
   - Hasta 6 ítems, los urgentes primero: respuestas por atender (la misma regla que «Por responder» en Conversaciones), compromisos de hoy o vencidos, y contactos con correo que aún no recibieron nada.
   - Cada ítem abre la conversación exacta (`/contacted?c=<id>`).
3. **Prepara tu cuenta:**
   - Cuatro pasos comprobados de verdad, con barra de progreso: perfil con empresa y oferta, correo conectado (Gmail u Outlook), primeros contactos y primer envío.
   - Cada paso pendiente trae su enlace. Al completarse, se tacha.
4. **Al lado:** «Tu resumen de hoy», actividad por hora de Chile y disponibilidad del cupo personal. Las estadísticas son del usuario dentro del workspace activo.

El menú dice «Hoy» en vez de «Dashboard». La ruta sigue siendo `/dashboard`.

## Cómo funciona

- **`GET /api/home/today`:** lee solo lo de la persona (su organización activa y su `user_id`):
  - `profiles`;
  - de `provider_tokens`, solo qué proveedores (como `/api/integrations/store-token`);
  - el conteo de `leads`;
  - correos de `enriched_leads` y `contacted_leads`;
  - respuestas y compromisos (`contacted_leads.data.commitment`).
- **Decide la lógica pura** de `src/lib/home/today.ts` (`buildTodayPlan`). Si hay más de 1.000 enriquecidos, responde `partial: true`.
- **Sin migración, sin variables nuevas y sin escrituras.**

## Límites

- «Compromisos de hoy» usa el día de Chile, incluidas las transiciones reales de horario de verano. Los vencidos anteriores siguen en la cola, con fecha; no se suman a las estadísticas de hoy.
- «Correo conectado» mira los tokens guardados (Gmail y Outlook con automatización). La sesión de Outlook solo en el navegador no cuenta como conectada.

## Pruebas

- `src/lib/home/today.test.ts`: prioridades, cola y reglas.
- `scripts/test-today-panel-ui.mjs`: DOM de carga, acción, cola, preparación, error y reintento. Corre dentro de `test:unit` mediante `__tests__/today-panel-ui.test.mjs`.

## Corrección personal · 10 oct 2026

La captura entregada por el dueño reveló una mezcla de períodos/alcances: el resumen sumaba todo el histórico de la organización y el gráfico mostraba siete días de otra consulta. Los 600 registros de su organización de prueba estaban fechados entre febrero y abril, asociados a su usuario, pero sin referencias a dispatches confirmados del sistema actual. Se preservó el histórico: no prueba envíos personales hechos hoy ni se presenta como una operación de envío.

- `GET /api/home/summary`: únicamente `user_id` + organización autorizada + día actual de America/Santiago. Envíos desde `outbound_dispatches.status='sent'`, con hora efectiva/reconciliada; destinatarios únicos aparte de mensajes. Respuestas humanas clasificadas fechadas hoy, automáticas/sin clasificar informadas aparte y rebotes excluidos. Guardados hoy, no inventario acumulado. Lecturas paginadas y fallo explícito, nunca error convertido en cero.
- El gráfico consume **el mismo snapshot** que las cifras: no descarga historial compartido ni incluye `organization_id is null`.
- `GET /api/home/today`: pendientes propios, incluidos anteriores. Fechas visibles, deduplicación por dirección, nombre completo conocido o inicial (`Daniela M.`); no reconstruye apellidos. Primer envío de puesta en marcha exige un dispatch confirmado, no la existencia de un registro histórico. Perfil/conexiones/inventario son preparación o trabajo pendiente, no KPIs diarios.
- Recomendados: únicamente contactos del usuario. Cowork conserva su consulta explícita de organización. Locks de equipo siguen previniendo conflicto antes de contactar.
- `GET /api/home/credits`: cupo personal del usuario/workspace según RPC autoritativo; el cupo legacy de cuenta se identifica como compartido entre workspaces. No se muestra el uso de contacto agregado del equipo como una estadística personal.
- `usePersonalHome`: request con sesión actual y organización fijada; respuesta comprobada por usuario/organización/día. Aborta/descarta respuestas anteriores, retira datos al cambiar de scope y vuelve a consultar al pasar medianoche de Chile. Mismas reglas para propietario, admin y miembro.

Sin migración ni modificación de cuotas, correos o históricos. Pruebas: `home-summary.test.ts`, `home-auth.test.ts`, `home/scope.test.ts`, `home/today.test.ts`, recomendación personal y Chrome fixture `scripts/test-personal-home-browser.mjs`. Incluyen primavera con medianoche inexistente (23 horas), otoño con hora repetida (25 horas), dos usuarios/workspaces, 600 históricos, paginación, datos equivocados y respuestas tardías. No son una aceptación autenticada productiva.
