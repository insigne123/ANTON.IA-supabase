# Oportunidades · la búsqueda sale del Perfil (Plan 15, 3)

## Qué cambia

**Lo que vendes sale del Perfil:**
- La página lo muestra con «De tu Perfil · editar», y ya no se escribe dos veces.
- Si el Perfil está vacío, la página pide completarlo.
- Cuando una persona busca o guarda, la oferta del perfil de búsqueda se actualiza con la de su Perfil. La búsqueda diaria usa el Perfil de quien la creó.

**Las palabras para licitaciones y los sectores del SEIA se generan solos** (`search-ai.ts`, con el modelo barato):
- Se generan cuando el perfil de búsqueda se crea sin palabras, cuando cambia la oferta del Perfil y cuando la persona pulsa «Volver a generar».
- Las palabras que la persona ajustó se mantienen hasta que cambia la oferta.
- Sin el modelo, salen de los servicios del Perfil.

**Los cargos se eligen al buscar.** «Buscar ahora» abre un diálogo con:
- **Cargos libres:** se escribe uno y se pulsa Enter, hasta 15.
- **«También buscamos»:** las otras formas en que las empresas escriben cada cargo, como sinónimos del oficio y el título en inglés («cajero» → «operador de caja», «cashier»). Se puede quitar cualquiera. El femenino y el plural ya se encontraban antes.
- **Dónde:** «Todo Chile» o las regiones que se elijan.
- **Lo que se consulta en cada fuente y su costo,** contra el tope del mes.
- **«Usar estos cargos y regiones en la búsqueda diaria»:** marcado por omisión.

**Las regiones se usan de verdad, no solo para el calce:**
- Cada cargo se busca en cada región elegida («cajero Antofagasta»).
- LinkedIn recibe esas regiones.
- Los avisos de otras regiones no cuentan para una empresa. Un aviso sin lugar conocido sí cuenta.

**Un aviso de una variante cuenta para su cargo:** «Machine Operator» suma en «operario».

**Ajustes de la búsqueda** (antes «Editar búsqueda»):
- Muestra lo que vendes, sin editarlo.
- Tiene los cargos y regiones de la búsqueda diaria, con «Usar las de tu Perfil» para las regiones de «Tu cliente ideal», y el mínimo de avisos.
- Las palabras, los códigos UNSPSC, los sectores y la inversión mínima quedan plegados en «Licitaciones y proyectos · Automático desde tu Perfil».

## Límites y costo

- **Google for Jobs:** hasta 20 consultas en una búsqueda a mano (US$0,05 como máximo) y 10 en la diaria. Primero van los cargos y después sus variantes. El diálogo dice cuántas no caben.
- **LinkedIn:** hasta 30 títulos en una sola corrida. Su costo no cambia, porque Apify cobra por aviso.
- **Variantes:** una llamada por diálogo (o por búsqueda diaria), con `gpt-6-luna`, de unos 20 s como máximo. Si el modelo falla, se busca solo con los cargos.

## Archivos

- `src/lib/commercial-opportunities/search-terms.ts`: puro. Cargos, variantes, consultas por región, títulos y lugares de LinkedIn, y regiones desde el Perfil.
- `src/lib/server/commercial-opportunities/search-ai.ts`: las variantes y las palabras.
- `store.ts`:
  - `readPerfilForOpportunities`;
  - `refreshHiringProfileFromPerfil`;
  - `saveSearchChoice`;
  - la sugerencia toma las regiones del Perfil.
- **Rutas:**
  - nueva `/api/commercial-opportunities/plan`, que da las variantes y el plan antes de buscar;
  - `runs` acepta cargos, regiones, variantes y `save`;
  - `profile` toma la oferta del Perfil y acepta `regenerate`;
  - el cron sigue al Perfil y usa variantes.
- `HiringSearchDialog.tsx` y el panel de ajustes en `OpportunitiesWorkspace.tsx`.
