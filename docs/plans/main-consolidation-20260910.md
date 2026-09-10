# Consolidación de main — 2026-09-10

## Alcance

Conserva el conjunto pendiente de investigación Report V2, evidencia pública,
cuestionario, borradores/versionado, biblioteca Email Studio, firma, OAuth,
perfil/contraseña, administración, campañas, extensión y búsqueda por empresas.
Se preservan también pruebas, prototipo de SUPL.IA y documentación histórica.
`git fetch origin` confirmó que no había commits entrantes frente a main.

Los registros de publicación de extensión/campañas documentan reemplazos entre
artefactos parciales. La fuente del próximo despliegue debe ser este main completo;
los exportadores parciales se conservan como herramientas históricas, no como
fuente recomendada de una publicación nueva.

## Comprobaciones realizadas

- Suite principal: 1203 pruebas aprobadas, sin fallos ni skips, con entorno saneado.
- Compilación app y backend aprobadas, incluyendo lint/tipos de la app.
- Extensión: 18 pruebas aprobadas; compilación de distribución y ZIP íntegro.
- Chrome de extensión: claro/oscuro, 320/380/520 px, conectar, guardar, preparar
  mensaje y añadir a campaña con frontera simulada.
- Chrome de campañas: ranking, edición de secuencia, revisión, responsive y teclado.
- Chrome de búsqueda: reintento página inicial, expansión tras página filtrada,
  agotamiento y restauración al recargar sin repetir consulta al proveedor.
- Ocho pruebas adicionales SQL/WASM y CLI/calidad aprobadas, sin producción.
- Inspección del índice Git: inventario SHA-256, patrones de credenciales y
  contenido descomprimido del ZIP; cero hallazgos en 238 archivos iniciales.
  Se vuelve a ejecutar sobre el índice final antes del commit.

## Ajustes de integración

- `/settings/organization` declara force-dynamic para su comprobación de sesión.
- `scripts/send-campaign-owner-preview.mjs` queda local e ignorado: es una operación
  puntual con campaña y destinatario reales, no una dependencia del producto.
- ZIP público recompilado desde las fuentes actuales.

## Base de datos y despliegue

Inspección de solo lectura confirma los registros remotos de public company,
email library, atomic draft revision, enriched audience y search checkpoints.
El checkpoint quedó registrado por MCP como `20260910142409`; el archivo fuente
local conserva `20260911100000`. No repetir migraciones por diferencia de timestamp.
Los otros mapeos históricos permanecen en `docs/migration-history-reconciliation.md`.
No se reparó historia remota ni se aplicó SQL en esta consolidación.

Esta verificación no acredita una revisión semántica exhaustiva de cada línea,
igualdad byte a byte con la imagen publicada ni pruebas autenticadas de proveedores
reales. Las pruebas de navegador usan APIs simuladas. La publicación app/backend
y las comprobaciones de tráfico/rutas siguen siendo una fase separada.
