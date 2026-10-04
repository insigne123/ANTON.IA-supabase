# Investigación de extensión y Oportunidades · correcciones del 3 de octubre

Base: `main` en `6427d23a`. Rama: `feat/extension-opportunities-recovery`.

## Defectos reproducidos

- El panel pasaba el bloque completo a un aplanador genérico: exponía `type`, `claimIds`, `payload` y referencias sin resolver. El PDF resolvía parte de esas referencias con una lógica diferente.
- Fantastic Jobs cambió los IDs a enteros. Nuestro normalizador aceptaba solo texto y descartaba los avisos actuales, aunque la corrida devolviera filas.
- La petición del actor usaba `descriptionType: ''`, fuera del enum publicado (`text`, `html`). Ahora se usa `text`; la descripción y el reclutador no se persisten y `recruiterOnly` queda explícitamente desactivado.
- JSearch se consultaba en ráfagas de tres y todo HTTP 429 se describía como cuota mensual agotada. Las consultas se espacian; solo se anuncia cuota mensual si el mensaje del proveedor la identifica, sin mostrar su texto crudo ni credenciales.
- Los sync devolvían `done` cuando todas las fuentes fallaban. La UI anunciaba cero coincidencias y sugería bajar filtros. Ahora distingue fallo, resultado parcial y vacío real, muestra errores por fuente y conserva datos útiles.
- Una respuesta Apify rechazada antes del inicio reservaba US$1 igual que un timeout ambiguo. Los rechazos 400/401/402/403/404 quedan a cero; el tope reservado se conserva para resultados inciertos.

Referencia del proveedor consultada sin iniciar una corrida:
`https://api.apify.com/v2/acts/fantastic-jobs~advanced-linkedin-job-search-api/builds/default`.
Su esquema incluye el enum de descripción; su changelog y documentación de salida describen los IDs enteros y los campos `org_linkedin_website` / `org_linkedin_slug`.

## Presentación

Se reutilizan la jerarquía del informe validado, los bloques y los estados del workspace existente: contenido comercial, hipótesis y estimaciones identificadas, fuentes enlazadas, errores persistentes y CTA de recuperación. Panel/PDF comparten `presentReportBlock`. Se mantienen los componentes y tokens light/dark existentes; no hay rediseño de layout ni nuevos colores.

Extensión preparada: **4.1.1**, mismos permisos y hosts que 4.1.0.

## Validación local

- Typecheck sin cache incremental y build Next.js aprobados con placeholders de CI, sin archivos `.env*` de producción.
- Unitarias: **2361 aprobadas**, 417 archivos, runner seguro por cinco lotes en Windows. Tras corregir la compatibilidad de valores cero/false, se repitieron los lotes 4–5; los lotes 1–3 ya aprobados no cambian.
- `npm run extension:test`: **100 aprobadas**.
- `scripts/test-linkedin-extension-browser.mjs`: Chrome con frontera simulada, claro/oscuro y 320/380/520 px, informe con evidencia resuelta y enlaces, descarga manual de PDF y teclado, sin overflow.
- `scripts/test-opportunities-recovery-browser.mjs`: workspace real con API simulada, fallo de ambas fuentes, toast de fallo al reintentar, fallo de licitaciones, primera búsqueda, vacío real y búsqueda parcial; claro/oscuro y 390/768/1440 px sin overflow. Contraste calculado de los errores por fuente superior o igual a 4,5:1 en ambos temas.
- ZIP 4.1.1: 12 archivos, **1.965.817 bytes**, SHA-256 `c648d47ed18e9163b4e9602a66bfda61920fb1066a6988ac711e415580bcacdb`.

## Pendiente de producción

La sesión Firebase devolvió HTTP 401 y su renovación falló con «Your credentials are no longer valid». Renovar mediante `npx --yes firebase-tools@14 login --reauth`.

Esto impide leer los runs/logs concretos y desplegar. Las causas anteriores están reproducidas con código y contratos del proveedor; no se presentan como diagnóstico confirmado de las dos capturas sin contrastar los trabajos guardados.

Después de renovar: consultar los últimos runs de investigación y `commercial_opportunity_runs` de la cuenta afectada, comprobar respuestas originales/recibos y el estado de las fuentes, integrar con CI/revisión, desplegar desde `main`, verificar el ZIP servido y ejecutar los smokes. No se iniciaron corridas pagadas ni se hicieron reparaciones de ledger en producción para esta validación.

Para verificar en la app tras publicar: actualizar la extensión y recargar LinkedIn; abrir una investigación ya guardada y su PDF (sin investigar de nuevo); revisar fuentes y límites. En Oportunidades, comprobar el último intento real y confirmar que un fallo no se etiqueta como ausencia de coincidencias. Una nueva corrida pagada debe mostrar su costo y quedar dentro del presupuesto aprobado.
