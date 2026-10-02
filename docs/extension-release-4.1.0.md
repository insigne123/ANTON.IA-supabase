# Distribución de LinkedIn Workspace 4.1.0

Fecha de preparación: 2 oct 2026. Incluye las PR #129–#133.

Ambos manifiestos pasan de 4.0.14 a 4.1.0. Los permisos siguen siendo
`tabs`, `sidePanel`, `storage` y `scripting`. Sin orígenes nuevos.

## Artefacto

- `npm run extension:release` compila y empaqueta una lista cerrada de 12 archivos.
- `public/downloads/antonia-linkedin-extension.zip` contiene el manifiesto en la raíz.
- El paquete de producción no incluye localhost ni archivos de desarrollo.
- El SHA-256 del ZIP preparado es
  `98d74c36c995cf4a78f879b9c3fd32c64e02afb68b67dbb9a6a541ec81c506ea`.
- Publicación descargable: la URL de la app `/downloads/antonia-linkedin-extension.zip`.

La publicación en Chrome Web Store es otro estado: subir este ZIP a la ficha
existente con la cuenta editora y seguir la revisión de Google. El repositorio no
contiene un flujo autenticado para publicar en la tienda; no afirmar que ya está allí.

## Verificación realizada

- `extension:test`: 96 pruebas aprobadas, sin base, proveedores ni LinkedIn reales.
- Verificación de ZIP: manifiesto 4.1.0 y 12 archivos actuales; permisos concordantes.
- Navegador Chrome con frontera simulada: light y dark, anchos 320/380/520, teclado,
  sin overflow, conexión, créditos, guardado, investigación, borrador y estados;
  marcas, guardado en lote, ficha de empresa y apertura desde actividad reciente.
- Política pública actualizada para describir páginas de empresa, personas visibles
  y el contexto acotado de actividad usado para redactar.

Pendiente: DOM de LinkedIn real, vigencia de la ficha de empresa/Personas/Actividad,
y calidad de los borradores con el modelo real. Pasos en `docs/linkedin-prueba-guiada.md`.

Corrección del smoke de conexión: la petición inicial `session` no lleva usuario ni
organización, porque los descubre desde la sesión autenticada del servidor. Los demás
comandos sin perfil (créditos, presencia, empresa, lote) siguen exigiendo ambos ids
y revalidando el vínculo. Una petición de sesión anónima debe responder 401, no 400.
