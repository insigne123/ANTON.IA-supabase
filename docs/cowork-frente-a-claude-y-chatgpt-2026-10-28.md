# Cowork frente a Claude y ChatGPT: lo que debería tener y lo que tiene (28 de octubre de 2026)

La meta es que Cowork funcione como Claude Cowork o el agente de ChatGPT: que reciba un encargo, lo lleve hasta el final y pida permiso solo para lo que cambia algo o gasta. Esta página lista lo que tienen esos productos y dice, para cada punto, si Cowork lo tiene hoy. Después ordena lo que falta.

**De dónde sale cada respuesta:**

- el código de `main` (`6d414571`);
- las banderas de producción en `apphosting.yaml`;
- los datos de producción de los últimos 14 días, leídos sin escribir nada.

**Cómo se lee la tabla:** «Sí» está en producción. «En parte» existe pero le falta algo que se nota. «No» no existe.

## Cómo se usa hoy

Últimos 14 días:

- **Uso:** 61 turnos en 26 conversaciones, de 7 personas.
- **Fallas:** 5 turnos fallaron, todos el 20 y el 21 de octubre, antes de pasar al harness con Haiku 5.5. Desde el 26 de octubre hubo 10 turnos y ninguno falló.
- **Duración de un turno,** desde que la persona envía hasta que llega la respuesta o la tarjeta: 39 s en la mediana y 146 s en el 10 % más lento. Incluye la cola, el modelo y las herramientas.
- **Tarjetas de aprobación:** se pidieron 26.
  - 16 se aprobaron y 1 se rechazó.
  - **9 quedaron sin respuesta (35 %).** Son 7 lotes de «preparar contactos», 1 investigación y 1 búsqueda. La persona no volvió a la conversación, o no entendió que Cowork esperaba algo.
- **Sin uso real todavía:** nadie ha aprobado una tarea larga, delegado a subagentes ni programado desde el chat. Están encendidas desde el 27 de octubre.

## El listado

### 1. Conversar

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| La respuesta aparece mientras se escribe | Sí | `COWORK_STREAMING_ENABLED` |
| Detener una respuesta | Sí | Botón «Detener» |
| Escribir mientras trabaja | Sí | El mensaje queda en espera y se puede editar antes de que salga |
| Editar un mensaje enviado y ver sus versiones | Sí | |
| Pedir otra versión de una respuesta | Sí | |
| Copiar una respuesta | Sí | |
| Dictar por voz | Sí | |
| Conversar por voz (hablar y escuchar) | No | No hace falta para el trabajo comercial |
| Listas, tablas y gráficos en la respuesta | Sí | |
| Preguntar con opciones cuando falta un dato | Sí | `COWORK_CLARIFICATIONS_ENABLED` |
| Sugerir cómo seguir | Sí | Respuestas sugeridas bajo cada turno |
| Sugerencias para empezar y acciones rápidas | Sí | Según el estado de la cuenta |
| Plantillas con «/» y menciones con «@» | Sí | «@» busca entre los contactos guardados |
| Atajos de teclado | Sí | |
| Primera respuesta en pocos segundos | En parte | Un turno tarda 39 s en la mediana. El texto aparece mientras se escribe, pero llega tarde |

### 2. Archivos y entregables

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| Adjuntar archivos | Sí | CSV, JSON, Markdown, texto, Excel, PDF, Word e imágenes |
| Leer imágenes y PDF escaneados | Sí | `COWORK_DOCUMENT_VISION` |
| Entregar un documento de Word o PDF | Sí | Por ejemplo, el informe del mes |
| Entregar una planilla Excel o CSV | En parte | Se exportan listas y resultados. Una planilla armada a pedido, con versiones, no |
| Entregar una presentación | No | |
| Páginas y código en un panel, con versiones | Sí | `COWORK_CODE_ARTIFACTS_ENABLED` y versiones de documentos |
| Editar el entregable ahí mismo | En parte | Correos y campañas se editan antes de aprobarlos. Para cambiar un documento hay que pedirlo de nuevo |

### 3. Herramientas y conexiones

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| Buscar en la web, con fuentes | Sí | `COWORK_WEB_ENABLED`. Cada búsqueda cuesta US$0,01 |
| Leer una página | Sí | |
| Ejecutar código en un entorno aislado | Sí | Con aprobación, en el ejecutor remoto |
| Subagentes que trabajan en paralelo | Sí | `COWORK_SUBAGENTS_ENABLED`: delega en las Investigadoras |
| Usar un navegador o el computador | No | LinkedIn va por la extensión. No está en los planes |
| Correo | En parte | Lee el historial de un contacto en Gmail y envía desde la cuenta conectada. No busca en toda la bandeja |
| Calendario | No | COW-07. Requiere agregar el permiso en las consolas de Google y Microsoft |
| Drive u OneDrive | No | |
| Slack, Teams o WhatsApp | No | |
| CRM externo (HubSpot, Salesforce) | No | El CRM es el de ANTON.IA |
| Conectores propios (MCP) | No | No hace falta por ahora |

### 4. Trabajar en varios pasos

Esto es lo que distingue a un «cowork» de un chat.

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| Usar varias herramientas por turno, varias lecturas a la vez | Sí | Harness con Haiku 5.5 |
| Mostrar el plan y el paso en curso | Sí | «Tarea en curso» bajo el último turno |
| Aprobar un plan una vez y que siga solo, dentro de su gasto | Sí | Sin uso real todavía |
| Seguir trabajando si la persona cierra la pestaña | Sí | El trabajo corre en el servidor |
| Avisar cuando termina algo largo o cuando espera una aprobación | No | Hoy solo aparece «Aprobar» en la lista de conversaciones. El aviso por correo se descartó. Falta un aviso dentro de la app y del navegador |
| Elegir entre aprobar cada paso o dejarlo avanzar | Sí | Modo con aprobación y modo automático |
| Pedir permiso antes de cambiar algo o gastar, con el costo a la vista | Sí | Las tarjetas dicen cuánto cuesta y cuántos créditos quedan hoy |
| Aprobar muchas cosas juntas | Sí | Lotes de hasta 50 personas |
| Deshacer | En parte | Se puede pausar o detener una campaña, y eliminar una conversación con «Deshacer». No hay un «deshacer» general |
| Tareas que se repiten, también pedidas en el chat | Sí | |
| Recordatorios de una sola vez («el jueves a las 10») | No | Solo hay frecuencias: todos los días, días hábiles, semanal y mensual |
| Recuperarse de un error | Sí | Reintento automático y modelo de rescate |
| Terminar el encargo completo | En parte | En el banco de tareas: 4 de 8 terminados y 2 a medias (`docs/cowork-como-claude-cowork.md`) |

### 5. Memoria y orden

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| Memoria entre conversaciones, que la persona ve y borra | Sí | «Lo que Cowork recuerda» |
| Instrucciones de la persona (oferta, tono, firma) | Sí | Ficha de la empresa y preferencias |
| Proyectos: conversaciones agrupadas con sus propias instrucciones y archivos | No | Serviría por cliente o por campaña |
| Conocer el estado de la cuenta | Sí | La agenda de hoy y los conteos (`COWORK_WORKSPACE_ENABLED`) |
| Conversaciones largas sin perder el hilo | Sí | Resumen del hilo y limpieza del contexto |
| Listar, buscar, renombrar, fijar y eliminar conversaciones | Sí | |
| Compartir una conversación con el equipo | No | |
| Seguir en otro dispositivo, también en el teléfono | Sí | |

### 6. Confianza, seguridad y costos

| Lo que tienen Claude y ChatGPT | Cowork | Nota |
| --- | --- | --- |
| No inventar y decir de dónde sale cada dato | En parte | Muestra fuentes de la web y evidencia de los contactos. La jueza está apagada (`COWORK_JUDGE_ENABLED=false`) y el banco todavía encuentra afirmaciones sin respaldo |
| Que lo leído en la web o en un archivo no dé órdenes | Sí | Ese contenido va cercado, y un turno que leyó la web no se aprueba solo |
| Límite de gasto por persona | Sí | Créditos del día por persona y por equipo |
| Permisos por organización | Sí | Cada persona ve solo lo de su organización |
| Calificar una respuesta | Sí | |
| Exportar lo trabajado | Sí | |
| Modo claro y oscuro, teclado y lector de pantalla | Sí | Revisiones de contraste y recorridos visuales |

### 7. Lo que Claude y ChatGPT no tienen

Esto es lo que justifica usar Cowork y no un chat general:

- buscar personas y empresas (Apollo, LinkedIn, empresas que contratan, licitaciones);
- guardar sin duplicar y respetando los leads adjudicados a otro integrante;
- buscar correo y teléfono, investigar a cada persona y escribirle con la Redactora;
- crear, activar, pausar y reintentar campañas, y responder en el mismo hilo;
- anotar en el CRM, asignar responsables y cerrar oportunidades;
- «¿Qué toca hoy?», «¿Cómo voy?» y el informe del mes;
- todo con los créditos y los permisos de cada persona.

## Lo que falta, en orden

1. **Que nada quede esperando sin que la persona lo sepa.** Es lo que más se nota: el 35 % de las tarjetas quedó sin respuesta.
   - Un aviso dentro de la app, y del navegador si la persona lo permite, cuando un turno termina o espera una aprobación.
   - «Esperando tu aprobación» al entrar a Cowork y en «Hoy», con un enlace a la tarjeta.
   - Que cada tarjeta diga en una línea qué pasa si se aprueba y qué si no.
   - Sin correo: ya se decidió no enviarlo.
2. **La primera respuesta en pocos segundos.**
   - Medir dónde se van los 39 s de un turno: cola, contexto, modelo y herramientas.
   - Mostrar de inmediato qué está haciendo.
   - Aligerar el contexto: hoy cada llamada lee unos 62.000 tokens. Las reglas de cada capacidad deberían llegar solo cuando se usan.
3. **Terminar más encargos.** El banco termina 4 de 8.
   - Contexto más liviano.
   - Medir con la Redactora de producción (Luna), no con Haiku.
   - Revisar las afirmaciones sin respaldo antes de responder.
4. **Recordatorios de una sola vez** («recuérdame el jueves a las 10 escribirle a Ana»). Aprovecha las tareas programadas: es una frecuencia más.
5. **Calendario (COW-07):** proponer horarios cuando alguien pide una reunión. Requiere el permiso en las consolas de Google y Microsoft, y que cada persona reconecte su correo.
6. **Proyectos:** agrupar conversaciones de un cliente o una campaña con sus instrucciones y archivos.
7. **Compartir una conversación** con alguien del equipo.
8. **Planillas y presentaciones** como entregable, con versiones.

**No está en los planes:** usar un navegador o el computador, conversar por voz y conectores propios (MCP).

## Revisión de lo hecho el 27 y el 28 de octubre

Antes de seguir se revisó lo que se hizo esos días. Se encontraron 10 problemas, corregidos en tres PR:

- **Leads adjudicados (insigne123/ANTON.IA-supabase#579, en `main`):**
  - la búsqueda de adjudicados leía todos los contactos de la organización por cada fila guardada, y una importación de 1.000 filas pasaba el límite de 8 s;
  - a quien ya tenía a una persona se le mostraba «Adjudicado a otro»;
  - un LinkedIn mal escrito podía botar la pantalla, y uno con tildes no coincidía;
  - el enriquecimiento con Apollo daba un error genérico en vez de decir a quién está adjudicada la persona.
  - La migración `20261028130000_lead_claims_lookup_indexed.sql` falta aplicarla en producción.
- **Créditos y lotes de Cowork (insigne123/ANTON.IA-supabase#580):**
  - un saldo que no se pudo leer aparecía como cupo lleno;
  - el plan de una tarea no contaba sus búsquedas;
  - una búsqueda de correo rechazada por el límite de 60 por minuto quedaba cobrada y «sin confirmar»;
  - las respuestas conocidas del proveedor quedaban sin cerrar.
- **Oportunidades por país (insigne123/ANTON.IA-supabase#581):**
  - «Peru, Indiana» contaba como Perú;
  - avisos guardados de Colombia conservaban una región chilena.
