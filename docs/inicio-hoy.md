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
4. **Abajo:** «Tu semana» (las cifras y el gráfico de siempre) y «Créditos y uso diario».

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

- «Compromisos de hoy» usa el fin del día en la hora del servidor (UTC). Un compromiso que vence entre las 21:00 y las 23:59 de Chile puede aparecer un día antes.
- «Correo conectado» mira los tokens guardados (Gmail y Outlook con automatización). La sesión de Outlook solo en el navegador no cuenta como conectada.

## Pruebas

- `src/lib/home/today.test.ts`: prioridades, cola y reglas.
- `scripts/test-today-panel-ui.mjs`: DOM de carga, acción, cola, preparación, error y reintento. Corre dentro de `test:unit` mediante `__tests__/today-panel-ui.test.mjs`.
