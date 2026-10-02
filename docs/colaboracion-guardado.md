# «Guardado por Ana» (Plan 6, PR-E)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 10)

El contacto debía quedar asociado a quien lo obtiene. Hasta ahora el equipo veía algo solo desde el primer envío: «Contactado por Ana», con bloqueo (#99 y #100). Si Ana guardaba a una persona sin escribirle todavía, Beto no lo sabía, y podía guardarla y escribirle primero.

**Decisión del usuario (2 oct):** avisar al guardar, sin bloquear. El bloqueo sigue empezando con el primer envío.

## Qué cambia

- **Estado nuevo `saved`** en `src/lib/team-lock.ts`: «Guardado por Ana», con `blocks: false`.
- **`readTeamLocks`** (`src/lib/server/team-locks.ts`) busca quién del equipo guardó primero a cada persona:
  - en los contactos guardados y en «Por escribir»;
  - por correo (sin importar mayúsculas), id del proveedor o LinkedIn.

  Solo aparece donde todavía no hay un hilo: un hilo dice más («Contactado por», «En conversación con»). Si quien guardó primero es la misma persona, no se dice nada.
- **Dónde se ve:**
  - **Buscar y Por escribir:** el mismo `TeamLockBadge`, en tono discreto (`text-muted-foreground`, ícono de marcador), distinto del ámbar de los bloqueos.
  - **Cowork:** `leads.search` y `leads.get` traen `teamLock` y `teamLockBlocks`, y las búsquedas de prospectos marcan a quien ya guardó alguien del equipo. Con `teamLockBlocks` false, Cowork lo dice y pregunta antes de proponer guardarlo o escribirle.
- **Sin migración.** Las lecturas usan el cliente de la persona: los miembros ya leen los contactos de su organización.

## Pruebas

- **`src/lib/team-lock.test.ts`:** el aviso y que no bloquea.
- **`src/lib/server/team-locks.test.ts`:**
  - gana quien guardó primero;
  - el correo se compara sin importar mayúsculas;
  - id del proveedor y LinkedIn;
  - un hilo manda sobre lo guardado;
  - lo propio no avisa.
- **`scripts/test-team-lock-ui.mjs`:** «Guardado por Ana» en tono discreto, y el bloqueo en ámbar.
