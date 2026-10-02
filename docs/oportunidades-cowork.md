# Cowork lee las oportunidades (Plan 8, fase 3, PR-3f)

Cowork puede leer la sección «Oportunidades»: las empresas que están contratando, las licitaciones y Compra Ágil abiertas, y los proyectos del SEIA. Con eso responde «¿Qué oportunidades hay hoy?» y usa cada señal como evidencia al redactar.

## Quién la ve

- **Solo las cuentas que ven la sección:** las de `OPPORTUNITIES_ALLOWED_EMAILS`, con el correo confirmado. Es la misma regla de la página (`docs/oportunidades-pagina.md`).
- **El worker lo comprueba al empezar cada trabajo:** lee el correo del dueño con la clave de servicio (`coworkOpportunitiesAllowed`).
- **Para cualquier otra cuenta, la lectura no existe:**
  - las instrucciones no la nombran;
  - el loop rechaza la decisión, también dentro de `reads.parallel` y `reads.plan`;
  - la lectura vuelve a comprobar el acceso antes de consultar.
- **Solo lectura:** si nadie abrió la página todavía, lo dice en `gaps` y no crea el perfil de búsqueda.

## La lectura `opportunities.list`

**Archivos:**
- `src/lib/server/cowork/opportunities-read.ts`: el acceso y las consultas, con las funciones de `store.ts` que usa la página;
- `src/lib/commercial-opportunities/cowork.ts`: el resumen, sin servidor y con pruebas.

**Entrada:**
- vacía: lo mejor de cada tipo;
- con texto: el nombre de una empresa, un comprador o un proyecto («Falabella» encuentra «Falabella S.A.»), o su dominio.

**Devuelve:**
- **`profile`:** qué se busca. La oferta, los cargos, las regiones, el mínimo de avisos, las palabras de las licitaciones, los sectores del SEIA y la inversión mínima.
- **`counts` por tipo:**
  - en total, nuevas, te interesan, descartadas y vistas en las últimas 24 horas;
  - en licitaciones, además, las que cierran en 7 días.
- **`hiring`, `tenders` y `projects`:** hasta 5 de cada uno, de mayor a menor puntaje.
  - Sin las descartadas, salvo que se pregunte por una.
  - Cada uno trae sus motivos, su estado («te interesa» quiere decir que ya la tomó alguien; `mine` dice si eres tú) y su **`signal`**.
- **`lastSearches`:** la última búsqueda de cada fuente, con fecha, lo leído, lo nuevo y el error si lo hubo.
- **`gaps`:** lo que falta:
  - el perfil de búsqueda;
  - las claves de JSearch o LinkedIn;
  - el ticket de Mercado Público;
  - el archivo del SEIA;
  - una fuente que falló.

### La señal

La señal es un hecho público con su fuente y su fecha, escrito para citarlo tal cual. Cowork no le agrega cifras ni deduce necesidades.

| Tipo | Ejemplo |
|---|---|
| Contratando | «Retail Andes publicó 14 avisos de empleo en los últimos 30 días (6 de operario y 4 de reponedor), el último el 24 sept 2026, según LinkedIn y Laborum.» |
| Licitación | «Municipalidad de Calama publicó la licitación «Suministro de personal de aseo» (1057-88-LE26) en Mercado Público el 22 sept 2026; cierra en 2 días · 27 sept.» |
| Proyecto | «Aguas del Norte S.A. ingresó al SEIA el proyecto «Desaladora Norte» (US$ 320 millones), presentado el 3 mar 2026; estado: En calificación.» |

## La receta «¿Qué oportunidades hay hoy?»

Es una sola lectura: `opportunities.list` con la consulta vacía. La respuesta sigue la regla 8 (siempre explicativa):

1. **La conclusión:** cuántas hay y cuál mirar primero, y por qué.
2. **Qué revisó:** las búsquedas de cada fuente, con su fecha.
3. **Las mejores,** en una tabla: tipo, empresa o comprador, por qué calza y su señal.
4. **Qué propone:**
   - **Empresa contratando, con dominio y que aún no es contacto:** buscar a sus decisores (`prospecting.propose_search` con su dominio y cargos de RR. HH., Operaciones y Gerencia General). La búsqueda lleva aprobación y créditos.
   - **Sin dominio, licitación o proyecto:** «Buscar decisores» y el enlace están en la página.
   - **Marcar «Me interesa» o descartar:** se hace en la página. Cowork lo dice y no lo propone.

## La señal como evidencia

**Al redactar, investigar o explicar** a una empresa que podría estar en Oportunidades, Cowork consulta `opportunities.list` con su nombre. Si aparece, usa su señal citando la fuente y la fecha.

**La Redactora** (`writer.ts`) tiene una regla para esto: si `observations` trae la señal de la empresa del destinatario, puede abrir el correo con ella sin cambiar sus cifras.

**El informe de investigación no cambia en este PR.** El generador de informes (`research-report-*`) no lee Oportunidades.
- La señal entra en lo que Cowork responde y en los correos que redacta.
- Sumarla al informe es un cambio aparte en ese generador.

## Pruebas

**`src/lib/commercial-opportunities/cowork.test.ts`:**
- la búsqueda por nombre (sin la forma legal) o por dominio;
- la señal de cada tipo;
- las 5 mejores sin las descartadas, y los conteos;
- lo que falta;
- solo cuenta la última búsqueda de cada fuente.

**`scripts/cowork-opportunities-corpus.test.ts`,** con un modelo guionado sobre el loop real y el caso `oportunidades-hoy` de `scripts/fixtures/cowork-opportunities-corpus.ts`:
- un buen turno lee, explica y muestra la señal;
- responder sin leer falla;
- recomendar a la empresa descartada falla;
- para una cuenta sin acceso, la lectura se rechaza y las instrucciones no la nombran.

**`scripts/verify-cowork.mjs`** ahora corre este corpus y también el del cliente ideal (`scripts/cowork-icp-corpus.test.ts`), que no estaba.

**Con el modelo real:** el caso entra en `scripts/evaluate-cowork-conversations.ts`, junto a los del cliente ideal.
