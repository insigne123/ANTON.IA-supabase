# Buscar prospectos · empresas y contactos con flujo compartido

## Decisión del dueño

El selector de fuente es exclusivo de su cuenta; para las demás personas existe solo «Buscar prospectos», sin elección ni nombres de fuentes en el selector/textos de error de filtros. El control depende de ID/correo confirmado del dueño + flags del piloto; ser owner/admin de una empresa o estar en la allowlist por sí solo no concede Leads Finder. Search, status y reveal comprueban la misma regla en servidor.

Referencia de flujo/UI: capturas entregadas por el usuario, composición actual de criterios + empresas + contactos de ANTON.IA. Se reutilizan sus componentes y tokens en claro/oscuro, con pasos idénticos para las dos fuentes. No se copia branding externo.

## Filtros y Empresa

Ambos criterios siguen empresa → selección → contactos por empresa → guardado. Apollo descubre las empresas, con nombre/dominio o criterios de empresa; después el dueño puede pedir contactos a Apollo o Leads Finder. Perfil LinkedIn conserva su operación específica.

Documentación de capacidades consultada sin ejecutar jobs: [Leads Finder input](https://apify.com/code_crafter/leads-finder/input-schema), schema/public README del actor. Lead Finder soporta `company_domain`, cargos, seniority y ubicación **de personas**; no se documenta un catálogo independiente de empresas equivalente al de Apollo. Por eso el flujo es combinado y se explica al dueño. Los filtros de empresa permanecen en la fase Apollo; no se reinterpretan la sede de empresa como ubicación del contacto.

## Integración

- Selección con dominio normalizado firmada por el servidor (`contact_scope`) y ligada a usuario, tenant, empresa externa y vencimiento de 24 horas. Sin dominio no se realiza una consulta amplia como sustituto.
- Leads Finder usa el dominio firmado, nunca IDs de empresa Apollo. Rechaza selecciones manipuladas/de otra cuenta/workspace o vencidas antes de descontar cuota. Los resultados fuera del dominio seleccionado se excluyen antes de guardarlos/mostrarlos.
- Payload estricto: campos desconocidos o IDs de proveedor equivocado no se eliminan silenciosamente. Traducción de filtros validada antes de consumir el cupo.
- Una consulta por empresa recupera **hasta 100 contactos**, respetando límite actual del actor y hard cap monetario existente. Se presenta la ventana solicitada y `Traer más` consume el **buffer privado de ese resultado**, sin repetir consulta/cuota. No se inventa el total de personas en la empresa ni una paginación que el actor no ofrece.
- El checkpoint guarda fuente, ventanas y buffer **sin datos de contacto**. Restaurar no ejecuta búsquedas; fuente revocada descarta sus ventanas, cambiar fuente descarta personas de la fuente anterior y conserva empresas.
- Shallow results quedan en Por completar mediante el mismo guardado. El reveal usa el vault, no otra búsqueda: ahora responde con la fila canónica persistida después de triggers de supresión, y no aplica la identidad original de un dato suprimido. Email-only mantiene el teléfono no revelado; la supresión retira el secreto almacenado.
- Tamaños expresados como rangos ya no se convierten en números concatenados ficticios (`1001-2000` no es `10012000`).

## Evidencia

- Typecheck/build Node 22 y suite pertinente, sin `.env.local`, proveedores ni producción.
- Chrome de la página/clientes reales con APIs sintéticas: Filtros/Empresa, dueño/usuario común, móvil/escritorio y claro/oscuro. Selección acotada, guardado shallow, 50→75 desde buffer sin llamada extra, recuperación sin consulta, retirada ante revocación y cero overflow/page errors/axe. Se corrigió contraste del contador activo en dark usando el token existente de texto.
- Regresión de renovación de sesión, denegación de organización, error de perfil y recuperación de criterios también en verde.
- Pruebas de firma/aislamiento/vencimiento/owner-only, exclusión de resultados de otra empresa, respuesta canónica suprimida y cuota antes de efectos.

No migraciones, escrituras productivas, gasto de proveedores ni cambios del piloto habilitado. La verificación de integración no equivale a despliegue ni a conformidad de resultados de un proveedor real; la selección por dominio está documentada y el transporte real conserva sus límites/errores explícitos.
