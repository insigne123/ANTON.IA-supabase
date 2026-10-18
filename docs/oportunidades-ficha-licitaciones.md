# Oportunidades: ficha para licitaciones

Primera parte del punto 12 («¿Conviene postular?» sin falsos «no»), 18 oct 2026. La ficha dice lo que la empresa es y puede hacer cuando postula. Con ella la IA no descarta una licitación por algo que la empresa sí tiene, y no adivina lo que no sabe.

## Qué pregunta

16 respuestas en cinco grupos (`tender-profile.ts`):

- **Tu empresa:** razón social, RUT (con dígito verificador), tamaño por ventas anuales, personas y años en el rubro.
- **Dónde y cuánto:** regiones de Chile donde presta el servicio, personas que podría asignar a un contrato nuevo y el rango de montos de contrato que le interesa.
- **Experiencia:** si le ha vendido al Estado, contratos con organismos públicos y clientes privados similares.
- **Lo que suelen pedir las bases:** Registro de Proveedores, certificaciones vigentes (ISO 9001, 14001, 45001, 27001, Sello ProPyme u otras), garantía máxima que puede entregar y seguro de responsabilidad civil.
- **Medios y límites:** equipos, flota, instalaciones o licencias, y lo que no hace.

Todo es opcional. En blanco significa «no sé», y la IA lo trata como un dato pendiente, nunca como un no. Una lista de certificaciones vacía, marcada como «No tenemos certificaciones», sí es un no.

## Dónde se edita

En Oportunidades, los administradores ven el botón «Ficha para licitaciones» junto a «Qué buscamos». Abre un panel lateral con:

- **El avance.** Por ejemplo, «10 de 16 respuestas».
- **«Completar con IA».** Es un trabajo `profile`, respondido en la misma petición. Lee:
  - la oferta del workspace;
  - lo que los administradores escribieron en Perfil (empresa, descripción, clientes, pruebas);
  - la portada del sitio web de la empresa (`company_domain`), descargada con `downloadOpportunitySource`: solo https, con DNS fijado y sin direcciones privadas.

  Solo llena campos en blanco y marca cada sugerencia con su fuente. No sugiere la garantía, el registro ni el seguro, y el RUT solo si aparece completo y válido. Nada se guarda hasta que la persona pulsa «Guardar ficha».
- **El guardado.** Se guarda con revisión: si otro administrador guardó antes, se avisa y no se pisa.
- **«Revisar de nuevo».** Aparece después de guardar cuando hay licitaciones abiertas descartadas por `requisito` o `escala`. Las devuelve a la evaluación en lotes de 40, una vez por versión de la ficha (`profile-review:{revisión}:{oferta}:{n}`).

## Quién la lee

- **La evaluación diaria** (`evaluateOpportunityBatch`). Con ficha, `requisito` y `escala` solo descartan cuando la ficha muestra que no se cumple: una región que no está, una garantía mayor que su máximo, una certificación que no tiene cuando la ficha dice cuáles tiene. Si no lo dice, el resultado es `review` y la razón indica qué dato falta. Sin ficha, esos motivos solo descartan cuando la oferta o sus exclusiones lo dicen.
- **El chat de cada oportunidad**, cuando preguntan si cumplen un requisito o si conviene postular.
- **El Asistente.**
- **El borrador de oferta.** Recibe la razón social, el RUT, la experiencia y las certificaciones, que llenan los marcadores en vez de dejarlos abiertos.

La lectura para los prompts (`tender-profile-read.ts`) no depende de la descarga ni de la IA. Sin ficha, o antes de la migración, todo sigue funcionando como antes.

## Migraciones

Una a la vez, después de las del Asistente:

1. `20261018132000_opportunity_jobs_profile.sql`: agrega el tipo `profile` a `opportunity_jobs`.
2. `20261018133000_opportunity_tender_profile.sql`: crea la tabla `opportunity_tender_profile`, una fila por workspace, solo para `service_role` y con RLS activo.

## ¿Cumplimos? (12b)

Cada informe de licitación, Compra Ágil o privada se compara con la ficha (`workspace-fit.ts`, trabajo `fit`, Haiku con razonamiento medio). Se encola solo al quedar listo el informe, si hay ficha, o con «Revisar con mi ficha» en los requisitos. Cada requisito queda como:

- **✓ Cumples:** la ficha o una respuesta lo muestra; se dice con qué dato.
- **⚠ Falta un dato:** la ficha no lo dice; la IA hace una pregunta que se responde ahí mismo con «Sí», «No» o «Responder con detalle».
- **✗ No cumples:** solo si el requisito tiene cita en las bases y un dato de la ficha lo contradice. Si falta alguno de los dos, es «falta un dato».
- **Trámite de la postulación:** formularios y declaraciones que cualquier oferente presenta.

La respuesta se guarda en la ficha («Respuestas a la IA», hasta 60) y la revisión se repite al tiro con ella. Cualquiera que trabaje la oportunidad puede responder; los administradores ven y quitan las respuestas en la ficha.

La decisión del informe se muestra con la ficha (`decisionWithFit`):

- un «No postular» que descansa en requisitos sin un ✗ con evidencia se muestra como «Postular si se resuelve lo pendiente», con la nota de qué responder;
- un «Postular» con un ✗ con evidencia pasa a condicional.

Un «No postular» por plazos, otro producto o alcance no cambia. El PDF y el Word del informe aún muestran la decisión original del informe.

Las lecturas quedan en `opportunity_requirement_fit` (una por informe y versión de la ficha). Si la ficha cambió, la barra lo dice y ofrece «Revisar de nuevo con mi ficha».

Migraciones, después de las anteriores:

3. `20261018134000_opportunity_jobs_fit.sql`: agrega el tipo `fit`.
4. `20261018135000_opportunity_requirement_fit.sql`: crea la tabla, solo `service_role`, con RLS, que se borra con su informe u oportunidad.

## Documentos de la empresa (12c)

En la misma ficha, «Documentos de la empresa» guarda una vez lo que piden casi todas las bases. Tipos disponibles:

- certificado F30 y F30-1;
- vigencia de la sociedad y del poder del representante;
- estados financieros;
- certificados ISO;
- otros.

Cada documento se guarda con su fecha de vencimiento (`workspace-company-documents.ts`):

- **Archivos.** Solo PDF o Word, revisados por sus primeros bytes, hasta 20 MB. Se guardan en el bucket privado `opportunity-documents`, bajo `company/{workspace}/`.
- **Vencimiento sugerido.** Para el F30 y las vigencias se sugiere desde la fecha de emisión: 30 o 60 días, lo que suelen exigir las bases. Siempre se puede cambiar.
- **Permisos.** Los administradores suben, cambian el vencimiento y quitan. Cualquiera del workspace descarga.
- **Avisos.** Con 15 días de anticipación, o ya vencido, la vista de administradores muestra un aviso («Certificado F30: vence en 5 días», «Ver documentos»). Se calcula al leer, porque los avisos de Oportunidades pertenecen a una oportunidad.
- **IA.** El cotejo de requisitos, el borrador de oferta, el chat de cada oportunidad y el Asistente reciben la carpeta con el estado de cada documento hoy (`documentosDeLaEmpresa`). Un F30 vigente cuenta como dato para ✓; uno vencido se dice.

Migración, después de las anteriores:

5. `20261018136000_opportunity_company_documents.sql`: crea la tabla, solo `service_role` y con RLS. Los tipos son conocidos, las rutas van bajo `company/`, el tope es de 20 MB y se borra con el workspace.

## Validación

Pruebas unitarias sin red:

- RUT, guardado y lectura tolerante, avance, texto para el modelo con «no sé», filtro de sugerencias y prompt;
- con base y modelo en memoria:
  - guardado solo de administradores y con revisión;
  - revisión de descartadas (solo `requisito`/`escala` abiertas, una vez por versión);
  - sugerencias desde Perfil y sitio web, sin scripts y sin el Perfil de quien no administra;
  - el prompt de la evaluación diaria con y sin ficha;
- vista renderizada de las preguntas.

Del cotejo (12b):
- un ✗ sin cita o sin dato pasa a pregunta; lo que el modelo omitió también se pregunta;
- la regla de decisión;
- encolado una vez por informe y versión, solo con ficha y solo para quien puede leer la oportunidad;
- la lectura guardada y rechazada si la ficha cambió;
- las respuestas guardadas en la ficha;
- la vista del informe con la barra, las insignias y las preguntas.

De la carpeta (12c):
- estados y textos de vencimiento en hora de Chile;
- vencimiento sugerido;
- avisos;
- texto para el modelo;
- subida solo de administradores, con validación del archivo y sin archivos huérfanos;
- descarga solo dentro del workspace;
- vistas de cada documento y del formulario.

Las pruebas pgTAP `opportunity_tender_profile.test.sql`, `opportunity_requirement_fit.test.sql` y `opportunity_company_documents.test.sql` revisan RLS, permisos, unicidad, objetos JSON, los tipos de trabajo y el borrado en cascada.
