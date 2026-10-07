# Oportunidades · cuándo se busca sola (Plan 15, 6)

## Qué cambia

En «Ajustes de la búsqueda» aparece **«Cuándo se busca sola»**:
- un interruptor para pausarla;
- los días de la semana (L a D);
- la hora, en hora de Chile.

**Valor por omisión:** todos los días a las 08:00, igual que hoy.

**Dónde se ve el horario:**
- el resumen de «Empresas contratando» dice «Búsqueda programada · De lunes a viernes a las 07:00»;
- el de Licitaciones dice «Se actualiza sola: …».

**Qué busca la búsqueda programada:** licitaciones, Compra Ágil y Google for Jobs. LinkedIn queda para cuando busca la persona, porque antes ve su costo.

## Cómo funciona

- **`commercialOpportunitiesTick`** (`functions/index.ts`) pasa de una vez al día (`15 11 * * *`) a **cada hora** (`15 * * * *`).
- **La ruta `/api/cron/commercial-opportunities` busca a una organización cuando:**
  - hoy es uno de sus días (hora de Chile);
  - ya pasó su hora;
  - todavía no tuvo una búsqueda programada ese día.

  Así, una hora que el programador se salta se recupera en la siguiente, y nunca se busca dos veces el mismo día. La respuesta cuenta las organizaciones que no tocaban (`notDue`).
- **El horario se guarda en `commercial_opportunity_profiles`:** `schedule_enabled`, `schedule_days` (0 domingo … 6 sábado) y `schedule_hour`, con la migración `20261008100000_commercial_opportunity_schedule.sql` y su prueba pgTAP.
- **La lógica pura** está en `src/lib/commercial-opportunities/schedule.ts`: `scheduleDue`, `chileanClock` y `describeSchedule`.

## Orden de despliegue

1. **Aplicar la migración.** Antes de eso, la página no ofrece el horario y la búsqueda usa el de siempre.
2. **Desplegar la función** (la hace el mantenedor):

   ```bash
   firebase deploy --only functions:commercialOpportunitiesTick
   ```

   Mientras siga la función diaria de las 11:15 UTC (08:15 en Chile en verano), solo se cumplen los horarios de las 08:00 o antes.

## Rollback

`git revert` del PR y volver a desplegar la función. Las columnas quedan y no molestan.
