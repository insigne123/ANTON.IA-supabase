# «Contacto del día»: un contacto listo, tres días a la semana

**Fecha:** 20 de octubre de 2026.

Es una idea del dueño para que los usuarios vuelvan. Primero eran cinco contactos dos veces por semana; el mismo día lo cambió a **un contacto por día, tres días a la semana**: martes, miércoles y viernes.

- **El contacto trae:**
  - su correo, conseguido con Apify y no con los créditos de Apollo;
  - una breve investigación;
  - un primer correo sugerido.
- **Llega por correo**, en el aviso de la mañana:
  - en el cuerpo, una tabla con el contacto y por qué se recomienda;
  - adjunto, un PDF con la investigación y el borrador;
  - un enlace a «Buscar prospectos», donde se ve la búsqueda que lo encontró, con el contacto ya listo.
- **Guardarlo no gasta créditos:** ya viene con correo.
- **Sin correo, desde «Hoy»:** quien no lo recibe por correo lo abre en «Hoy», y se prepara en ese momento.

**Por qué martes, miércoles y viernes:** son días de aviso. Los avisos van de martes a viernes porque el lunes es del informe semanal, y la regla es un correo por día. Cambiar los días es cambiar `DROP_WEEKDAYS` (`src/lib/lead-drops.ts`) y el horario de `leadDropsTick` (`functions/index.ts`).

## Cómo funciona

1. **Preparación** (`leadDropsTick`, martes, miércoles y viernes de 06:00 a 07:40 de Chile, cada 20 minutos, `/api/cron/lead-drops`):
   - **Para quién:** quien recibirá el correo. Es decir, quien tiene los avisos encendidos, una dirección y su Gmail u Outlook conectado (o el correo de informes configurado). Una vez por persona, en el workspace de su equipo: el que tiene más personas.
   - **A quién buscar:**
     - el «Cliente ideal» de su «Perfil»;
     - si no lo tiene, el de un compañero (los administradores primero);
     - si nadie lo tiene, los cargos y rubros que más se repiten entre los contactos que guardó el equipo.

     Sin nada de eso no hay contacto, y queda dicho por qué (`status = empty`).
   - **Una búsqueda por cliente ideal:** Leads Finder (Apify, `code_crafter/leads-finder`) busca solo correos validados. Trae el doble de lo que el grupo necesita más cinco, con un mínimo de diez.
     - El tope de cada corrida nunca baja del de una búsqueda normal (`LEADS_FINDER_MAX_RUN_USD`, US$0,50). Apify rechaza topes bajo su mínimo (`max-total-charge-usd-below-minimum`), y uno de US$0,03 hizo fallar la primera prueba real (20 oct). Es solo el límite: el costo sale de los resultados que trae.
     - **Rubros:** van con el nombre que usa el actor (`leadsFinderIndustry`: «Seguridad privada» → *security & investigations*, «Logística» → *logistics & supply chain*). Un rubro que no reconoce se omite. En la búsqueda normal pasaría como palabra clave de la empresa, y junto a otro rubro casi nadie calza: así salió vacía la segunda prueba real.
     - **Sin nadie con esos rubros o tamaños,** se busca una vez más solo con cargos y lugares. Si tampoco hay nadie, la pantalla lo dice así («Esta vez no encontramos a nadie») y no como si el equipo ya los tuviera.
   - **Reparto:** un contacto por persona (`DROP_SIZE`), distinto entre compañeros y, mientras alcancen, de una empresa que nadie más del equipo recibió.
     - Primero quienes tienen teléfono y un cargo más cercano.
     - Nunca alguien que el equipo ya tiene en «Por escribir» o «Conversaciones», ni quien llegó otro día de los últimos 180.
   - **Dónde queda:**
     - el correo y el teléfono, cifrados en `lead_search_vault` (30 días);
     - lo visible, en `lead_drops.items`: nombre, cargo, empresa, por qué calza y los datos de la empresa.
     - El cargo va con «de» e «y» en minúscula («Jefe de Reclutamiento y Selección»), y el rubro en español, como lo dice «Empresas» del CRM (`industryLabel`): «logistics & supply chain» es «Logística».
2. **Redacción**, en la misma pasada o la siguiente:
   - Haiku resume en una frase qué hace la empresa, solo con la descripción que trajo la búsqueda.
   - La **Redactora de Cowork**, con sus mismas reglas, sus chequeos y la Revisora, escribe el primer correo. Usa la oferta, las pruebas y la firma de «Perfil» (o la oferta del workspace).
   - El contacto queda `ready`.
3. **Envío:** el aviso de la mañana (`dailyAlertsTick`, 08:00) lo lleva, así que nunca hay dos correos el mismo día.
   - **Asunto:** «Tu contacto de hoy: Gerente de Personas en Ripley», salvo que haya algo más urgente, como una respuesta o un compromiso.
   - **Cuerpo:** una tabla (nombre, cargo y empresa, por qué) y el botón «Ver y guardar».
   - **Adjunto:** `contacto-del-dia-AAAA-MM-DD.pdf`, con la investigación y el primer correo.
   - Una vez enviado, pasa a `sent`.
4. **En la app** (`/search/contactos/<id>`, dentro de «Buscar prospectos»):
   - **«Así lo buscamos»:** los filtros usados y los pasos de la búsqueda, uno a uno: «Buscando…», «Revisando que tengan correo verificado», «Quitando a quienes tu equipo ya tiene» y «Escribiendo un primer correo». Con movimiento reducido o con «Ver ahora», aparecen de inmediato.
   - **El contacto:** su nombre como título, cargo y empresa, por qué calza, «Correo verificado» y «Teléfono» si lo hay. La investigación y el primer correo, con «Copiar», están a la vista.
   - **Una acción a la vez:**
     - «Guardar en «Por escribir»» usa el correo y el teléfono de la bóveda, **sin créditos ni otra búsqueda**. Si ya estaba en «Por escribir» con ese correo, se enlaza sin duplicarse. La investigación y el borrador quedan en `enriched_leads.data.leadDrop`.
     - Después, «Investigar y escribirle» abre «Por escribir» con su investigación completa ya en marcha (`?investigar=<id>&empezar=1`). Toma uno o dos minutos; luego «Preparar correos» deja el correo listo para revisarlo y enviarlo desde ANTON.IA.
     - **Por qué no se envía el correo sugerido tal cual:** en ANTON.IA todo lo que se envía sale de una investigación completa, con sus chequeos y revisión. El sugerido sirve para decidir y se puede copiar con «Copiar»; «Redactar» sin investigación solo ofrece investigar.
     - «Investigar a este contacto», en «Redactar», también la deja en marcha. Si el contacto ya tiene una investigación, o una en curso, se abre para leerla y no se repite.
   - **Teléfono:** si falta, se busca desde «Por escribir» como siempre.
   - **«Hoy»:** la tarjeta «Contacto del día» muestra su nombre, su empresa y por qué calza, con «Ver y guardar», hasta que se guarda. Un día de contacto, el nuevo va antes que el que quedó sin guardar (`homeDrop`). Si no hay contacto por guardar, ver la sección siguiente.

   Si algún día `DROP_SIZE` sube, la misma pantalla los muestra como lista, con «Guardar los N».

## Desde «Hoy», sin correo

La preparación de la mañana es solo para quien recibirá el correo. Los demás, que hoy son la mayoría porque no tienen su Gmail u Outlook conectado, abren su contacto en «Hoy». Lo mismo vale para quien sí lo recibe por correo y entra antes.

- **Qué ofrece «Hoy»** (`pullStatus`, en `GET /api/lead-drops/latest` como `pull`) cuando no hay contacto por guardar:

  | `pull` | Cuándo | Botón |
  | --- | --- | --- |
  | `first` | Nunca recibió uno, o el último vino vacío por falta de cliente ideal. Cualquier día. | «Ver mi primer contacto» |
  | `today` | Martes, miércoles y viernes, si hoy aún no tiene. | «Ver mi contacto de hoy» |
  | `preparing` | El de hoy se está preparando. | «Ver cómo va» |
  | `profile` | No hay cliente ideal propio, del equipo ni inferido de lo guardado. | «Completar mi cliente ideal», a «Perfil» |

  No ofrece nada cuando el de hoy ya está, cuando el presupuesto del mes no alcanza para una búsqueda o con `LEAD_DROPS_ENABLED=off`.
- **Al abrir** `/search/contactos/nuevo`, la pantalla llama a `POST /api/lead-drops/now` (`pullDrop`). En la misma petición, de uno o dos minutos, se hace una búsqueda solo para esa persona (diez resultados, unos US$0,02 a US$0,035), con el mismo reparto, y luego la redacción.
  - Mientras tanto se ven «Así lo buscamos» y los pasos. Avanzan al ritmo del trabajo, sin marcar el último como listo.
  - Al terminar, la dirección pasa a `/search/contactos/<id>` y aparece el contacto.
- **Sin cliente ideal** no se busca ni se guarda nada, y la pantalla lleva a «Perfil». Apenas lo hay, el contacto se hace. Eso vale aunque la corrida de la mañana haya dejado uno vacío ese mismo día por ese motivo: se reemplaza, porque no costó nada.
- **Una sola búsqueda:** antes de buscar se reserva la fila del día (`pending`, sin contactos). Una segunda petición, desde otra pestaña o al volver desde «Hoy», responde `pending` y la pantalla espera.
- **Si la petición se corta,** «Hoy» muestra «Ver cómo va». Pasados 4 minutos sin avance, la siguiente petición retoma:
  - busca de nuevo si se cortó la búsqueda;
  - solo escribe el correo si ya tenía el contacto.

  La corrida de la mañana no toca las filas reservadas sin contactos.
- **Vacío por otros motivos** (sin presupuesto, búsqueda fallida o ningún contacto nuevo): la pantalla lo dice en simple, con el día del próximo contacto, y ofrece «Buscar con mis filtros». Si no hubo contactos nuevos, ofrece además ampliar el cliente ideal.
- **Costo:** desde «Hoy» la búsqueda es por persona y no por equipo, así que cuesta más por contacto que la corrida de la mañana. Cuenta para el mismo tope mensual.

## Costos y topes

- **Apify:** Leads Finder cuesta entre US$0,002 (`LEADS_FINDER_USD_PER_LEAD`, por defecto) y US$0,0035 por persona (prueba del 6 oct 2026).
  - Una búsqueda para una persona trae diez resultados, de US$0,02 a US$0,035.
  - En la corrida de la mañana, un equipo de 30 con el mismo cliente ideal comparte una búsqueda de 65, de US$0,13 a US$0,23.
- **Al mes**, con 13 días de contacto: unos US$0,26 a US$0,46 por persona que lo abre desde «Hoy».
- **Tope:** `LEAD_DROPS_MONTHLY_USD` limita lo que se gasta en el mes, sumando todos los workspaces (US$3 por defecto). Al llegar al tope, los contactos del día quedan vacíos con el motivo, y «Hoy» deja de ofrecerlos.
- **Plan de Apify:** el de la cuenta es el gratuito, de US$5 al mes, y lo comparten Oportunidades y la búsqueda híbrida. Para todos los usuarios hace falta subir el tope y, probablemente, un plan pagado: es una aprobación pendiente.
- **Modelos:**
  - la Redactora usa el modelo de Cowork (`COWORK_WRITER_MODEL` o `COWORK_MODEL`);
  - el resumen de la empresa usa `LEAD_DROPS_RESEARCH_MODEL` (Haiku 5.5 por defecto).
- **Apagar:** `LEAD_DROPS_ENABLED=off` lo detiene.

## Probar con una cuenta de prueba

Lo más simple es entrar con la cuenta de prueba en su propio workspace, con el cliente ideal completo, y pulsar «Ver mi primer contacto» en «Hoy». No hace falta ningún secreto, y el contacto queda en ese workspace.

También hay una corrida manual, con el mismo secreto del scheduler. Prepara el contacto solo para quienes se nombran, reciban o no correos: `POST /api/cron/lead-drops` con `{ "userIds": ["…"], "organizationId": "…" }`.

- **`organizationId` fija el workspace:** el contacto se hace ahí y solo para sus miembros. Así, una cuenta de prueba que también está en el workspace de un cliente nunca escribe en él.
- **Días:** como la corrida programada, solo martes, miércoles y viernes.

## Datos

La migración `20261020180000_lead_drops.sql` crea la tabla `lead_drops`, solo para el servidor: RLS activo y sin permisos para `anon` ni `authenticated`.

- **Unicidad:** una fila por persona, workspace y día.
- **Estados:** `pending`, `ready`, `sent`, `empty` y `failed`.
- **Seguimiento:** el gasto (`cost_usd`) y el motivo cuando está vacío, además de cuándo se envió, abrió y guardó.

## Código

| Pieza | Archivo |
| --- | --- |
| Reglas (puro): días, tamaño, reparto, correo | `src/lib/lead-drops.ts` |
| Preparación, redacción, guardado y PDF; desde «Hoy» (`pullStatus`, `pullDrop`, `homeDrop`) | `src/lib/server/lead-drops.ts` |
| En el aviso de la mañana | `src/lib/daily-alerts.ts`, `src/lib/server/daily-alerts.ts` |
| Adjuntos del correo | `src/lib/server/self-email.ts` |
| Cron | `src/app/api/cron/lead-drops/route.ts`, `functions/index.ts` (`leadDropsTick`) |
| API | `src/app/api/lead-drops/[id]` (leer y guardar), `[id]/pdf`, `latest` y `now` (hacer el de hoy) |
| Pantalla | `src/app/(app)/search/contactos/[id]/page.tsx`, `src/components/lead-drops/LeadDropFlow.tsx` |
| «Hoy» | `src/components/home/LeadDropBanner.tsx` |
