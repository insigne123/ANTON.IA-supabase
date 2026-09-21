# Revisión adicional del candidato 4.0.7

## Dictamen

La corrección de conexión al informe V2 está implementada y las pruebas pasan. No corresponde afirmar que todo esté perfecto: quedan casos de recuperación, sincronización y representación del documento por completar o validar. La revisión no despliega ni ejecuta envíos o investigaciones facturables.

## Verificaciones realizadas

- Suite completa `npm run extension:test`: 34/34 aprobadas.
- `npm run typecheck`: aprobado.
- `git diff --check`: sin errores de whitespace.
- `scripts/verify-linkedin-extension-package.mjs`: ZIP 4.0.7, 1.916.760 bytes, 11 archivos esperados, hashes coincidentes. SHA-256 `f35d49e625b1b52dc26f800a80e753ff1b52a9634597ed218428d6be1b7b0d8f`.
- Prueba Chrome con API simulada: ambos temas, 320/380/520 px, espera de síntesis, descarga final, búsqueda exclusiva de teléfono, bloque profesional vacío, navegación y envío simulado. Aprobada.
- Build Next.js aprobado en la etapa anterior; no se repitió sin cambios de aplicación.
- Revisados los loaders V2: acotan por snapshot, usuario y organización, comprueban documento válido y visible. No se deben ampliar permisos para resolver un informe ausente.

## Pendientes encontrados por lectura del código

### 1. La caché del perfil puede ocultar actualizaciones del servidor

`chrome-extension/ui/panel.tsx`, `selectProfile`: primero aplica `fromRow(result.lead)` y después reemplaza el formulario con `prospect-profile:*` si existe. La copia local no incluye una comparación de revisión ni una marca que distinga cambios pendientes de un formulario antiguo. Volver a un contacto puede mostrar datos obsoletos y guardarlos sobre los actuales.

Antes del cierre: usar servidor como base y recuperar únicamente ediciones locales explícitamente pendientes, con tratamiento de conflictos. Probar también cambios rápidos de perfil durante el guardado asíncrono de caché: la comprobación de `locked` ocurre antes del primer `await`.

### 2. Teléfono diferido sin recuperación en el panel

`enrich` solo consume el resultado inmediato. Si Apollo informa teléfono pendiente y lo entrega después, no hay seguimiento del estado del enriquecimiento desde el panel. «Buscar teléfono» reutiliza el mismo operationId para la misma selección; no debe asumirse que eso es una consulta de actualización del teléfono. La carga de investigación no sustituye esta sincronización.

Antes del cierre: mostrar pendiente/no encontrado/completado y consultar el resultado persistido mediante la ruta de estado adecuada, sin repetir cargos. Preservar el correo y su verificación.

### 3. Recuperación incompleta de V2 ausente o fallido

`research-state.ts` agrupa síntesis fallida, ausente y documento no visible en «no está disponible todavía». El panel indica ir a Investigación, pero no ofrece un enlace directo ni invoca el endpoint existente para reintentar exclusivamente la síntesis. «Investigar de nuevo» actúa sobre recopilación y su refresh depende del estado inicial; no equivale a reintentar una síntesis fallida.

Antes del cierre: distinguir fallo, espera y ausencia; recuperar con el mecanismo de síntesis ya existente, manteniendo la restricción de usuario/organización. Probar que no se repite investigación facturable por intentar descargar.

### 4. El PDF todavía no cubre todos los bloques V2

`research-pdf.ts` incluye los párrafos de todas las secciones y material del grafo. Maneja comité, preguntas como array y tablas con `payload.rows`/`columns`, pero el contrato admite otros formatos y tipos, como timeline. No hay renderizado exhaustivo de todos los payloads ni aviso cuando se omite uno. Por tanto, «incluye las 15 secciones narrativas» no implica fidelidad completa de todo el documento estructurado.

Antes del cierre: inventariar payloads reales, compartir representación con el workspace cuando sea posible y probar al menos tablas, cronología, estimaciones, comité, preguntas, entregables y contenido largo. Revisar un PDF del documento real autorizado, no solo un ejemplo sintético. Comprobar también caracteres fuera de las fuentes latinas estándar de jsPDF.

## Dependencias de validación final

- La versión 4.0.7 sigue local en esta revisión; el último despliegue confirmado es 4.0.6. Falta verificar la lectura autenticada de V2 después de desplegar.
- La cuenta usada en el caso de Bianca produjo una recomendación con «Mi empresa». Revisar perfil comercial y catálogo aprobado con el propietario antes de afirmar personalización correcta para GrupoExpro.
- Los tests de Chrome usan límites de API simulados: no certifican el DOM real de LinkedIn, la identidad de su sesión ni la entrega del proveedor.
- Cierre requerido: probar el mismo contacto de la captura con la cuenta autorizada, comprobar el contenido del PDF contra el documento V2 guardado y validar recuperación de un teléfono pendiente y una síntesis fallida.

Esta revisión aporta hallazgos, no una certificación de ausencia de errores.
