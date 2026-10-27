# Leads adjudicados por 30 días (27 de octubre de 2026)

En GrupoExpro (32 personas) y PSOL (7), las búsquedas les muestran a todos las mismas personas, y un lead que ya guardó un compañero podía guardarlo otro. Desde ahora, quien guarda a una persona la tiene adjudicada por 30 días dentro de su organización.

## Cómo funciona

- **Quién la tiene.** La primera persona de la organización que guardó al lead, en Contactos o en «Por escribir», por 30 días desde ese primer guardado.
  - Si lo borra, o deja la organización, deja de estar adjudicado.
  - Pasados los 30 días, cualquiera lo puede guardar, y desde ese momento queda adjudicado a quien lo guarde.
- **Qué ven los demás.** En la búsqueda, «Por escribir», Cowork y la extensión: «Adjudicado a Ana Pérez · le quedan 12 días».
  - En la búsqueda no se puede marcar ni guardar, y su estado dice «Adjudicado».
  - Cowork no lo guarda ni le propone nada, y ofrece otras personas.
- **Cómo se compara.** Una persona es la misma si coincide su correo (sin importar mayúsculas), su id de Apollo o su perfil de LinkedIn (sin importar cómo esté escrita la dirección).
- **Vale en toda organización**, tenga o no la colaboración activada. No cruza organizaciones: lo que guarda alguien de otra empresa no se ve ni bloquea.

## Dónde se hace cumplir

- **En la base de datos**, en dos migraciones pequeñas:
  - `20261027120000_lead_claims_lookup.sql`: la lectura. Son `lead_claims_v1` (para la app; cada persona lee solo su organización y como sí misma), `lead_claim_lookup_v1` (interna) y un índice de `enriched_leads` por organización.
  - `20261027120100_lead_claims_enforce.sql`: el bloqueo. Un trigger antes de insertar en `leads` y `enriched_leads` rechaza a la persona adjudicada a otro integrante, con el error `lead_claimed`; el error lleva quién la tiene y cuántos días le quedan. Solo al insertar: quien ya la tenía la conserva, y reasignar un contacto no cambia.
- **En la app**, para que nadie choque con el rechazo:
  - la búsqueda deja fuera a los adjudicados al guardar;
  - la importación de CSV y la de Cowork los dejan fuera y lo dicen en el resumen;
  - «Contacto del día» no ofrece a nadie que el equipo ya tenga en Contactos.
  - Si el rechazo igual llega (otro lo guardó en ese momento), la búsqueda, la importación, Cowork, la extensión y Leads Finder muestran el texto del rechazo, no un error genérico.

## Orden de puesta en marcha

1. Migración de lectura en producción: no cambia nada de lo que se puede guardar.
2. Despliegue de la app: los avisos aparecen. Antes de la migración, la lectura falla en silencio y las pantallas siguen como antes.
3. Migración del bloqueo.

## Rollback

- **Quitar el bloqueo:** `drop trigger enforce_lead_claim on public.leads; drop trigger enforce_lead_claim on public.enriched_leads;`.
- **Quitar los avisos:** basta con revocar `lead_claims_v1` (`revoke execute on function public.lead_claims_v1(uuid, uuid, text[], text[], text[]) from authenticated, service_role;`). La app vuelve sola a mostrar «Guardado por Ana» donde había colaboración.
