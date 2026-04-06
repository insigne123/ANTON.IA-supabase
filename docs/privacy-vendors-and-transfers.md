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

### 5. n8n
- Tipo de datos: filtros de busqueda, payloads de leads, enrichment e investigacion segun workflow.
- Efecto: orquesta flujos externos de busqueda e investigacion.
- Accion: documentar hosting, logs, terceros conectados y responsable operativo.

### 6. Apollo
- Tipo de datos: datos profesionales de leads y enrichment comercial.
- Efecto: busqueda y enriquecimiento de prospectos.
- Accion: documentar origen de datos, terminos del proveedor y base de uso B2B.

### 7. People Data Labs (PDL)
- Tipo de datos: enrichment y datos profesionales de personas.
- Efecto: proveedor alternativo o complementario para leads.
- Accion: documentar origen de datos, terminos y restricciones de uso.

### 8. Apify
- Tipo de datos: resultados de scraping o automatizacion externa para busqueda o LinkedIn.
- Efecto: flujo legacy de prospeccion e integracion externa.
- Accion: revisar si sigue activo, donde corre y que datos registra.

### 9. Anymail Finder
- Tipo de datos: datos de contacto y enriquecimiento de email.
- Efecto: revelar o validar correos de leads.
- Accion: documentar retencion y controles de uso.

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
