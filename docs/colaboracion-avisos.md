# Colaboración: avisos de quién trabaja cada contacto (Plan 5, PR-9b)

## Problema

Con la colaboración encendida, la base ya impide escribirle a un contacto que otro miembro trabaja (`claim_outbound_dispatch_sending_v2`), pero nada lo decía antes de intentarlo:
- en Buscar;
- en Por escribir;
- en Cowork.

## Qué se ve

| Situación | Aviso |
|---|---|
| Otro miembro le escribió y no hay respuesta | «Contactado por Ana · libre desde el 3 nov» (30 días después del último envío) |
| Respondió | «En conversación con Ana» (hasta que Ana cierre la conversación) |
| Otro miembro está preparando un envío | «Ana está preparando un envío» |
| Cerrado como Ganado | «Ganado por Ana: no se vuelve a prospectar» |
| Cerrado como No interesado | «No contactar: el equipo lo cerró como No interesado» |
| Tuyo, libre o sin colaboración | Nada |

## Dónde

- **Por escribir:** bajo el nombre, en la tabla y en las tarjetas del celular.
- **Buscar:** en los resultados y en las ventanas por empresa.
  - Si un resultado no trae correo, se cruza con un contacto que alguien de la organización ya guardó, por id del proveedor o por LinkedIn.
- **Cowork:**
  - `leads.search` y `leads.get` traen `teamLock` en cada contacto que otra persona trabaja;
  - las instrucciones dicen que no se le propongan correos, campañas ni LinkedIn, y que se diga quién lo tiene y desde cuándo queda libre.

## Cómo funciona

- **`src/lib/team-lock.ts` (puro):** el texto del aviso y la fecha en que queda libre.
- **`src/lib/server/team-locks.ts`:** lee con el cliente de la persona (RLS: los miembros ven los contactos, conversaciones e hilos de su organización):
  - si hay colaboración;
  - los hilos por correo;
  - las respuestas de este ciclo;
  - los nombres de los miembros.

  Hasta 200 personas por lectura.
- **`POST /api/team-locks`:** con `{emails, providerIds, linkedinUrls}`.
- **`useTeamLocks`:** lee una vez por conjunto de personas. Si la lectura falla, la pantalla sigue igual.
- **Sin migración:** usa `organization_contact_threads`, `contacted_leads`, `leads` y `organization_members`.

## Pruebas

- **Unitarias:**
  - textos y fechas;
  - lectura con un cliente falso: sin colaboración, por correo, por id del proveedor y LinkedIn, respuestas de otro ciclo;
  - Cowork con `teamLock`.
- **DOM:** `scripts/test-team-lock-ui.mjs`.
