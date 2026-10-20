# Pipeline → «Empresas»: a quién conoces y a quién te falta conocer

**Fecha:** 19 de octubre de 2026.

**Propuestas 5 y 6** de la comparación con otras apps de prospección: comité de compra por cuenta (Lusha, ZoomInfo, Common Room, Sales Navigator) y empresas parecidas a un cliente (Lusha).

## Por qué

El Pipeline ordenaba personas y no empresas. Una venta B2B rara vez la decide una sola persona. Si la única persona que conoces en la empresa deja de responder, el negocio se detiene. Faltaba ver por empresa a quién conoces y a quién no, y encontrar más empresas como las que ya compraron.

## Qué hace

1. **Tercera vista del Pipeline:** «Panel», «Tablero» y **«Empresas»**. La elección se recuerda.
2. **Lista de empresas:** una fila por empresa, con rubro, número de personas, la etapa más avanzada y tres marcas:
   - **Decide:** alguien de la alta dirección, o un gerente de tu área o de la gerencia general.
   - **Usa:** una jefatura o alguien del equipo de tu área, que trabaja con lo que vendes.
   - **Paga:** alguien de finanzas o compras; en una empresa de menos de 200 personas, también el dueño o el gerente general.

   **Orden:** primero los negocios abiertos (del más avanzado al menos), luego los ganados y después el resto. Arriba se indica en cuántos negocios abiertos falta alguien.
3. **Detalle de una empresa** (panel lateral):
   - **«Para esta venta»:** los tres roles, cubiertos o no. Donde falta alguien, «Buscar» abre «Buscar prospectos» en esa empresa, con su dominio y los cargos ya escritos. La búsqueda no corre sola: la persona la revisa y la lanza, con su costo a la vista.
   - **«Cobertura por área y nivel»:** una tabla de áreas (gerencia general, la tuya, finanzas, compras y las que tengan personas) por nivel (alta dirección, gerencia, jefatura y equipo).
   - **«Personas»:** cada una con su cargo, área, nivel y etapa. Al tocarla se abre su ficha del Pipeline.
4. **«Empresas parecidas»:**
   - **Búsqueda:** usa la búsqueda de empresas de «Buscar prospectos», con su cupo diario y su proveedor. Filtra por el rubro de la empresa, el país (Chile por defecto) y los tramos de tamaño alrededor del suyo.
   - **Filtro:** deja fuera las empresas que ya están en el CRM.
   - **Elección:** la IA (Haiku) elige hasta 8 entre las encontradas y explica en una línea en qué se parecen. Solo puede elegir empresas que la búsqueda devolvió.
   - **Si la IA falla,** se muestran las empresas del mismo rubro y tamaño, y la pantalla lo avisa.
   - **«Ver personas»** abre la búsqueda en esa empresa con los cargos de quien decide y de quien usa.

## Cómo funciona

- **Sin migración.** Todo sale de las filas que el Pipeline ya carga (`loadUnifiedRows`). `UnifiedRow` ahora trae, cuando el contacto fue enriquecido:
  - seniority y departamentos;
  - dominio, tamaño y país de la empresa.

  El dominio de un lead guardado sale de su sitio web.
- **`src/lib/companies/coverage.ts`** (sin efectos):
  - `classifyRole` lee primero el cargo en español o inglés y después las etiquetas de Apollo;
  - `companyKey` une «Retail Sur S.A.» con «RETAIL SUR SA»;
  - `buildCompanies` cuenta una sola vez a cada persona, en la etapa más avanzada que alcanzó;
  - `mainArea` toma tu área de «Cargos que buscas» en «Perfil» y, si está vacío, de los contactos del CRM;
  - `committeeFor` y `coverageGrid` arman los tres roles y la tabla.
- **`src/lib/companies/similar.ts`:** esquema de la consulta (hasta 25 empresas), prompt y validación de la respuesta (solo ids conocidos, sin repetir, con un motivo limpio).
- **`POST /api/crm/companies/similar`:**
  - **Entrada:** la empresa base y las candidatas que el navegador ya obtuvo.
  - **Contexto:** lee la oferta del perfil del vendedor.
  - **Modelo:** `COMPANIES_MODEL`; por defecto `claude-haiku-5-5`, y se permiten `claude-sonnet-5-5` y `gpt-6-luna`.
  - **No guarda nada.**
- **Corrección de paso:** las conversaciones guardan el cargo en `role` y el Pipeline lo leía como `title`, así que esas filas quedaban sin cargo. Ahora lo leen.

## Logos, datos y qué hace cada empresa (20 de octubre de 2026)

- **Logo:** sale del dominio de la empresa, del ícono que publica su propio sitio, servido por el servicio de favicons de Google (`CompanyLogo.tsx`). Va sobre un fondo blanco para verse igual en modo claro y oscuro. Sin dominio, o si el sitio solo tiene el globo por defecto (16 px), muestra las iniciales. Solo sale del navegador el dominio público de la empresa, nunca el nombre de una persona.
- **Dominio:** el que trajo el enriquecimiento. Si no hay, el que más usan sus contactos en el correo (`ana@retailsur.cl` → `retailsur.cl`), nunca uno gratuito como Gmail (`companyDomainOf`).
- **Fila de la lista:** rubro, contactos, empleados, país y dominio en una línea. Un rubro escrito como «—» ya no se muestra. Sin logo, las iniciales saltan «de», «la» o «y» («Ministerio de Obras Públicas» → «MO»).
- **«Para esta venta»:** nombra hasta tres personas por rol y dice cuántas más hay; la lista completa está en «Personas».
- **Qué hace:** al abrir una empresa, `GET /api/crm/companies/about` lee su sitio con el lector de «Perfil» (`fetchCompanyProfileSite`). Ese lector sigue una vez a una marca que se mudó de dominio y lee la página del país y «Quiénes somos», además de la portada; acepta solo dominios públicos, revisa la respuesta del DNS contra rangos privados y se detiene a los 14 s. Haiku escribe una o dos frases de qué hace y a quién le vende, sin comentar lo que el sitio dice o no dice. Si la IA falla, usa la descripción del propio sitio. El primer lector, que solo leía la portada, no describía GrupoExpro: su portada solo pide elegir país. No guarda nada. El navegador recuerda la respuesta por un día, y cada persona puede leer hasta 60 sitios por hora.
- **Cada sección del panel dice qué muestra:**
  - **«Para esta venta»:** las tres personas que suele necesitar una venta.
  - **«Dónde conoces gente»** (antes «Cobertura por área y nivel»): filas de áreas y columnas de niveles; «—» marca donde aún no conoces a nadie.
  - **«Personas»:** tus contactos en la empresa, con su etapa.
- **Arriba del panel:** la etapa, el número de contactos y un enlace al sitio.

## Límites

- El área y el nivel se deducen del cargo. Un cargo ambiguo («Product Owner») queda en «Otras áreas» y nivel «Equipo».
- Sin «Cargos que buscas» ni contactos con área clara no hay rol «Usa». La pantalla pide completar el perfil.
- «Empresas parecidas» necesita el rubro de la empresa, que llega cuando el contacto se guardó desde la búsqueda o se buscaron sus datos.

## Pruebas

- `src/lib/companies/coverage.test.ts`:
  - 17 cargos reales (incluidos «HR Business Partner», «Product Owner» y «Seguridad de la Información»);
  - una persona guardada tres veces cuenta como una;
  - orden de las empresas;
  - comité en una empresa grande y en una pequeña;
  - tabla y tramos de tamaño.
- `src/lib/companies/similar.test.ts`: límites de la consulta, contenido del prompt y respuesta validada.
- **Recorrido local con navegador** sobre la base local: lista, detalle, «Buscar», empresas parecidas, teléfono y modo oscuro.
