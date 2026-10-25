# Ficha de la empresa (APP-06)

Decisión aprobada por el usuario (25 oct 2026): **una sola ficha de la empresa**, editada por los dueños y administradores, con fecha de revisión. La prospección, Cowork y Oportunidades leen de ahí. El perfil personal guarda solo lo de la persona: su nombre y su cargo, y su tono en Firmas y estilo.

## Qué había

Lo que vende la empresa vivía en tres lugares que no se ponían de acuerdo:

| Dónde | Quién lo edita | Quién lo lee |
|---|---|---|
| Perfil → «Tu empresa», «Tu oferta», «Tu cliente ideal» (`profiles.signatures.profile_extended`) | Cada persona | Cowork, borradores, respuestas sugeridas, investigación |
| Oportunidades → oferta confirmada (`opportunity_company_context`) | Administradores de Oportunidades | Búsqueda diaria; Perfil la propone con «Usar la oferta de tu empresa» |
| `antonia_workflow_settings.user_company_profile` | Nadie desde la app | La investigación V2 y Cowork, como respaldo |

Medido en producción (solo lectura, 25 oct):
- Hay 23 organizaciones y 59 integrantes. 11 personas escribieron su oferta en Perfil.
- En la organización más grande (31 integrantes), 8 personas tienen 8 ofertas distintas.
- `user_company_profile` está vacío.
- 2 organizaciones confirmaron su oferta en Oportunidades.

Elegir un texto y borrar los demás perdería lo que esas personas escribieron. Por eso la ficha empieza con sugerencias, no con una copia.

## Cómo queda

- **`organization_company_profile`:** una fila por organización (migración `20261025050000`).
  - Guarda los mismos campos de Perfil para la empresa (`COMPANY_PROFILE_FIELDS` en `src/lib/profile/company-profile.ts`), más `revision`, `reviewed_at` y `reviewed_by`.
  - Cada integrante la lee. Solo el servidor la escribe.
- **Guardar es revisar:** cambian la fecha y quién lo hizo.
  - Pasados 90 días, la ficha pide que la miren de nuevo.
  - Si otra persona la cambió mientras se editaba, el guardado no la pisa (409).
- **Las sugerencias** (solo para dueños y administradores) muestran lo que el equipo ya escribió:
  - la oferta confirmada en Oportunidades;
  - la oferta de cada persona, una vez por texto, sin sus datos de contacto.

## Por partes

1. **A1 (PR 561):** la tabla, las reglas, el servidor y la API (`/api/company-profile`). Sin pantalla.
   - Migración aplicada en producción el 25 oct (registrada como `20261025051404`): RLS activo, solo `select` para `authenticated`, nada para `anon`, sin errores en Postgres.
2. **A2:** la pantalla y los lectores.

## A2: qué ve cada persona

- **Administración → Empresa** (`/dashboard/admin/company`), solo dueños y administradores:
  - «Lo que el equipo ya escribió»: la oferta confirmada en Oportunidades y la de cada persona. «Usar» llena lo vacío y suma los productos que faltan; nunca pisa lo escrito.
  - Los mismos campos de Perfil, nombrados para la empresa.
  - Una sola acción a la vez: «Guardar ficha» con cambios, «Marcar como revisada» cuando pasaron 90 días.
  - Si otra persona la cambió mientras tanto, avisa y ofrece ver su versión (409).
- **Perfil**, cuando la organización tiene ficha:
  - «Tú» sigue igual: nombre y cargo son de la persona.
  - «Tu empresa», «Tu oferta» y «Tu cliente ideal» se leen de la ficha, con quién la revisó y cuándo. Los administradores ven el enlace para editarla.
  - «Lo que vendes»: cada persona marca los productos que ofrece (se guardan en `profile_extended.companyServices`). Sin marcas, la IA escribe con todos. Si los administradores renombran o quitan un producto, esa marca deja de contar.
  - Sin «Complétalo con IA» ni el avance del perfil: lo de la empresa no se completa aquí.
- **Sin ficha**, Perfil y todo lo demás funcionan como antes.

## A2: quién lee la ficha

Todos con la misma regla (`withCompanyProfile` en `src/lib/profile/company-profile.ts`): campo por campo, lo de la ficha reemplaza lo de la persona; un campo vacío en la ficha deja el de la persona; los productos son los que la persona vende.

- `loadSellerProfile`: borradores, respuestas sugeridas, investigación, extensión y seguimientos. Con ficha, no toma prestada la oferta de otra persona.
- Cowork: el contexto de cada conversación, `profile.get` (dice que la empresa viene de la ficha) e `icp.analyze`.
- `profile.update` de Cowork no propone cambios a lo de la empresa cuando hay ficha: lo explica y ofrece cambiar nombre, cargo o firma.
- Contexto de la app (`buildSupliaContext`), probabilidad de cierre (`lead-fit`) y contacto del día (`lead-drops`).
- «Hoy» (no pide escribir la oferta si la ficha la tiene) y «Empresas parecidas».
- En el navegador, `companyProfileService.getSellingProfile()`: el cliente ideal con que parte «Buscar prospectos», los cargos de «Empresas» en el CRM y el objetivo de una campaña nueva.
- Oportunidades: el perfil que lee la búsqueda, el borrador de oferta y la sugerencia de la «Ficha para licitaciones» (con ficha, se lee la ficha en vez del Perfil de cada administrador).
