# Créditos por organización y devolución de teléfonos

Desde el 20 de noviembre de 2026 lo que cuesta buscar un correo o un teléfono puede ser distinto en cada organización, y una
organización puede tener pactada la devolución de los créditos de los teléfonos que no existen.

## Precios

- Tabla `organization_credit_prices`: `email_credits`, `phone_credits`, `both_credits` (correo y teléfono pedidos juntos; nulo
  es la suma de los dos) y `phone_refunds` (si tiene devolución). Solo la lee y escribe el servidor.
- Una organización **con fila** se cuenta a sus precios en todas partes: botones, correos, PDF, Cowork, la revisión antes de
  pedir el dato y la base (`apollo_credit_allocation_status_v3`).
- Una organización **sin fila** queda como siempre: las pantallas dicen 1 por el correo y 8 por el teléfono o por ambos; la base
  cuenta 1 + 8 = 9 cuando se piden juntos. Esa diferencia es anterior a este cambio y la decide el dueño: una fila `1, 8, 8`
  hace que la base cuente 8; cambiar `both` en `DEFAULT_CREDIT_PRICES` (`src/lib/credit-prices.ts`) hace que las pantallas digan 9.

Fijar los precios de una organización (lo hace el equipo de ANTON.IA, en producción):

```sql
insert into public.organization_credit_prices (organization_id, email_credits, phone_credits, both_credits, phone_refunds, note)
values ('<id de la organización>', 1, 5, 6, true, 'Contrato …')
on conflict (organization_id) do update
  set email_credits = excluded.email_credits, phone_credits = excluded.phone_credits, both_credits = excluded.both_credits,
      phone_refunds = excluded.phone_refunds, note = excluded.note, updated_at = now();
```

## Devolución de teléfonos que no existen

1. El administrador del cliente abre **Administración → Teléfonos que no existen** y pega los números (uno por línea, hasta 100
   por envío). Solo se aceptan teléfonos que ANTON.IA le entregó a esa organización, una vez cada uno.
2. Cada número queda «En revisión» y el equipo de ANTON.IA recibe un correo (`PROVIDER_ALERT_EMAILS`, por Resend).
3. El equipo prueba cada número (el contrato da 5 días hábiles) y responde en la misma tarjeta: **No existe: devolver** o
   **Sí existe**. Esos botones los ve solo un operador de `ADMIN_DASHBOARD_ALLOWED_EMAILS` que sea administrador de esa
   organización. También se puede responder por SQL:

   ```sql
   update public.phone_refund_claims set status = 'confirmed', reviewed_at = now(), review_note = 'Fuera de servicio'
   where id = '<id>' and status = 'reported';
   ```

4. Un teléfono confirmado devuelve lo que costaba un teléfono el día en que se envió (`credits`). Lo devuelto se suma a lo
   disponible del período en que se confirmó y, si no se usa, pasa al período siguiente; después se pierde.

La tarjeta solo aparece en organizaciones con `phone_refunds = true` (o que ya tengan teléfonos enviados).

## Dónde está

- Reglas: `src/lib/credit-prices.ts`, `src/lib/phone-refunds.ts`.
- Servidor: `src/lib/server/credit-prices.ts`, `src/lib/server/phone-refunds.ts`, `src/lib/server/apollo-credit-allocation.ts`.
- Rutas: `GET /api/credits/prices`, `GET|POST /api/dashboard/admin/phone-refunds`.
- Pantalla: `src/context/CreditPricesContext.tsx`, `src/components/admin/PhoneRefundsCard.tsx`.
- Base: `supabase/migrations/20261120120000_credit_prices_and_phone_refunds.sql`.

## Pendiente conocido

Una búsqueda de correo y teléfono que termina bien se cuenta completa aunque el proveedor no haya encontrado el teléfono: la
tabla `apollo_enrichment_callbacks` no guarda qué dato llegó.
