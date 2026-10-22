# Oportunidades: Embudo y Lista con búsqueda, fuente, rubro y «Cargar más»

**Fecha:** 20 de octubre de 2026. El rubro se agregó el 22 de octubre (ver «Rubro» más abajo).

## Por qué

- **Sin filtros:** el Embudo no tenía búsqueda ni filtros, que sí estaban en la Lista.
- **Tope fijo:** mostraba solo las 120 recomendadas y las 60 por revisar de más puntaje, sin forma de ver más.
- **Fuentes mezcladas:** no se podía separar LinkedIn, licitaciones o Compra Ágil.
- **Botón confuso:** «Revisar con IA» aparecía aunque no hubiera nada que revisar.

## Qué cambia

1. **Una barra común para el Embudo y la Lista** (`OpportunityFilters.tsx`):
   - **Búsqueda** por nombre, organismo o empresa. Se lee 300 ms después de la última tecla.
   - **Fuente:**
     - «Todas las fuentes»;
     - «Licitaciones» (`tender`);
     - «Compra Ágil» (`compra_agil`);
     - «LinkedIn» (`hiring` y `linkedin_post`);
     - «Recibidas» (`private`, `project`).

   La Lista conserva debajo sus filtros (Recomendadas, Por revisar, Asignadas…). Con una fuente elegida, el grupo de la Lista toma su nombre («Compra Ágil»).
2. **El Embudo cuenta y carga con los filtros:**
   - Los números de cada etapa son exactos con la búsqueda y la fuente elegidas.
   - Cada etapa que nadie trabaja aún («Por revisar», «Recomendadas») carga primero las 60 de más puntaje. **«Cargar 60 más»** trae las siguientes, hasta 600 por etapa. Más allá, la pantalla sugiere buscar o elegir una fuente.
   - Si una etapa queda vacía por los filtros, lo dice y ofrece «Quitar filtros».
3. **Fuera del camino, a un clic:** bajo la ruta aparecen «Perdidas», «Archivadas» y «No recomendadas», con su número. Las no recomendadas se cargan solo al abrirlas, y cada tarjeta dice «Por qué no».
4. **Cada tarjeta dice su fuente:** Licitación, Compra Ágil, Avisos en LinkedIn, Publicación en LinkedIn, Recibida.
5. **«Sugerir próximos pasos»** (antes «Revisar con IA»):
   - **Cuándo aparece:** solo si hay oportunidades en curso (asignadas, en preparación, bloqueadas o presentadas).
   - **Qué hace:** la IA revisa hasta 25 de ellas, con sus tareas, actividad y marcas del informe. Para cada una propone si cambiar de etapa y la próxima acción. Nada cambia sin que la persona lo acepte.
6. **La ruta, más limpia:**
   - un solo trazo;
   - las etapas vacías en gris;
   - el nombre siempre bajo el círculo;
   - «N cierran en menos de 7 días» escrito, en vez de una burbuja roja.
7. **«Empresa del workspace»** ordenada en grupos (ver `docs/oportunidades-resumenes-y-carga.md`).

## Rubro (22 de octubre de 2026)

En la demo del 21 de octubre, GrupoExpro pidió ver las oportunidades por línea de servicio: seguridad y aseo dejan poco margen; reclutamiento, selección y outsourcing son los que más les interesan. Bajo la búsqueda y la fuente, los administradores ven una fila **Rubro** con cuatro botones que se pueden combinar (basta que calce uno): **Seguridad**, **Aseo**, **Outsourcing y externalización** y **Reclutamiento y selección**. El Embudo y la Lista los comparten.

- **Qué calza.** Una oportunidad está en un rubro cuando su título, o la línea de resumen que la IA escribe bajo el nombre, nombra una de las palabras del rubro (`OPPORTUNITY_CATEGORIES`, en `workspace-radar.ts`). Sin mayúsculas ni tildes; una raíz cubre las terminaciones («externaliza» → externalización, externalizar). Un rubro no excluye a otro: «personal de aseo» está en Aseo y también en Outsourcing si habla de suministro de personal.
- **Aseo es el servicio.** Las palabras son frases («servicio de aseo», «servicios de limpieza», «aseo industrial», «personal de aseo»…). Con «aseo» suelto, la mitad de lo que calzaba eran compras de artículos de aseo y también «paseo». Se midió con los títulos de producción, solo de lectura: 108 oportunidades de servicio de aseo, ninguna «paseo» y una sola con insumos («Servicio de Aseo e Insumos…»).
- **Qué no es.** Es una búsqueda por palabras, no una clasificación de la IA: «videovigilancia» cae en Seguridad aunque sea un equipo y no un guardia, y una oportunidad cuyo título y resumen no usan estas palabras no aparece. Las palabras se afinan en un solo lugar.
- **Cómo se filtra.**
  - **Embudo:** el mismo `or` de cada lectura lleva ahora también las palabras del rubro (título y `data->summary->>text`), junto al «sigue abierta» y a la búsqueda. Los números de cada etapa son exactos con el rubro elegido.
  - **Lista:** `opportunity_workspace_list_terms`, una función nueva junto a las anteriores, con las mismas reglas de lectura. Antes de aplicar su migración, la página lee la lista como siempre y la acota con las mismas palabras: es correcto, pero solo cubre la primera página (100).
  - **Parámetro de la ruta:** `category=seguridad,aseo`. Lo desconocido se ignora.
- **Quién lo ve.** Solo los administradores, junto a la fuente; la lista de quien recibe asignaciones es corta.
- **Palabras de búsqueda de GrupoExpro.** Las sugerencias del piloto (`GRUPOEXPRO_TENDER_KEYWORDS`) suman «reclutamiento y selección», «headhunting», «búsqueda de ejecutivos» y «evaluación psicolaboral». Solo valen para un «Qué buscamos» nuevo: el de la cuenta se edita en la página.
- **Migración `20261022150000_opportunity_workspace_list_terms.sql`:** una función nueva (la página funciona igual antes y después), solo `service_role`.
- **Pruebas:** `workspace-radar.test.ts` (palabras, tildes, «paseo», compras de insumos), `workspace-pipeline.test.ts` (un solo `or` por lectura con rubro, con búsqueda y sin nada), `workspace-overview-parallel.test.ts` (función nueva y respaldo si no existe), `opportunity-filters-ui.test.ts` (botones) y `opportunity_workspace.test.sql` (4 pruebas de la función).

## Cómo funciona

### API y lecturas

- **`GET /api/commercial-opportunities/workspace?view=pipeline&source=&query=&found=&recommended=&excluded=`:**
  - `found`, `recommended` y `excluded` dicen cuántas cargar de cada etapa (0 a 600; por defecto 60, 60 y 0).
  - La página guarda esos límites por combinación de búsqueda y fuente. Al cambiarlas, vuelve a la primera página.
  - Solo cuenta la respuesta más reciente: una búsqueda vieja no pisa a la nueva.
- **`readOpportunityPipeline`:**
  - aplica la fuente (`kind in (...)`) y la búsqueda (`title`, `company_name`, `buyer_name`) a cada lectura;
  - usa un solo `or` por lectura (abiertas *y* con las palabras);
  - limpia lo escrito con `searchTerm`, que quita comodines, comas, paréntesis y comillas;
  - las etapas que nadie trabaja se ordenan por puntaje e id.
- **Lista:** con una fuente elegida, lee con `opportunity_workspace_list_kinds`; sin fuente, con `opportunity_workspace_list` como siempre.

### Migración y permisos

- **Migración `20261020120000_opportunity_workspace_list_kinds.sql`:**
  - crea una función nueva junto a la anterior: la página funciona igual antes y después de aplicarla;
  - mismas reglas de lectura (`opportunity_can_read`);
  - además busca en el organismo;
  - solo la ejecuta `service_role`.
- **Resúmenes:** las tarjetas que se cargan después también piden su resumen (`enqueueOpportunitySummaries`, hasta 400 por lectura).

## Pruebas

- **`src/components/commercial-opportunities/pipeline-ui.test.ts`:** fuente en la tarjeta, «Cargar 39 más», tope de 600, «Fuera del embudo» y etapa vacía por filtros.
- **`src/lib/server/commercial-opportunities/workspace-pipeline.test.ts`:**
  - cada lectura conserva la fuente y la búsqueda limpia;
  - cada lectura lleva un solo `or`;
  - rangos según los límites;
  - las no recomendadas solo se cuentan.
- **`workspace-overview-parallel.test.ts`:** con fuente, la Lista usa la función nueva.
- **`workspace-radar.test.ts`:** fuentes con sus tipos y `searchTerm`.
- **`supabase/tests/database/opportunity_workspace.test.sql`:** la función nueva filtra por tipo y respeta las reglas de lectura.
