# Propuesta comercial para Cowork · GrupoExpro

Investigación: 23 de septiembre de 2026. **Borrador para revisión humana**, no contexto aprobado ni instrucción de envío. La web pública describe capacidades del proveedor; no demuestra que una empresa destinataria tenga una necesidad, presupuesto o interés. Hasta que el equipo confirme prioridades, no elegir una oferta, sector ni remitente por defecto.

## Catálogo observado (Chile)

| Servicio | Alcance publicado | Fuente |
|---|---|---|
| Servicios transitorios (EST) | Personal temporal para reemplazos, temporadas y refuerzos de dotación; página declara cobertura en 16 regiones de Chile. | [GrupoExpro · Servicios transitorios](https://grupoexpro.com/portfolio/servicios-transitorios/) |
| Outsourcing / BPO | Procesos de atención a clientes, digitación, labores administrativas, inventario, producción, bodega, despacho y logística inversa. | [GrupoExpro · Outsourcing](https://grupoexpro.com/portfolio/servicios-outsourcing/) |
| Reclutamiento y selección | Reclutamiento, hunting, mapeo de mercado y evaluaciones psicolaborales. | [GrupoExpro · Selección](https://grupoexpro.com/portfolio/seleccion-de-personal/) |
| ExproPay | Servicio de nómina descrito para organizaciones de 100 a 500 colaboradores en Chile. | [GrupoExpro · ExproPay](https://grupoexpro.com/portfolio/expropay-externalizacion-de-nomina-precisa-y-sin-friccion/) |

**No incluir por ahora:** porcentajes de ahorro, plazos de contratación, disponibilidad de perfiles concretos, clientes de referencia, garantías de cumplimiento o prueba gratuita. La página presenta beneficios generales pero no evidencia que permita prometer un resultado individual. No usar la Ley Karin como argumento de urgencia sin necesidad observada del comprador.

## Propuesta para `message.context` (pendiente de aprobación)

- `voiceExamples` (ejemplos **propuestos**, no voz observada del usuario):
  - **Directo y consultivo:** «Hola, [nombre]. Vi [hecho verificable de su operación]. En GrupoExpro trabajamos [servicio publicado]. ¿Tiene sentido conversar sobre cómo están cubriendo [tema concreto]? Si no es tu área, ¿quién lo lleva?»
  - **Seguimiento breve:** «Hola, [nombre]. Retomo mi correo sobre [tema]. ¿Sigue siendo relevante para tu equipo o prefieres que no vuelva a escribirte?». Solo si no hubo baja ni respuesta y si las reglas de frecuencia lo permiten.
- `approvedClaims` candidatas (el equipo valida la redacción antes de aprobarlas):
  - «GrupoExpro ofrece servicios transitorios para reemplazos y refuerzos estacionales en Chile.» — Fuente: página de Servicios Transitorios arriba.
  - «GrupoExpro ofrece externalización de procesos de atención a clientes y operaciones logísticas.» — Fuente: página de Outsourcing arriba.
  - «GrupoExpro ofrece reclutamiento y selección, hunting y evaluaciones psicolaborales.» — Fuente: página de Selección arriba.
  - «ExproPay se presenta como servicio de nómina para organizaciones de 100 a 500 colaboradores en Chile.» — Fuente: página de ExproPay arriba.
- `roleCta` propuestas:
  - `decisionMaker`: «¿Te parece útil revisar durante 15 minutos si este servicio encaja con la necesidad de tu equipo?». Solicitud de reunión, no reunión acordada.
  - `user`: «¿Qué parte de [proceso] les está costando más hoy? Si no es tu decisión, puedo enviar un resumen a quien lo coordina.»
  - `referrer`: «¿Quién lleva [proceso] en tu equipo? Si te parece pertinente, ¿podrías indicarme con quién conversar?». No atribuir autoridad de compra por título.
- `verticalNotes` propuestas:
  - **retail**: «El blog público de GrupoExpro aborda la planificación de refuerzo de dotación para Navidad y reemplazos por vacaciones; úsalo como posible contexto sectorial, no como hecho sobre el destinatario.» [Artículo retail](https://grupoexpro.com/servicios-transitorios-para-navidad-como-preparar-tu-operacion-retail-para-la-temporada-alta/).
  - **logística**: «La página de Outsourcing enumera bodega, recepción, despacho y logística inversa; comprobar la operación real del destinatario antes de escoger el gancho.» [BPO](https://grupoexpro.com/portfolio/servicios-outsourcing/).
  - **recursos humanos**: «La página de Selección ofrece reclutamiento, hunting y evaluaciones; elegir solo el servicio asociado a una necesidad observada.» [Selección](https://grupoexpro.com/portfolio/seleccion-de-personal/).
- `trialOffer`: **sin configurar**; ninguna oferta gratuita comprobada.
- `defaultStyleProfileId`: **sin configurar**; no hay estilo aprobado propio.
- `requiredTerms`: ninguna palabra obligatoria global; la pertinencia depende del servicio.
- `prohibitedTerms` sugeridos para mensajes nuevos: «garantizado», «sin riesgo», «gratis», «100 % de cumplimiento», «únicos». Revisión editorial: impedir promesas absolutas, no bloquear innecesariamente citas del comprador.

## Ejemplos de primer contacto (solo borrador)

**EST · Retail, operación estacional.** Asunto: «Refuerzo de equipos para temporada alta». «Hola, [nombre]. Vi [señal verificable con fecha y fuente de la empresa]. GrupoExpro ofrece servicios transitorios para reforzar dotación en retail y logística durante períodos de mayor demanda. ¿Están evaluando refuerzos para [área/fecha] o no es una prioridad ahora? Si te sirve, podemos revisar el contexto en una llamada breve.»

**BPO · Operaciones.** Asunto: «Consulta sobre [proceso concreto]». «Hola, [nombre]. En GrupoExpro apoyamos procesos de [atención / inventario / despacho; elegir uno] mediante outsourcing. No conozco cómo lo están gestionando ustedes; ¿es un tema que estén revisando? Si no lo ves tú, ¿quién coordina ese proceso?»

**Selección · Personas.** Asunto: «Búsqueda de [perfil observado]». «Hola, [nombre]. Vi [vacante o cambio real, con fuente]. GrupoExpro trabaja reclutamiento, selección y hunting. ¿Tiene sentido conversar sobre esa búsqueda o ya la tienen cubierta?»

Cada ejemplo requiere identificación real del destinatario, señal reciente y remitente confirmado. No usar `[...]` como contenido final. Para un email real, añadir firma, canal de baja y revisión de reglas de contacto de la app. No disparar campañas a partir de estos ejemplos.
