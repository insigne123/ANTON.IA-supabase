# Leads adjudicados por 30 días (27 de octubre de 2026)

En GrupoExpro (32 personas) y PSOL (7), las búsquedas les muestran a todos las mismas personas, y un lead que ya guardó un compañero podía guardarlo otro. Desde ahora, quien guarda a una persona la tiene adjudicada por 30 días dentro de su organización.

## Cómo funciona

- **Quién la tiene.** La primera persona de la organización que guardó al lead, en Contactos o en «Por escribir», por 30 días desde ese primer guardado.
  - Si lo borra, o deja la organización, deja de estar adjudicado.
  - Pasados los 30 días, cualquiera lo puede guardar, y desde ese momento queda adjudicado a quien lo guarde.
  - Quien ya lo tenía guardado sigue trabajando con él: puede actualizarlo o guardarlo otra vez, aunque ahora esté adjudicado a otra persona. Solo no lo puede guardar quien no lo tenía.
- **Qué ven los demás.** En la búsqueda, «Por escribir», Cowork y la extensión: «Adjudicado a Ana Pérez · le quedan 12 días».
  - En la búsqueda no se puede marcar ni guardar, y su estado dice «Adjudicado».
  - Cowork no lo guarda ni le propone nada, y ofrece otras personas.
- **Cómo se compara.** Una persona es la misma si coincide su correo (sin importar mayúsculas), su id de Apollo o su perfil de LinkedIn (sin importar cómo esté escrita la dirección). Un perfil con tildes se busca en las dos formas en que puede estar guardado («josé» y «jos%c3%a9»).
- **Vale en toda organización**, tenga o no la colaboración activada. No cruza organizaciones: lo que guarda alguien de otra empresa no se ve ni bloquea.

## Dónde se hace cumplir

- **En la base de datos**, en tres migraciones pequeñas:
  - `20261027120000_lead_claims_lookup.sql`: la lectura. Son `lead_claims_v1` (para la app; cada persona lee solo su organización y como sí misma), `lead_claim_lookup_v1` (interna) y un índice de `enriched_leads` por organización.
  - `20261027120050_lead_claims_lookup_faster.sql`: la misma lectura, más rápida. Normaliza una vez los contactos de la organización y los cruza por igualdad. En GrupoExpro, 200 personas pasaron de 1.214 ms a 22 ms; en una prueba local con 8.000 contactos, de 13,8 s a 91 ms. El resultado es el mismo.
  - `20261027120100_lead_claims_enforce.sql`: el bloqueo. Un trigger antes de insertar en `leads` y `enriched_leads` rechaza a la persona adjudicada a otro integrante, con el error `lead_claimed`; el error lleva quién la tiene y cuántos días le quedan.
    - Solo al insertar. Reasignar un contacto no cambia.
    - No rechaza a quien ya tiene guardada a la persona. Esto importa porque Postgres corre el trigger también en un `upsert` que termina actualizando, y así guarda «Por escribir» un enriquecimiento (`enriched-leads-service.ts`). Sin esta excepción, quien tuvo a la persona antes no podría actualizarla una vez que otro la guardó.
    - Con la lectura de las dos primeras migraciones, el trigger costaba unos 15 ms por fila en la organización más grande (medido en producción el 28 de octubre). Una importación de 1.000 personas sumaba unos 15 segundos y pasaba el límite de 8 s por sentencia. La cuarta migración lo corrige.
  - `20261028130000_lead_claims_lookup_indexed.sql` (revisión del 28 de octubre):
    - **Por índices.** Busca cada persona por igualdad en índices de la organización (correo, id del proveedor y LinkedIn), sin leer todos sus contactos. En una prueba local con 8.000 contactos: 200 personas, de 85 ms a 9 ms; una fila, de 76 ms a 2,5 ms; una importación de 2.000 filas, de 162 s a 2,7 s.
    - **Lo que ya tienes no te aparece adjudicado.** Si quien pregunta ya tiene guardada a la persona, no se la muestra «Adjudicado a Ana»: el bloqueo ya le permitía seguir con ella, pero la búsqueda y Cowork se la negaban.
- **En la app**, para que nadie choque con el rechazo:
  - la búsqueda deja fuera a los adjudicados al guardar;
  - la importación de CSV y la de Cowork los dejan fuera y lo dicen en el resumen;
  - «Contacto del día» no ofrece a nadie que el equipo ya tenga en Contactos.
  - Si el rechazo igual llega (otro lo guardó en ese momento), la búsqueda, la importación, Cowork, la extensión, Leads Finder y el enriquecimiento con Apollo muestran el texto del rechazo, no un error genérico.

## Orden de puesta en marcha

1. Migraciones de lectura en producción: no cambian nada de lo que se puede guardar. Se aplicaron el 27 de octubre: permisos, índice, advisors y logs, sin errores.
2. Despliegue de la app: los avisos aparecen. Antes de la migración, la lectura falla en silencio y las pantallas siguen como antes.
3. Migración del bloqueo.

## Rollback

- **Quitar el bloqueo:** `drop trigger enforce_lead_claim on public.leads; drop trigger enforce_lead_claim on public.enriched_leads;`.
- **Quitar los avisos:** basta con revocar `lead_claims_v1` (`revoke execute on function public.lead_claims_v1(uuid, uuid, text[], text[], text[]) from authenticated, service_role;`). La app vuelve sola a mostrar «Guardado por Ana» donde había colaboración.
