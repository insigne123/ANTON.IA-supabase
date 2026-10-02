# Prueba de aceptación: la prueba del 1 oct, repetida (Plan 6, PR-Z)

## Qué es

`scripts/test-pruebas-de-app.mjs` repite de punta a punta la prueba del usuario del 1 oct (`Pruebas_de_app.docx`) con la oferta AXIS (datos de prueba):
1. buscar personas de RR. HH. para ofrecer AXIS;
2. guardar a 2, buscar su correo e investigarlas;
3. el aviso cuando terminan las investigaciones;
4. leer sus informes;
5. escribir el primer correo de cada una;
6. armar la campaña.

Corre dentro de la suite unitaria (`__tests__/pruebas-de-app.test.mjs`), así que CI la ejecuta en cada PR.

## Cómo está hecha

- **Corren los módulos reales de Cowork:**
  - «Preparar contactos» (`prepare-batch.ts` y `prepare-batch-run.ts`);
  - guardar (`save-contact.ts`) y buscar el correo (`enrich-contact.ts` con `lead-identity.ts`);
  - encolar la investigación (`start-research.ts`);
  - el aviso (`research-notice.ts`) y la lectura de informes (`research-read.ts`);
  - los contactos (`lead-tools.ts`) y la memoria de la conversación (`thread-memory.ts`);
  - el perfil y la oferta en juego (`seller-profile.ts`) y el contexto y el redactor del correo (`draft-context-v2.ts` y `generate-outreach-from-report.ts`);
  - la campaña (`campaign-ops.ts`, `bulk-campaign-audience.ts` y `bulk-campaigns.ts`).
- **Todos leen y escriben las mismas tablas, en memoria,** con las mismas consultas que hacen a Supabase.
- **Solo son reemplazos:**
  - el proveedor de correos: la búsqueda oculta el apellido y la búsqueda del correo devuelve la identidad completa;
  - la cola de investigación;
  - el modelo, que guarda lo que se le pidió;
  - los permisos de acceso.
- **Nada real:** sin proveedor, secretos, archivos `.env`, base de datos ni envíos.

## Qué comprueba

| Punto del documento | Qué comprueba la prueba |
|---|---|
| 3, 6 y 7 | Una sola tarjeta para las 2 personas con los 3 pasos (guardar, buscar el correo e investigar). Pedirlo de nuevo no propone ni cobra nada. |
| 8 y 9 | El resultado y los contactos guardados tienen el nombre real («Valentina Fuentes», no «Valentina Fu***s»), el correo y el LinkedIn. Una búsqueda de correo por persona. |
| 12 | La investigación se pide con el nombre real. |
| 10, 11 y 13 | Un solo aviso para la conversación, con los nombres reales y sus empresas, que pide entregar los informes completos. No se repite. |
| 12 y 13 | Cada informe llega completo, con «Cómo usarlo en el correo y los seguimientos». |
| 14 y 19 | El primer correo de cada persona sale de su investigación y de la oferta de la conversación, AXIS, aunque «Perfil» describa otro producto. Saluda con el nombre de pila: «Hola Valentina,». |
| 19, 20, 21 y 28 | La campaña se arma en una tarjeta, con el primer correo propio de cada persona. Los seguimientos saludan con su nombre de pila. |
| 6 y 15 | Tres aprobaciones en total: preparar, crear la campaña y activarla. Ningún mensaje de límite, y el aviso no gasta los pasos automáticos del turno anterior. |

**Se comprobó que falla cuando algo se rompe:**
- Si la búsqueda del correo no devuelve el nombre real al contacto, la prueba falla.
- Si la oferta de la conversación no llega al redactor, también falla.

## Qué no cubre

- **La búsqueda en el proveedor** (puntos 1 y 2): la prueba parte de su resultado. La cubren `scripts/test-cowork-external-search.mjs` y la medición real con la clave (`scripts/measure-cowork-search.mjs`).
- **El modelo real:**
  - la calidad del texto la mide el juez (`docs/borradores-juez-axis.md`);
  - la del informe, `scripts/review-report-v2.ts`.
- **Las pantallas:** las cubren sus pruebas DOM y de navegador.
- **LinkedIn con la cuenta real** (punto 23): `docs/linkedin-prueba-guiada.md`.
