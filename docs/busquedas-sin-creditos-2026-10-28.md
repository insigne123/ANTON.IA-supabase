# Buscar prospectos no gasta créditos (28 de octubre de 2026)

Desde el 28 de octubre, buscar no gasta créditos ni tiene límite diario. Vale para buscar empresas, buscar contactos dentro de las empresas marcadas, Leads Finder y las búsquedas que aprueba Cowork. Los créditos quedan para lo que cuesta:

- buscar el correo o el teléfono de una persona, que es lo que pasa al guardar un lead desde la búsqueda;
- investigar a una persona.

## Por qué

En PSOL, una persona se quedó sin créditos dos días seguidos sin entender por qué. El aviso decía «Alcanzaste el límite diario de búsquedas (50/50)».

- **Cada empresa marcada costaba un crédito.** «Buscar contactos» lanza una búsqueda por empresa, de 5 en 5.
  - El 26 de octubre marcó unas 100 empresas. En 20 segundos pasaron 34 búsquedas y se acabaron sus 50 créditos (sumando las búsquedas de empresas). Las otras 57 se rechazaron.
  - El 27 le quedaban 9 créditos. Marcó 25 empresas: pasaron 8 y se rechazaron 17.
- **Esas búsquedas no le cuestan nada a la empresa.** Buscar contactos dentro de una empresa usa `mixed_people/api_search` de Apollo, que no cobra créditos de Apollo. El código la registra con `organization_search_credits: 0`.
- **El cupo interno frenaba una acción gratuita** y dejaba sin créditos para lo que sí cuesta.

## Qué cambió

- **El cobro se quitó en un solo lugar:** `checkAndConsumeDailyQuota` (`src/lib/server/daily-quota-store.ts`). Con el recurso `search` responde «permitido» sin llamar a `consume_antonia_daily_quota_v1`. Así no cobran:
  - `/api/leads/search`, en todos sus modos;
  - `/api/leads/leads-finder/search`;
  - las búsquedas de Cowork (`external-search.ts`).
- **Lo que no cambia:**
  - El saldo del día se sigue leyendo igual (`getDailyQuotaStatus` con `search` lee el cupo compartido).
  - Buscar correos y teléfonos, investigar y el cupo de contactos se cobran como antes.
- **Lo que sigue protegiendo:**
  - el límite de búsquedas por minuto del proveedor (`APOLLO_BACKEND_LEAD_SEARCH_MAX_REQUESTS`, 20 por minuto);
  - el tope de US$0,50 por búsqueda de Leads Finder, hoy habilitado solo para una cuenta.
- **La pantalla de búsqueda** ya no cuenta búsquedas en el navegador, ni avisa «Validaremos si aún tienes búsquedas disponibles».
- **Cowork:**
  - una búsqueda no se bloquea por falta de créditos;
  - el plan de una tarea cuenta solo sus créditos, no sus búsquedas;
  - las tarjetas y las instrucciones dicen «no gasta créditos»;
  - el aviso del composer dice cuántos créditos quedan para buscar correos e investigar.
- **Ayuda:** el manual lo dice y aclara que el cupo se renueva a medianoche UTC.

## Pendiente

Las investigaciones que se piden sin créditos quedan en cola y se cobran apenas se renueva el día. El 26 y el 27 de octubre, esa persona pidió unas 40 cada día, y se cobraron de madrugada del día siguiente. Por eso empezó el 28 con 10 créditos. Falta decidir si se avisa al pedirlas o si se investigan solo las que caben.
