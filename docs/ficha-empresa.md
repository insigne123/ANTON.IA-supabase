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

1. **A1:** la tabla, las reglas, el servidor y la API (`/api/company-profile`). Sin pantalla: nadie ve algo que todavía no tiene efecto.
2. **A2:**
   - una pestaña «Empresa» en Administración para editarla;
   - en Perfil, la parte de la empresa se lee de la ficha cuando existe, y cada persona elige qué productos vende;
   - Cowork, los borradores, las respuestas sugeridas, la investigación y Oportunidades leen la ficha y, si no hay ficha, lo de siempre.
