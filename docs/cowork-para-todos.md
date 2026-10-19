# Cowork para todas las cuentas

**Fecha:** 19 de octubre de 2026. **Decisión del dueño:** Cowork deja de ser un piloto privado.

## Antes y ahora

- **Antes:** solo el dueño y la cuenta QA, con una lista fija en `src/lib/cowork/access.ts` y su permiso (*grant*) en la base.
- **Ahora:** cualquier cuenta con correo confirmado y miembro del workspace activo. El menú, el Centro de ayuda y «Pregúntale a la IA» muestran Cowork a todos.

## Cómo funciona

- **Interruptor de la app:** `COWORK_OPEN_TO_ALL=true` en `apphosting.yaml`, junto a `COWORK_ENABLED`.
  - Con el interruptor, `isCoworkIdentityAllowed` acepta a cualquier usuario con correo confirmado.
  - Sin el interruptor vuelve la lista fija.
- **Permiso por persona:**
  - La primera visita crea el permiso (`ensureCoworkGrant`, en `src/lib/server/cowork/access.ts`).
  - Si el permiso ya existía, no se toca: uno que un administrador apagó sigue apagado.
- **Base de datos:** la migración `20261019100000_cowork_open_to_all.sql` deja `cowork_access_policy.open_to_grants = true`.
  - `cowork_has_access` sigue pidiendo el permiso encendido, el correo confirmado y la membresía en la organización.
- **Programadores:**
  - Antes atendían solo a la lista fija.
  - Ahora toman también a quien inició una conversación en los últimos 30 días (`coworkWorkerUserIds` en `src/lib/server/cowork/worker-users.ts`). Esa lista se lee como máximo una vez por minuto.
  - Cada trabajo vuelve a revisar el permiso y la membresía antes de correr.

Lo demás no cambia:

- el uso diario por persona;
- las aprobaciones antes de enviar, guardar o gastar créditos;
- el modelo y sus costos.

## Orden de despliegue

1. **Migración primero.** Antes de que la app nueva salga, no cambia nada: la app anterior sigue con la lista fija.
2. **App Hosting, con `COWORK_OPEN_TO_ALL`.**
   - Si sale la app sin la migración, falla cerrado: el permiso se crea, pero `cowork_has_access` lo niega mientras `open_to_grants` siga apagado.

## Cómo cerrarlo de nuevo

- Quitar `COWORK_OPEN_TO_ALL` de `apphosting.yaml` y desplegar.
- En la base: `update public.cowork_access_policy set open_to_grants = false where singleton;`.
- Los permisos creados quedan guardados. Para apagar a una persona, su permiso se marca `enabled = false`.

## Pruebas

- `src/lib/cowork/access.test.ts`: lista fija contra interruptor y correo sin confirmar.
- `src/lib/server/cowork/worker-users.test.ts`: personas activas, la lectura una vez por minuto y el respaldo cuando la lectura falla.
- `supabase/tests/database/cowork_access_policy.test.sql` y `cowork_qa_access.test.sql`: la política abierta sigue exigiendo permiso y membresía.
- Auditoría visual: `/cowork` ya no figura como página con lista de acceso, y el miembro de prueba entra (`scripts/visual-audit/routes.mjs`).
