# Pipeline: la IA propone, la persona confirma (Plan 5, PR-10a)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`)

**Solo 39 leads tenían etapa** (34 contactados, 4 interesados, 1 reunión).

**Algunas etapas se escribían solas**, por medio de `syncLeadAutopilotToCrm`, desde:
- el webhook de tracking;
- la sincronización de respuestas;
- la escalada de respuestas;
- SUPL.IA.

Incluso podían retroceder: una apertura después de una reunión dejaba al lead en «Contactado».

**Decisión del usuario:** la IA propone cada cambio de etapa, la persona lo confirma, y hay un botón «Aceptar todas».

## Qué cambia

- **Ningún evento escribe la etapa.** Cada uno deja una sugerencia en `crm_stage_suggestions`, con:
  - el lead;
  - de qué etapa a cuál;
  - el motivo en palabras simples («Pidió una reunión.»);
  - la fuente y la evidencia.

  El resto (nota, próxima acción, estado del piloto) se sigue guardando como antes.
- **Solo se sugieren avances**, más «Perdido» desde cualquier etapa abierta.
  - Un lead cerrado (Ganado o Perdido) nunca se mueve por un evento.
  - Hay una sola sugerencia pendiente por lead, y queda la más avanzada: una apertura no rebaja una sugerencia de reunión.
- **Pipeline:** arriba aparecen «N sugerencias de etapa», cada una con quién, el cambio y el motivo.
  - Se acepta o descarta una por una, o todas con «Aceptar todas» o «Descartar todas».
  - Si el lead ya se movió a mano más allá de la sugerencia, aceptarla no lo hace retroceder: queda «superada».
  - En «Gráfico», cada etapa marca los cambios que esperan confirmación («+2 por confirmar»).
- **SUPL.IA:** su herramienta de etapa dice que el cambio queda como sugerencia hasta que la persona lo acepte.

## Base de datos

Las dos migraciones están aplicadas en producción (2 oct). Cada archivo lleva la versión registrada allá y el mismo SQL, byte a byte.

**`20261002005957_crm_stage_suggestions.sql`:**
- **Tabla:** `crm_stage_suggestions`, con RLS. Los miembros solo leen las de su organización, y nadie con sesión escribe la tabla directo.

**`20261002010133_crm_stage_suggestion_functions.sql`:**
- **`suggest_crm_stage_v1`** (solo `service_role`):
  - resuelve la fila del pipeline (`lead_saved|` o `lead_enriched|`);
  - aplica las reglas de avance;
  - deja o sube la sugerencia pendiente.
- **`decide_crm_stage_suggestions_v1`** (miembros):
  - acepta o descarta hasta 500 a la vez;
  - mueve la etapa solo si sigue siendo un avance;
  - registra quién y cuándo;
  - devuelve cuántas se aceptaron, se descartaron o quedaron superadas.

## Pruebas

- **pgTAP:** `crm_stage_suggestions.test.sql`, con 23 casos.
- **PGlite:** los mismos 23 más los permisos.
- **Unitarias:** `crm-stage-suggestions.test.ts` y `crm-autopilot.test.ts`.
- **DOM:** `scripts/test-stage-suggestions-ui.mjs`.

## Aplicación en producción

- **Primeros intentos:** el MCP de Supabase agotó el tiempo sin aplicar nada. La tabla llevaba `drop policy if exists`, una sentencia destructiva que pide una confirmación que este entorno no muestra.
- **Solución:** en una tabla nueva esa línea sobra. Se quitó y ambas migraciones se aplicaron al primer intento.
- **Verificación en producción:**
  - la tabla tiene RLS y una sola política de lectura para miembros;
  - `authenticated` solo lee y `anon` no tiene permisos;
  - las dos funciones son `security definer`, con `search_path` vacío;
  - `suggest_crm_stage_v1` solo la ejecuta `service_role`;
  - los logs no muestran errores.
