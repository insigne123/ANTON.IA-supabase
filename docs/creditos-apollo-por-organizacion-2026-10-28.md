# Créditos de Apollo por organización (28 oct 2026)

La cuenta de Apollo es una sola para todas las empresas. El 28 de octubre se usaron los 2.500 créditos del plan del ciclo
(que se renueva el 1 de noviembre a las 17:17, hora de Chile) y se compraron 1.000 más para dos empresas: 700 y 300.

## Qué hace

- Cada asignación es una fila de `apollo_credit_allocations`: organización, créditos y ventana (`starts_at`, `ends_at`).
  Solo la escribe el equipo de ANTON.IA (sin acceso de clientes).
- `apollo_credit_allocation_status_v1` cuenta lo usado en la ventana con lo que cobra Apollo: 1 crédito por correo y 8 por
  teléfono (lectura de Apollo: 1.848 créditos por 231 teléfonos). Lo que está en curso ya se descuenta; lo que no encontró nada,
  falló o se canceló no cuenta.
- Mientras la ventana está abierta, los correos y teléfonos que no caben se rechazan **antes** de cobrar créditos de la app o de
  preguntar a Apollo: en Contactos y Leads (`/api/opportunities/enrich-apollo`), y en Cowork (correo, teléfono y lotes). Lo que ya
  está en la caché no cuenta. Las búsquedas siguen disponibles y no se cuentan.
- El panel de administración (`/dashboard/admin`) muestra la tarjeta «Créditos de Apollo». Sin asignación abierta, no aparece.
  - Con `show_limit` (por defecto): «Quedan solo 300 créditos disponibles hasta el 1 de noviembre: ya se usaron 2.300», con la
    barra. Lo usado es `used_before` (lo usado antes en el ciclo, que no limita nada) más lo usado en la ventana.
  - Sin `show_limit`: solo lo usado en el ciclo, sin la parte ni lo que queda. Si se agota, el aviso no dice cuántos había.
- Cowork, al leer el saldo, recibe la parte de la organización (`organizationShare`) con las mismas reglas.

## Cómo asignar

Una fila por organización, con la ventana del ciclo:

```sql
insert into public.apollo_credit_allocations (organization_id, starts_at, ends_at, credits, used_before, show_limit)
values ('<organization uuid>', '<inicio>', '2026-11-01 20:17:52+00', 300, 2300, true);
```

Al cerrar la ventana la asignación deja de aplicar sola: no hay que borrarla.

## Límites

- Las búsquedas de empresas también gastan créditos de Apollo (1 por página) y no se cuentan ni se detienen.
- El conteo sale de los registros de la app; el saldo real de Apollo se sigue leyendo cada hora.
