# Chrome Web Store · candidato 4.0.5

Estado: candidato local. Requiere desplegar la migración `20260913100000_extension_linkedin_sends.sql`, API y privacidad antes de probar envíos autenticados o subir a revisión. Visibilidad solicitada: pública; publicación automática al aprobarse.

## Propósito único

Prospección contextual desde perfiles de LinkedIn: consultar datos profesionales, guardar contactos en Anton.IA, investigar con fuentes, preparar mensajes y solicitar su envío individual después de revisar destinatario y texto.

## Permisos

- `sidePanel`: espacio de trabajo junto al perfil.
- `tabs`: identificar el perfil abierto y comprobar la pestaña autorizada de conexión. No se solicita acceso al historial de navegación.
- `storage`: vínculo de cuenta persistente sin tokens; borradores en sesión y registro local de operaciones pendientes para recuperar resultados tras cerrar el navegador. Este registro no contiene el texto del mensaje y se elimina al sincronizar. El historial y texto se guardan en Anton.IA.
- `scripting`: recuperar los scripts empaquetados de LinkedIn en pestañas abiertas antes de instalar o actualizar. Se comprueba primero si el receptor existe; no se descarga código remoto ni se reintenta automáticamente un envío.
- `https://www.linkedin.com/*`: leer perfil contextual y operar sobre una conversación cuyo destinatario se verifica. Enviar solo tras confirmación explícita del usuario desde el panel conectado.
- Dominios Anton.IA: conexión autenticada y funciones de guardar, enriquecer, investigar, redactar y preparar seguimiento por email.

## Datos

Revisar las definiciones vigentes del formulario y declarar datos de identificación personal/profesional, contenido de sitio y comunicaciones personales. Datos de perfil, contacto, mensaje y contexto comercial se procesan en Anton.IA; enriquecimiento, investigación y redacción pueden compartir el contexto necesario con proveedores de esas funciones. No declarar que no se recopilan datos o que las únicas transferencias son a la base propia.

El propietario debe confirmar las certificaciones de uso limitado con la operación real y la política general de la plataforma. La extensión empaqueta su código; las respuestas de API/IA se utilizan como texto o datos.

## Envío

Hasta 1200 caracteres. Se usa la sesión abierta en LinkedIn: el panel lo explica sin afirmar conocer su identidad. Un intento se registra antes del clic. Solo un nuevo evento saliente identificado en el hilo verificado y con texto coincidente confirma el resultado. Pendiente/incierto no equivale a enviado. No hay reintento automático del mismo mensaje; la recuperación ofrece sincronización y revisión en LinkedIn. El puente histórico SEND_DM está rechazado.

## Capturas e instrucciones

Capturas reales del candidato: perfil, investigación, editor y revisión del envío, con datos ficticios. No presentar capturas anteriores como evidencia del nuevo envío. Revisor: conectar cuenta en `/extension/connect`, conservar pestaña, guardar perfil, generar/editar mensaje, abrir «Revisar y enviar», comprobar cuenta LinkedIn y confirmar. Para pruebas de envío usar únicamente destinatarios controlados y autorizados.
