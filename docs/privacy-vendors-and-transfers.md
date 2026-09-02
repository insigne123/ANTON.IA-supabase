# Privacy vendors and transfers

Objetivo:
Tener una vista simple de proveedores que pueden recibir o procesar datos personales desde ANTON.IA.

Como leer este documento:
- "Proveedor" = servicio externo usado por la plataforma.
- "Tipo de datos" = que clase de datos puede ver o procesar.
- "Efecto" = por que se usa y que parte del producto soporta.
- "Accion" = lo que hay que cerrar despues a nivel contractual u operativo.

## Proveedores principales visibles en el codigo

### 1. Supabase
- Tipo de datos: cuentas, organizaciones, leads, CRM, tracking, tokens, bajas, auditoria.
- Efecto: base principal de datos y autenticacion de la app.
- Accion: documentar ubicacion, revisar DPA y revisar almacenamiento de tokens.

### 2. Google
- Tipo de datos: tokens de Gmail, envio de correos y metadatos tecnicos asociados.
- Efecto: permite enviar correos desde Gmail del usuario.
- Accion: documentar flujo, scopes, retencion y revocacion.

### 3. Microsoft
- Tipo de datos: tokens de Outlook, envio de correos y metadatos tecnicos asociados.
- Efecto: permite enviar correos desde Outlook del usuario.
- Accion: documentar flujo, scopes, retencion y revocacion.

### 4. OpenAI
- Tipo de datos: prompts, contexto comercial, informacion de leads o mensajes cuando una funcion de IA la envia.
- Efecto: personalizacion, generacion de texto y apoyo al scoring o automatizacion.
- Accion: definir cuando se envia PII, documentar limite de uso y revisar terminos vigentes.

## Integraciones retiradas

### n8n
- Estado: retirado del runtime de produccion. No se debe configurar ni usar para nuevas operaciones.
- Tipo de datos: filtros de busqueda, payloads de leads, enrichment e investigacion segun workflow.
- Efecto historico: orquestaba flujos externos de busqueda e investigacion.
- Accion: conservar el inventario y aplicar la retencion/eliminacion aprobada a datos y logs historicos.

## Otros proveedores visibles en el codigo

### 5. Apollo
- Tipo de datos: datos profesionales de leads y enrichment comercial.
- Efecto: busqueda y enriquecimiento de prospectos.
- Accion: documentar origen de datos, terminos del proveedor y base de uso B2B.

### 6. People Data Labs (PDL)
- Estado: retirado del runtime de produccion; se conserva codigo legacy no importado para trazabilidad.
- Tipo de datos: enrichment y datos profesionales de personas.
- Efecto historico: proveedor alternativo o complementario para leads.
- Accion: no configurar credenciales ni reactivar sin una revision de privacidad y seguridad.

### 7. Apify
- Estado: activo solo para buscar vacantes en `/api/opportunities/*`; retirado como proveedor de busqueda de personas.
- Tipo de datos: resultados de scraping o automatizacion externa para busqueda o LinkedIn.
- Efecto: obtiene vacantes de LinkedIn mediante un actor dedicado; no participa en busqueda ni enriquecimiento de personas.
- Accion: mantener esta excepcion separada del gateway Apollo y revisar periodicamente datos, retencion y terminos del actor.

### 8. Anymail Finder
- Estado: retirado del runtime de produccion; su endpoint responde `410 PROVIDER_RETIRED`.
- Tipo de datos: datos de contacto y enriquecimiento de email.
- Efecto historico: revelaba o validaba correos de leads.
- Accion: no configurar credenciales y conservar solo identidades historicas persistidas.

## Riesgos simples a tener presentes

1. Que se envien mas datos personales de los necesarios a proveedores de IA o enrichment.
2. Que no este claro en que pais o infraestructura se procesan los datos.
3. Que falte contrato o condicion de tratamiento con algun proveedor critico.
4. Que se mantengan datos en logs externos mas tiempo del necesario.

## Acciones invisibles siguientes

1. Crear lista definitiva de proveedores activos y desactivar los que ya no se usan.
2. Asociar cada proveedor a un owner interno.
3. Guardar link al DPA o contrato de cada proveedor.
4. Identificar si cada proveedor recibe datos de usuario final, leads o ambos.
