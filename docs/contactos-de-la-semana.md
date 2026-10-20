# «Contactos de la semana»: cinco contactos listos, dos veces por semana

**Fecha:** 20 de octubre de 2026.

Idea del dueño para que los usuarios vuelvan: a cada persona, cinco contactos nuevos dos veces por semana.

- **Cada contacto trae:**
  - su correo, conseguido con Apify y no con los créditos de Apollo;
  - una breve investigación;
  - un primer correo sugerido.
- **Llegan por correo:**
  - en el cuerpo, una tabla con los contactos y por qué se recomiendan;
  - adjunto, un PDF con la investigación y los borradores;
  - un enlace a «Buscar prospectos», donde se ve la búsqueda que los encontró, con los contactos ya listos.
- **Guardarlos no gasta créditos:** ya vienen con correo, así que solo queda completar lo que falte.

## Cómo funciona

1. **Preparación** (`leadDropsTick`, martes y viernes de 06:00 a 07:40 de Chile, cada 20 minutos, `/api/cron/lead-drops`):
   - **Para quién:** quien recibirá el correo, es decir, quien tiene los avisos encendidos, una dirección y su Gmail u Outlook conectado (o el correo de informes configurado). Una vez por persona, en el workspace de su equipo: el con más personas.
   - **A quién buscar:**
     - el «Cliente ideal» de su «Perfil»;
     - si no lo tiene, el de un compañero (los administradores primero);
     - si nadie lo tiene, los cargos y rubros que más se repiten entre los contactos que guardó el equipo.

     Sin nada de eso, no hay contactos y queda dicho por qué (`status = empty`).
   - **Una búsqueda por cliente ideal:** Leads Finder (Apify, `code_crafter/leads-finder`) busca solo correos validados y trae el doble de lo que el grupo necesita.
   - **Reparto:** cinco por persona, distintos entre compañeros, uno por empresa y, mientras alcancen, empresas que nadie más del equipo recibió.
     - Primero quienes tienen teléfono y un cargo más cercano.
     - Nunca alguien que el equipo ya tiene en «Por escribir» o «Conversaciones», ni quien llegó en otro lote de los últimos 180 días.
   - **Dónde queda cada contacto:**
     - el correo y el teléfono, cifrados en `lead_search_vault` (30 días);
     - lo visible, en `lead_drops.items`: nombre, cargo, empresa, por qué calza y los datos de la empresa.
2. **Redacción**, en la misma pasada o la siguiente:
   - Haiku resume en una frase qué hace cada empresa, solo con la descripción que trajo la búsqueda.
   - La **Redactora de Cowork**, con sus mismas reglas, sus chequeos y la Revisora, escribe el primer correo para cada persona. Usa la oferta, las pruebas y la firma de «Perfil» (o la oferta del workspace).
   - El lote queda `ready`.
3. **Envío:** los avisos de la mañana (`dailyAlertsTick`, 08:00) llevan el lote listo, así que nunca hay dos correos el mismo día.
   - **Asunto:** «5 contactos nuevos para ti», salvo que haya algo más urgente, como una respuesta o un compromiso.
   - **Cuerpo:** una tabla (nombre, cargo y empresa, por qué) y el botón «Ver y guardar los 5».
   - **Adjunto:** `contactos-de-la-semana-AAAA-MM-DD.pdf`, con la investigación y el primer correo de cada uno.
   - Una vez enviado, el lote pasa a `sent`.
4. **En la app** (`/search/contactos/<id>`, dentro de «Buscar prospectos»):
   - **«Así los buscamos»:** los filtros usados y los pasos de la búsqueda, uno a uno («Buscando…», «Revisando que tengan correo verificado», «Quitando a quienes tu equipo ya tiene», «Escribiendo un primer correo»). Con movimiento reducido o con «Ver ahora», aparecen de inmediato.
   - **Los contactos:** cada uno con su por qué, «Correo verificado», «Teléfono» si lo hay, y «Investigación y primer correo», que se despliega y trae «Copiar».
   - **Guardar:** «Guardar los 5 en «Por escribir»», o de a uno. Usa el correo y el teléfono de la bóveda, **sin créditos ni otra búsqueda**.
     - Quien ya estaba en «Por escribir» con ese correo se enlaza, sin duplicarse.
     - La investigación y el borrador quedan en `enriched_leads.data.leadDrop`.
   - **«Escribirle»:** abre «Redactar» con el borrador puesto.
   - **Teléfono:** si falta, se busca desde «Por escribir» como siempre.
   - **«Hoy»:** muestra «Contactos de la semana» mientras quede alguno por guardar.

## Costos y topes

- **Apify:** Leads Finder cuesta unos US$0,0035 por persona (prueba del 6 oct 2026). Un lote de 5 personas, con el doble de búsqueda, cuesta unos US$0,035.
- **Tope:** `LEAD_DROPS_MONTHLY_USD` limita lo que se gasta en el mes, sumando todos los workspaces (US$3 por defecto). Al llegar al tope, los lotes del día quedan vacíos con el motivo.
- **Plan de Apify:** el de la cuenta es el gratuito, de US$5 al mes, y lo comparten Oportunidades y la búsqueda híbrida. Para todos los usuarios, dos veces por semana, hace falta un plan pagado: es una aprobación pendiente.
- **Modelos:**
  - la Redactora usa el modelo de Cowork (`COWORK_WRITER_MODEL` o `COWORK_MODEL`);
  - el resumen de empresas usa `LEAD_DROPS_RESEARCH_MODEL` (Haiku 5.5 por defecto).
- **Apagar:** `LEAD_DROPS_ENABLED=off` lo detiene.

## Probar con una cuenta de prueba

Una corrida manual, con el mismo secreto del scheduler, prepara el lote solo para quienes se nombran, reciban o no correos: `POST /api/cron/lead-drops` con `{ "userIds": ["…"], "organizationId": "…" }`.

- **`organizationId` fija el workspace:** el lote se hace ahí y solo para sus miembros. Así, una cuenta de prueba que también está en el workspace de un cliente nunca escribe en él.
- **Días:** como la corrida programada, solo martes y viernes.

## Datos

La migración `20261020180000_lead_drops.sql` crea la tabla `lead_drops`, solo para el servidor: RLS activo y sin permisos para `anon` ni `authenticated`.

- **Unicidad:** una fila por persona, workspace y día.
- **Estados:** `pending`, `ready`, `sent`, `empty` y `failed`.
- **Seguimiento:** el gasto (`cost_usd`) y el motivo cuando está vacío, además de cuándo se envió, abrió y guardó.

## Código

| Pieza | Archivo |
| --- | --- |
| Reglas (puro) | `src/lib/lead-drops.ts` |
| Preparación, redacción, guardado y PDF | `src/lib/server/lead-drops.ts` |
| En el aviso de la mañana | `src/lib/daily-alerts.ts`, `src/lib/server/daily-alerts.ts` |
| Adjuntos del correo | `src/lib/server/self-email.ts` |
| Cron | `src/app/api/cron/lead-drops/route.ts`, `functions/index.ts` (`leadDropsTick`) |
| API | `src/app/api/lead-drops/[id]` (leer y guardar), `[id]/pdf` y `latest` |
| Pantalla | `src/app/(app)/search/contactos/[id]/page.tsx`, `src/components/lead-drops/LeadDropFlow.tsx` |
| «Hoy» | `src/components/home/LeadDropBanner.tsx` |
