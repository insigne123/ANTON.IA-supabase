# Privacy register of processing

Objetivo:
Tener una primera version simple del registro interno de tratamientos para la adaptacion a la Ley 21.719 sin cambiar el flujo de la app.

Como leer este documento:
- "Tratamiento" = una actividad donde usamos datos personales.
- "Base tentativa" = la justificacion legal que hoy parece mas razonable, pero debe validarse juridicamente.
- "Efecto" = para que sirve ese tratamiento dentro del producto.

## 1. Cuentas y acceso

- Tratamiento: registro, login, sesion, roles y organizacion.
- Datos: nombre, email, identificador de usuario, rol, organizacion, metadatos de sesion.
- Fuente: usuario y sistema de autenticacion.
- Finalidad: permitir acceso seguro y separar datos por workspace.
- Base tentativa: ejecucion del servicio / relacion contractual.
- Efecto: sin esto la app no puede autenticar ni limitar acceso por organizacion.

## 2. Integraciones de correo

- Tratamiento: conexion de Gmail y Outlook para enviar correos y operar campanas.
- Datos: refresh token, identificadores tecnicos del proveedor, estado de conexion.
- Fuente: usuario que autoriza la integracion.
- Finalidad: enviar correos desde la cuenta del usuario y mantener la conexion activa.
- Base tentativa: ejecucion del servicio / relacion contractual.
- Efecto: permite usar Gmail y Outlook desde la app.

## 3. Busqueda de leads

- Tratamiento: busqueda de contactos y empresas desde proveedores externos.
- Datos: nombre, cargo, empresa, email laboral, LinkedIn, ubicacion, metadatos profesionales.
- Fuente: proveedores externos y fuentes publicas procesadas por ellos.
- Finalidad: detectar leads para trabajo comercial dentro del workspace del cliente.
- Base tentativa: interes legitimo del cliente o de la operacion B2B. Requiere validacion.
- Efecto: alimenta listas de prospectos y oportunidades.

## 4. Enriquecimiento de leads

- Tratamiento: completar o mejorar datos de contacto y perfil.
- Datos: email, telefono, cargo, empresa, LinkedIn, ubicacion, score de confianza.
- Fuente: proveedores de enrichment.
- Finalidad: mejorar calidad de contacto y priorizacion comercial.
- Base tentativa: interes legitimo. Requiere validacion y limites claros.
- Efecto: aumenta la accionabilidad de leads guardados.

## 5. CRM y pipeline

- Tratamiento: guardar leads, oportunidades, notas, estados y trazabilidad comercial.
- Datos: datos profesionales del lead, notas internas, estado comercial, actividades.
- Fuente: usuario, integraciones y automatizaciones internas.
- Finalidad: organizar y seguir el pipeline por organizacion.
- Base tentativa: ejecucion del servicio; en datos de terceros, interes legitimo del uso B2B.
- Efecto: permite continuidad comercial y colaboracion interna.

## 6. Envio de correos y seguimiento

- Tratamiento: envio de mensajes, bajas, tracking de apertura, click, respuesta y rebote.
- Datos: destinatario, asunto, cuerpo, metadatos de entrega, open/click, unsubscribe.
- Fuente: usuario, plataforma y respuesta del proveedor de correo.
- Finalidad: ejecutar outreach y medir resultado de campanas.
- Base tentativa: ejecucion del servicio para el usuario; en destinatarios, interes legitimo sujeto a baja y oposicion.
- Efecto: permite enviar, medir y detener contactos cuando corresponde.

## 7. Extension de LinkedIn

- Tratamiento: lectura de datos visibles del perfil, automatizacion de mensajes y deteccion de replies.
- Datos: nombre, cargo, empresa, URL de perfil, ultimo reply visible, contexto del hilo.
- Fuente: interfaz visible de LinkedIn y accion explicita del usuario.
- Finalidad: apoyar investigacion y seguimiento comercial desde navegador.
- Base tentativa: ejecucion del servicio solicitado por el usuario; revisar limites por canal y fuente.
- Efecto: extiende funciones de la app sobre LinkedIn.

## 8. IA, scoring y automatizacion

- Tratamiento: scoring de leads, evaluacion de fit, recomendacion de acciones y generacion de contenido.
- Datos: datos del lead, contexto comercial, mensajes, estado de engagement, reglas internas.
- Fuente: plataforma, proveedores y usuario.
- Finalidad: priorizar trabajo comercial y asistir redaccion y automatizacion.
- Base tentativa: ejecucion del servicio y/o interes legitimo. Requiere disclosure y control.
- Efecto: el sistema puede sugerir o automatizar acciones sobre leads.

## 9. Logs, auditoria y soporte

- Tratamiento: actividad del usuario, trazas tecnicas, errores y registros operativos.
- Datos: identificadores, URL, eventos, tiempos, fragmentos tecnicos y auditoria funcional.
- Fuente: plataforma.
- Finalidad: soporte, seguridad, trazabilidad y resolucion de incidentes.
- Base tentativa: interes legitimo y seguridad del servicio.
- Efecto: permite investigar errores, acciones y abusos.

## 10. Bajas y exclusiones

- Tratamiento: conservar lista de no contactar y preferencias de baja.
- Datos: email, contexto de baja, fecha, usuario u organizacion asociada.
- Fuente: destinatario, sistema o administrador.
- Finalidad: evitar reenvios no deseados y respetar oposicion comercial.
- Base tentativa: obligacion operativa de cumplimiento y defensa del servicio.
- Efecto: protege contra nuevos contactos no deseados.

## Pendientes a completar

1. Confirmar si YAGO SPA actua como responsable, encargado o mixto en cada tratamiento.
2. Validar base legal definitiva con asesoria legal.
3. Definir SLA para responder derechos de titulares.
4. Asociar cada tratamiento con su plazo de retencion final.
