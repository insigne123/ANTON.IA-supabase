# Panel de administración: «¿Les está sirviendo?»

**Para quién:** la persona owner o admin de cada organización. Antes el panel abría solo para una organización fija (`ADMIN_DASHBOARD_ORGANIZATION_ID`) y una lista de correos. Ahora cada owner o admin ve el panel de su organización activa.

**Por qué:** en producción, GrupoExpro tenía 28 personas: 15 nunca entraron, 1 tenía el correo conectado y nadie había enviado. Quien decide si la herramienta sirve necesita ver eso, saber a quién ayudar y comprobar que los resultados suben.

## Qué muestra

| Bloque | Contenido | Fuente |
|---|---|---|
| Resultados | Correos enviados, respuestas reales, interesados y reuniones en Pipeline, cada uno contra el período anterior del mismo largo | `contacted_leads` (`sent_at`, `replied_at`, `reply_intent`), `unified_crm_data.stage = 'meeting'` |
| Cómo respondieron | Piden reunión, positivas, neutras, negativas y bajas. Las automáticas y los rebotes se informan aparte y no cuentan como respuesta | `reply_intent` |
| Adopción | Invitadas → entraron alguna vez → activas en 30 días → con correo conectado → primer envío, y el paso donde más se quedan | `organization_members`, identidad de Auth, `provider_tokens`, `profiles`, `antonia_event_ledger` |
| Quién necesita ayuda | Una línea por persona con lo que más la frena, en orden: nunca entró, sin correo, perfil sin oferta, 14 días sin uso y sin primer envío | lo mismo |
| Exportar | CSV de personas (UTF-8 con BOM, abre en Excel con tildes) | lo mismo |

- **Mensajes para copiar:** «Copiar invitación» y «Copiar recordatorio» copian un texto listo para que la persona admin lo mande desde su correo o chat. El panel no envía nada por su cuenta.
- **Filtros:** «Equipo» y «Persona» acotan todo el resumen. La excepción son las reuniones del Pipeline, que no tienen dueño por persona y solo se cuentan para toda la organización.

## Reglas de los números

- Los días son de calendario en hora de Chile (`src/lib/admin/chile-time.ts`), con horario de verano. Un envío a las 23:30 en Santiago cuenta en ese día, no en el siguiente de UTC.
- `contact.sent`, el evento que escribe `/api/contact/send`, cuenta como envío. Antes se perdía.
- Las identidades se leen persona por persona, solo de la organización. Ya no se usa `listUsers`, que recorría toda la plataforma y se cortaba en 1.000 cuentas.

## Créditos

Los límites de créditos los paga la plataforma. Por eso cambiarlos (`PUT` y `DELETE` de `/api/dashboard/admin/credits`) sigue reservado a los correos de `ADMIN_DASHBOARD_ALLOWED_EMAILS`. El resto de owners y admins ve el uso y los límites en modo lectura, con un aviso de a quién pedir más.

## Código

- `src/lib/admin/value.ts` (puro): `buildAdoption`, `needsHelp`, `classifyReplies`, `compareResults`, `biggestDrop`, `helpMessage` y `adoptionCsv`.
- `src/lib/server/admin-value-data.ts`: lecturas, todas con `organization_id` de la sesión.
- `GET /api/dashboard/admin/value?from&to&groupId&userId`.
- `src/components/admin/AdminValueSection.tsx`, arriba de «Resumen».
- Pruebas: `src/lib/admin/value.test.ts`, `src/lib/server/admin-value-data.test.ts` (PostgREST en memoria que aplica los filtros), `admin-dashboard-data.test.ts` y `admin-dashboard-security.test.ts`.

## Pendiente

- **Agregados en SQL:** el resumen de actividad (`admin-dashboard-data.ts`) sigue agregando en memoria con un tope de 20.000 filas por fuente. Pasarlo a SQL (rollups o RPC) es una migración, y se pide aparte.
