# Cowork — Fase 2: integración en curso

Fecha de revisión: 18 de septiembre de 2026.

Estado: cambios locales, no desplegados. La Fase 2 no está terminada. Las marcas
previas de tareas completadas describían implementación inicial, no aceptación
integral de cada capacidad.

## Correcciones verificadas en esta revisión

- El verificador incluye las suites de enriquecimiento, campañas, equidad y envío
  con argumentos de Node correctos. Los mocks de las suites anteriores aíslan los
  nuevos adaptadores sin importar accidentalmente sus dependencias externas.
- Las consultas de campañas reciben el cliente de datos en AuthContext. El nombre
  se toma de `definition.name`, no de una columna `name` inexistente en el contrato.
- La vista previa de creación valida la definición completa con CampaignInputSchema.
- La ejecución de creación usa el trabajo que contiene la definición, que puede
  diferir del trabajo donde se observó la lista de campañas.
- La migración local amplía tanto el constraint como `cowork_propose_effect`.
- El envío verifica propuesta persistida en ejecución, alcance, objetivo exacto,
  trabajo vigente y permisos. Revalida después de renovar credenciales y reservar
  cuota. Comprueba hash después de aprobar y antes de invocar al proveedor.
- La clave de envío depende de la versión y no del trabajo que originó la propuesta.
- El enriquecimiento no completa por segunda vez una cuota que liquida el callback
  compartido; conserva resultados inciertos para conciliación. El replay recupera
  el registro persistido con alcance usuario/organización y respeta supresión.
- El mensaje de campaña aprobada distingue automatización activa de inicio manual;
  pausar no promete cancelar un envío que ya estaba en curso.

## Evidencia local

- `npm run typecheck`: aprobado.
- `node scripts/verify-cowork.mjs`: aprobado, 60 pruebas unitarias y 16 scripts
  aislados, incluidos controles de versión, autorización persistida, revocación
  durante renovación, supresión, cuota y resultado incierto.
- Son pruebas con dependencias simuladas. No certifican concurrencia SQL, envío
  real, renderizado visual ni recorridos autenticados en producción.

## Condiciones pendientes para cerrar la fase

1. Fijar remitente/proveedor y cuenta real en la revisión de envío, comprobar la
   misma identidad al ejecutar y mostrar contenido completo también para HTML.
2. Creación de campañas idempotente en el servicio compartido, definición inmutable
   después de proponer, y revisión que muestre destinatarios y cuerpos completos.
3. Completar el contrato de activar/reanudar/procesar: aprobar con automatización
   desactivada no equivale a iniciar envíos.
4. Pruebas de integración de SQL, reintentos y efectos inciertos. Aplicar migraciones
   una por vez con verificación de esquema, permisos y RLS antes del despliegue.
5. Validar campos y semántica de las lecturas contra esquema real; distinguir
   credenciales guardadas de conexión comprobada y métricas acumuladas de período.
6. Verificar continuidad guardar → enriquecer → investigar → borrador: el
   enriquecimiento crea un registro distinto y debe conservarse la identidad y
   disponibilidad del correo a través de todos los servicios.
7. Revisar tarjetas nuevas en navegador (teclado, revocación, móvil, claro/oscuro).
8. Desplegar el artefacto exacto verificado y ejecutar el recorrido privado.

No se aplicaron migraciones ni se realizaron envíos reales en esta revisión.
