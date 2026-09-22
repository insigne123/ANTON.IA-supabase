# Definición de audiencia: implementación y verificación

Fecha: 21 septiembre 2026. Estado: implementación local conectada al agente; pendiente despliegue y aceptación autenticada integral. No afirmar que la sección está completamente cerrada.

| Función | Implementación | Evidencia / límite |
|---|---|---|
| 1.1 Empresas | Propuesta target companies, país/empleados/dominios, sector como keywords; cola existente y normalización con identidad apollo-company | Modelo propuso filtros correctos; Apollo devolvió 2 empresas con dominio. País y empleados ausentes en respuesta, por lo que no se certifica encaje individual. Taxonomía de industrias no implementada: keywords declaradas. |
| 1.2 Personas | Cargos bilingües propuestos por modelo, seniority, ubicación personal separada de empresa | Modelo generó 5 cargos ES/EN y manager sin ubicación de matriz. Apollo devolvió dos personas con títulos pertinentes; país no disponible en respuesta. |
| 1.3 Frescura | audience.analyze compara empresas normalizadas en leads con envíos en contacted_leads; paginación 500, tope 5000 por tabla | Test de duplicados, substring, cobertura parcial y fallos. Porcentaje null ante truncamiento. No equivale a mercado completo, alias conciliados ni actividad externa; lectura sin snapshot. |
| 1.4 Rol | Clasificación determinista por términos completos, aplicada a resultados externos y hasta 100 guardados | Posible decisor/referidor/desconocido; no descarta automáticamente sin criterios de producto. Falta decisión contextual de descarte y verificación de autoridad real. |
| 1.5 Usuario/comprador | Candidatos a usuario, comprador, ambos o desconocido | Modelo distinguió reclutadora y gerente de operaciones sin afirmar autoridad. Heurística de cargo, no evidencia de poder de compra. |

## Ejecuciones

- `npm run typecheck`: aprobado.
- `node scripts/verify-cowork.mjs`: 134 pruebas más scripts de integración aislada aprobados.
- `scripts/evaluate-cowork-audience.ts --live`: primer intento falló por filtros opcionales null. Se corrigió schema a nullish; segundo intento completó 3 escenarios con 4 llamadas, respuestas en `cowork-audience-model-v2-results.json`. Primer fallo conservado en `cowork-audience-model-results.json`.
- Total adicional modelo: 5 llamadas; acumulado anterior 53 → **58**. Primer fallo sin telemetría, costo monetario desconocido.
- `scripts/check-cowork-audience-provider.ts --live`: 2 consultas reales directas, sin revelado ni escritura; máximo 2 resultados por consulta. Resultado en `cowork-audience-provider-results.json`. El adaptador reporta `organization_search_credits:1` en búsqueda de empresas: no es medición independiente de facturación del proveedor.
- No se ejecutó envío, enriquecimiento ni migración. Se preserva el ZIP modificado preexistente.

## Cierre pendiente

### Avance de cierre (22 septiembre UTC)

- Cola de empresas verificada con servicios aislados: aprobación → cuota → proveedor → resultado `external_company_search` → continuación. Segundo tick no repite ejecución.
- Presentación y exportación integradas: collector valida observaciones de empresas; CSV/Excel comparten columnas de dominio/dotación/web. UI muestra empresas y no ofrece guardar/investigar como persona. `test-cowork-company-results.mjs` y workspace DOM aprobados; no son auditoría visual renderizada.
- `rolePolicy` opcional revisable por búsqueda: criterios de comprador/usuario/referidor/exclusión, límites de palabra y conflictos explícitos. Descarte contextual no elimina registros y jamás amplía permisos. Pruebas de conflicto, desconocido y exclusión aprobadas.
- Lectura real de la organización, sin escrituras: cobertura de leads e historial completa dentro de límites; 14 sectores, suma de 58 empresas por sector (no total global deduplicado), una fila sin empresa. Detalle limitado a 100 contactos y declarado truncado. `cowork-audience-data-results.json` conserva solo agregados. No se certifica snapshot transaccional ni actividad externa no sincronizada.
- Build de producción y typecheck aprobados. Warning preexistente de img en ArtifactPreview. Build carga entorno local como configuración normal de Next; suites y diagnósticos no cargaron ese archivo.

Pendientes restantes: auditoría visual renderizada y despliegue/recorrido de sesión propietaria. Los cambios permanecen locales; no certificar fase desplegada ni aceptación autenticada. La búsqueda usa palabras clave sectoriales (no una taxonomía oficial validada) y proveedor omite campos de país/dotación en la muestra observada.

Verificar normalización de resultados de empresas en el recorrido completo de cola/continuación y presentación/exportación; probar clasificación contextual/descarte sin convertir títulos en autoridad; comprobar frescura en datos reales con cobertura; auditar UI en claro/oscuro y móvil; compilar/desplegar y probar sesión propietaria. Las búsquedas reales demostraron conectividad y respuesta, no precisión de todo el universo del proveedor.
