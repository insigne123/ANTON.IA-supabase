# 4.0.10 · acciones de contacto y acceso a mensajes

14 de septiembre de 2026. Desplegado en `studio-build-2026-09-14-004`, 100% del tráfico.

- Detección de acciones incluye enlaces nativos, role=button, etiquetas accesibles duplicadas e InMail. Recorrido de contenedores ampliado manteniendo límites ante secciones ajenas. No se afirma conocer el DOM real a partir de una captura.
- Preparar reutiliza una conversación abierta solo si el destinatario está verificado por URL y hay editor. Mantiene protección de borradores y comprobación de perfil tras insertar.
- Si solo aparece Seguir, orienta a seguir manualmente o buscar Conectar, explicando que seguir no habilita necesariamente mensajes. No infiere plan de pago por el perfil visitado ni hace follows automáticos.
- Detecta avisos de Premium/créditos en diálogos y explica conexión frente a InMail. Un InMail verificable permite preparar el cuerpo; asunto/créditos/envío quedan para revisión manual en LinkedIn. Envío automático se detiene ante InMail.
- Cuatro casos nuevos: enlace con etiqueta duplicada, perfil sin acceso a mensaje, preparación InMail y bloqueo Premium. Suite inicial 53/54; tras adaptar el fixture de navegación para conversación ya abierta, los tres tests del archivo afectado pasan. El resto de pruebas ya aprobadas no se repitió.
- ZIP verificado: 1.920.536 bytes, SHA-256 `b3115df1eca5c66d12377542806a8bd8b3791fbe615f324a4e3373af2235a2f5`. Descarga pública idéntica, rutas de privacidad/conexión/API comprobadas. Sin ERROR en consulta inmediata de logs de revisión (15 minutos).

Actualizar extensión y recargar LinkedIn para reemplazar scripts ya cargados. Pendiente validación autenticada del DOM real; no se enviaron mensajes, follows ni se gastaron créditos InMail durante estas pruebas.
