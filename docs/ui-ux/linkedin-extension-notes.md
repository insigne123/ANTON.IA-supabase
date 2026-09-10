# LinkedIn Workspace

## Referencia y composición

Referencia funcional: https://www.apollo.io/product/chrome-extension (consultada el 9 de septiembre de 2026). Patrones rescatados: perfil contextual, datos profesionales junto al lugar de prospección, guardado y paso a contacto. La interfaz usa identidad Anton.IA, tipografía de sistema y superficies silenciosas; no reutiliza assets de Apollo.

Problema: flujo y componente. Panel nativo de Chrome con tres vistas: Perfil, Investigación y Contactar. Datos del perfil como contexto persistente; una acción primaria por fase. La URL permanece editable para admitir perfiles fuera de la pestaña activa. Un cambio de perfil ofrece una acción explícita y no reemplaza automáticamente un mensaje en edición.

## Decisiones

- CSS aislado del DOM de LinkedIn, tokens equivalentes en claro/oscuro.
- Componentes HTML nativos en el bundle de la extensión; botón compartido de la app en la página de conexión.
- Formularios en una columna; selects de tono e idioma en dos columnas solo cuando hay espacio.
- Borrador editable antes de preparar; copia disponible ante cambios en LinkedIn.
- Estados de trabajo y resultado en feedback persistente. No mostrar envío confirmado al preparar texto.
- Fuentes y hechos se consultan desde investigación; no inventar datos para cubrir vacíos.

## Revisión realizada

Chrome headless con API de extensión simulada: conectar, guardar, generar y preparar. Temas claro/oscuro y anchos 320/380/520 px, sin overflow horizontal. Foco por teclado comprobado; capturas de ambos temas revisadas. Pruebas DOM separadas para destinatario incorrecto, borrador existente, navegación y no pulsar Enviar.

La revisión no sustituye la prueba del DOM actual de LinkedIn con sesión real ni la prueba de despliegue de la app. Detalles y límites: `chrome-extension/DEPLOY_EXTENSION.md`.
