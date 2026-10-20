# Investigaciones completas (20 oct 2026)

**Problema (producción, últimos 45 días):**
- Solo 24 de 73 investigaciones quedaron «Completada»: 47 quedaron «Completada con revisión» y 2 con «Información limitada».
- **PSOL usaba el informe v1, que nunca terminó completo:** 29 parciales y 7 fallidos de 36. Un informe fallido deja la investigación como «No se completó» y no deja escribir el correo.
- GrupoExpro usaba el informe v2 (el actual): 25 completos de 30.
- **Cowork y la extensión de LinkedIn leen solo el informe v2.** Para PSOL, Cowork respondía que sus investigaciones «no tienen informe escrito».

**Causas:**
1. **Fuentes opcionales:** cualquier advertencia dejaba la investigación «con revisión», aunque la empresa estuviera bien descrita. Por ejemplo, que no hubiera noticias, avisos de empleo o información pública de la persona. Casos parciales con calidad 80–98 y «investigación suficiente».
2. **Buscador web:** se cortaba a los 6 s y no reintentaba. En los registros de producción, cada «noticias no disponibles» fue un `SERPER_TIMEOUT`.
3. **Búsqueda de la persona demasiado literal:** exigía el nombre completo y la razón social tal cual. Así, «Juan Pérez» de «Constructora Andes» no calzaba con «Juan Andrés Pérez González» de «Constructora Andes SpA».
4. **Informe v1:** un solo párrafo que fallaba un chequeo vaciaba su sección. Con todas las secciones vacías, el informe fallaba.

## Qué cambia

1. **Estado honesto** (`src/lib/server/native-research.ts`):
   - La investigación queda «Completada» cuando la empresa tiene hechos verificados.
   - Lo que faltó (noticias, empleo, menciones, presencia digital, rastro público de la persona) queda como nota en el informe.
   - «Con revisión» queda solo cuando no se pudo describir la empresa.
2. **El buscador reintenta una vez** una búsqueda que se cortó, solo en las investigaciones en segundo plano (`retryTimeouts` en `src/lib/server/serper-search.ts`). El chat no espera de más.
3. **Mejor búsqueda de la persona** (`src/lib/server/native-person-research.ts`):
   - La empresa también se reconoce sin su forma legal (SpA, S.A., Ltda.…).
   - El nombre corto (primer nombre y apellido paterno) se acepta solo con la empresa y además el cargo, o con su propio perfil de LinkedIn.
   - Su propio perfil de LinkedIn (el de la ficha) la identifica aunque muestre un empleador más nuevo.
   - Dos búsquedas más de respaldo, solo cuando las exactas encuentran poco.
4. **Informe v2 para todos** (`reportV2Mode` en `src/lib/server/seller-profile.ts`):
   - Sin configuración, cada workspace usa el informe v2 visible. Un `off` o `shadow` explícito se respeta.
   - Las investigaciones antiguas sin informe reciben el v2 al abrirlas.
   - Las que ya tenían un informe v1 lo conservan.
5. **Siempre hay informe:**
   - Si el v2 falla del todo (por ejemplo, un contacto sin dominio de empresa), se escribe el v1 con la misma evidencia (`queueResearchReportV1Fallback`).
   - El v1 ya no pierde una sección entera por un párrafo malo: descarta ese párrafo y conserva el resto.
6. **Más rápido en lote:** cada minuto se escriben hasta 3 informes v2 a la vez (antes 1). Cada uno espera al modelo uno a dos minutos.

## Costo

- El informe v2 usa 4 llamadas a Luna, con un costo estimado de USD 0,09–0,17 por informe (`docs/report-v2-luna-terra-validation.md`).
- PSOL hizo 36 investigaciones en 45 días: unos USD 4–6 por mes y medio.

## Pruebas

- `native-research-snapshot.test.ts`: las fuentes opcionales no dejan parcial una investigación con la empresa descrita; sin contexto de empresa, sí.
- `serper-search.test.ts`: con `retryTimeouts`, una búsqueda que se corta se intenta una vez más, no en bucle; sin la opción no se reintenta, como antes.
- `native-person-research.test.ts`: marca sin forma legal, nombre corto con cargo, perfil propio de LinkedIn y los casos que no son la persona.
- `research-report-worker.test.ts`: hasta 3 informes v2 a la vez; un v2 fallido encola el v1 y el v1 lo escribe.
- `synthesize-research-report.test.ts`: un párrafo que falla un chequeo sale y el resto de la sección queda.
- `seller-profile.test.ts`: v2 por defecto; `off` y `shadow` explícitos se respetan; un valor desconocido queda en `off`.
