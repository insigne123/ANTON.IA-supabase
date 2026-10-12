# Búsqueda de Apollo y precarga interna de Microworlds

## Decisión del dueño · 12 oct 2026

Filtros y Empresa siguen empresas → selección → contactos Apollo → Guardar → Por completar → Enriquecer → Por escribir. Microworlds obtiene internamente correo y móvil para las empresas seleccionadas. No se añade elección de proveedor, aviso de precarga ni explicación del mecanismo a la pantalla. Los estados visibles de datos/errores y el recibo de créditos internos siguen siendo reales.

Confirmado: **microworlds/leads-finder**, no code_crafter. Solicitar correo + teléfono, Apollo solo para faltantes. Hasta **100 contactos / US$1,50 por corrida** y **US$20 mensuales por workspace**, contando reservas inciertas, en calendario UTC. Al agotar presupuesto, falta de dominio confirmado, cache vencida o indisponibilidad, Apollo sigue operativo. El límite es de gasto de proveedor, no un cupo adicional cobrado a la persona.

## Búsqueda y trabajo durable

- `/api/leads/search` devuelve únicamente las personas de Apollo. La selección de empresa contiene una firma ligada a actor/tenant/ID/domain; se valida antes de cuota. No se confía en un dominio arbitrario ni en checkpoints del navegador para autorizar trabajo externo.
- La precarga comienza al pedir contactos de empresas seleccionadas, no para las 25 empresas de cada página que quizá nadie seleccione. El dominio y los filtros de personas compatibles se traducen al esquema del actor. Seniority no tiene equivalente directo: no se sustituye por antigüedad/cargo, y la población visible/elegible siempre sigue siendo la de Apollo.
- Cola privada + arranque corto con `after`; el scheduler `microworldsSearchTick` rescata el trabajo independientemente de navegador/Cowork. No modelos ni wakes del agente.
- Hash de criterios por tenant, reutilización 30 días. Traer más/repetir/restaurar no crea otra corrida del mismo resultado. La precarga de hasta 100 no inventa el total de la empresa ni el paging de Microworlds.
- Reserva atómica antes de POST; arranque registrado como `submitting` antes de llamar. Un arranque incierto no vuelve a POSTear: conserva su tope para revisión/recuperación de recibo. Si hay run ID, solo se reintentan lecturas/polls. No se compran planes ni se usa una cuenta alternativa.
- Un trabajo que cruza medianoche de fin de mes traslada su reserva al mes del arranque pagado antes de comenzar, sujeto al mismo límite. Recibos se guardan una vez en el bucket original; cargos sin recibo conservan reserva. Criterios/caps definidos en servidor.
- Publicación cifrada y cercada por lease. Se excluyen compañías ajenas, datos malformados y emails suprimidos. Cache expira físicamente en mantenimiento; el bloqueo de email purga su entrada. Observaciones Apollo están acotadas a usuario/tenant y no contienen correo ni móvil de búsqueda.

## Asociación de personas y límites de ahorro

Una consulta con filtros similares no prueba identidad ni mismo orden. La referencia viene de una observación privada del proveedor, nunca del nombre/URL que el navegador envíe libremente ni de identidad editable del contacto persistido. La fila propia solo identifica qué Apollo ID consultar. Las identidades confirmadas por respuestas Apollo se conservan frente a búsquedas posteriores que vuelvan a ocultar nombre/LinkedIn; se rechazan resultados que contradigan el dominio/ID de empresa seleccionado.

LinkedIn normalizado coincidente + dominio; o nombre completo conocido + dominio + cargo exacto con un único candidato. Homónimos, perfiles en conflicto y nombres con apellido oculto no habilitan reutilización. Cuando Apollo solo ofrece apellido oculto y no LinkedIn, se enriquece con Apollo; **no se promete ahorro de correo en esas primeras asociaciones**. El ahorro real depende de contactos cuya identidad pueda confirmarse y campos efectivamente entregados por Microworlds. Los teléfonos corporativos no se tratan como móviles personales.

La precarga no verifica entregabilidad por sí sola: si el actor no devuelve estado para el email, queda `unknown`. No se etiqueta «verificado» por tener formato o haber sido devuelto.

## Enriquecimiento por campos

| Campos solicitados y cache confirmada | Acción |
|---|---|
| Todos disponibles | Persistir sin consulta Apollo |
| Email disponible, falta móvil solicitado | Conservar email; pedir móvil Apollo y observar su email/status |
| Móvil disponible, falta email solicitado | Conservar móvil; pedir email Apollo |
| Cache ausente/no vinculable | Flujo Apollo normal |

El estado de Apollo solo verifica la misma dirección normalizada. Otro email no verifica ni sobrescribe el de cache. La RPC de resultado inmediato y el wrapper de callbacks llenan huecos, conservando edición concurrente y campos no solicitados. Solo se devuelve la fila canónica tras los triggers de supresión; no el candidato crudo. No se pide el add-on de correo personal de Apollo para obtener correo laboral.

Planes cifrados y targets se congelan con la operación. Se cobra un contacto una sola vez, aunque cache y Apollo participen. Settlement cuenta la **unión de targets** con cache procesada o callback enviado y devuelve reservas de targets no procesados; un target no vale dos créditos. Operaciones puras conservan la implementación previa por wrappers forward-only.

La recuperación de un HTTP perdido termina solo la persistencia local del plan y cancela callbacks no enviados después de 15 minutos; nunca reenvía POST a proveedores. Callbacks que ya se enviaron siguen la reconciliación existente. El navegador mantiene Idempotency-Key para un intento pendiente y no aumenta su contador de nuevo al recibir replay. Recargar resultados canónicos evita reinsertarlos desde una copia obsoleta y perder procedencia o teléfonos.

## Archivos y activación

- `src/lib/server/microworlds/{contracts,search,fulfillment}.ts`.
- Integración: search BFF/company schema/client, enrich-apollo BFF y las dos listas de contactos.
- `supabase/migrations/20261012090000_microworlds_private_search_jobs.sql`: cola, budget, cache, observaciones, privacidad, leases.
- `supabase/migrations/20261012093000_hybrid_enrichment_accounting.sql`: planes/fulfillment y wrappers de callbacks/settlement. `enriched_leads.id` es text; no se asume UUID de columna por la forma habitual de IDs.
- Cron autenticado `/api/cron/microworlds-search` y función Firebase `microworldsSearchTick` cada minuto.
- `MICROWORLDS_HYBRID_ENABLED=false` por defecto. Activar solo después de aplicar/verificar cada migración, desplegar worker y app desde main e inspeccionar la cuenta/bindings/caps. El piloto anterior de code_crafter conserva enriquecimiento de contactos antiguos; con el híbrido activo, availability deja de ofrecer su selector y retira sus ventanas restauradas.

Las escrituras de esquema productivo y el release son una operación separada de integrar el código. No aplicar seeds/suites a producción. Rollback operativo inicial: apagar `MICROWORLDS_HYBRID_ENABLED`; no borrar caches/tablas ni reescribir consumos históricos.

## Evidencia disponible

Unitarias de traducción, identidad, origen autorizado, homónimos, privacidad, gaps, transport/POST fencing, recibos cifrados; handler BFF real con servicios aislados (cache completa sin Apollo, móvil faltante, email discrepante, fallo parcial y replay canónico). SQL nuevo ejecutado en Postgres/WASM aislado; baseline callback es un stub en ese instrumento y su integración real se exige en pgTAP/Supabase CI. pgTAP añadido para callback real, protección de cambios, unión de cobro y replay. Chrome de la página/clientes reales con APIs sintéticas en Filtros/Empresa, 390/1440, claro/oscuro: sin selector, guardado, sin overflow/page errors/axe.

Estas pruebas no constituyen una medición de ahorro con una corrida real de móviles: las pruebas previas de Microworlds pidieron `include_mobile=false`. La activación requiere comprobar en muestra acotada el add-on, cobertura, asociaciones confirmadas y costos reales sin envíos externos.
