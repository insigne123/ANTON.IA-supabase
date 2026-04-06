# Chile privacy baseline

Cambios de bajo impacto implementados para empezar la adaptacion a la Ley 21.719:

1. Se agrega una politica de privacidad general publica para la plataforma.
   Efecto: la app deja de depender solo de la politica de la extension y pasa a explicar el tratamiento de datos del producto completo.

2. Se corrigen enlaces internos para que login y ajustes apunten a la politica general.
   Efecto: mejora transparencia sin cambiar el flujo principal del usuario.

3. Se ajusta la politica de la extension para que describa mejor lo que hace hoy el codigo.
   Efecto: reduce inconsistencias entre la documentacion publica y el comportamiento real de la extension.

4. Se agregan variables opcionales para razon social y contacto de privacidad.
   Efecto: permite publicar un contacto formal sin tocar codigo mas adelante.

5. Se agregan borradores internos de cumplimiento para operar el plan sin tocar aun el flujo del producto.
   Efecto: YAGO SPA ya tiene una base inicial para decidir roles, proveedores, retencion e incidentes.

6. Se endurecen los links de baja para que los nuevos envios usen un token opaco en vez de exponer email, userId y orgId en la URL.
   Efecto: reduce exposicion de datos personales en enlaces enviados por correo, manteniendo compatibilidad con links antiguos.

7. Se restringe la comunicacion `postMessage` de la extension al origen actual de la app en vez de usar `*`.
   Efecto: baja el riesgo de mensajes inesperados o reenviados desde contextos no deseados sin cambiar el flujo de uso.

8. Se cifra el refresh token antes de guardarlo en `provider_tokens` y se soporta migracion gradual de tokens antiguos.
   Efecto: reduce exposicion de credenciales en base de datos sin cambiar la experiencia del usuario.

9. Se migran consumidores visibles de leads enriquecidos desde `localStorage` a los servicios cloud y se agrega expiracion automatica a caches locales de investigacion.
   Efecto: reduce la cantidad y permanencia de datos comerciales guardados en el navegador sin cambiar el flujo de trabajo.

10. Se agrega un formulario publico de solicitudes de privacidad y una bandeja interna restringida para revisar ingresos.
   Efecto: YAGO SPA ya cuenta con un canal formal para acceso, rectificacion, supresion, oposicion, portabilidad, bloqueo u otras solicitudes relacionadas.

11. Se agregan acciones internas para exportar datos del titular, bloquear contacto y eliminar datos comerciales asociados por email.
    Efecto: las solicitudes dejan de ser solo administrativas y pasan a tener herramientas tecnicas concretas de ejecucion.

12. Los flujos principales de envio de correo ahora respetan tambien supresiones globales del servicio cuando existen.
   Efecto: si YAGO SPA registra una oposicion a nivel servicio, el destinatario no deberia volver a ser contactado por otra cuenta del SaaS en los flujos reforzados.

13. Se agrega limpieza automatica de retencion para reportes auxiliares, eventos de email, respuestas antiguas, logs e historial cerrado de solicitudes.
   Efecto: la plataforma reduce sobreconservacion de datos y aplica minimizacion de forma periodica sin tocar datos core activos del CRM.

14. Se agrega un registro interno de incidentes de privacidad con bandeja de seguimiento.
   Efecto: el playbook de incidentes deja de ser solo documental y pasa a tener un soporte operativo dentro de la app.

15. Se agrega una accion segura para suspender acceso al SaaS de usuarios de la plataforma cuando corresponde.
   Efecto: YAGO SPA puede cortar acceso a una cuenta de usuario mientras se resuelve una solicitud o incidente, sin borrar automaticamente datos compartidos de forma riesgosa.

Pendientes invisibles recomendados antes de tocar flujos sensibles:

1. Matriz responsable vs encargado por tipo de dato y flujo.
2. Registro interno de tratamientos, proveedores y transferencias.
3. Matriz de base legal por proceso.
4. Politica interna de retencion y borrado.
5. Procedimiento de incidentes de seguridad.

Artefactos internos creados:

1. `docs/privacy-register-of-processing.md`
2. `docs/privacy-vendors-and-transfers.md`
3. `docs/privacy-retention-draft.md`
4. `docs/privacy-incident-playbook.md`
5. `docs/privacy-role-model.md`
6. `docs/privacy-legal-basis-matrix.md`
