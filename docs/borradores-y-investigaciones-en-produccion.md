# Lo que muestran los borradores y las investigaciones reales de producción (23 de octubre de 2026)

Todo esto sale de consultas de solo lectura sobre producción (`yfdelflsheurzaicwayi`), agregadas: no se leyeron correos de personas ni se escribió nada. Sirve para decidir con datos de uso real y no solo con el banco de ocho empresas. Los números son de un día (23 de octubre); dos organizaciones concentran casi todo el uso reciente, así que son una señal, no una estadística.

## Borradores

- **148 borradores**: 108 pendientes de aprobación y 40 listos. De las 113 versiones que escribió un modelo (`messaging_draft_generation_metadata`, en 109 borradores), **ninguna se aprobó tal cual**; una se aprobó después de una revisión manual y las demás siguen pendientes. Los otros 39 listos son de campañas masivas con plantillas (`bulk_campaign_id`): no pasan por el modelo y por eso no tienen metadatos. No es una conclusión de calidad (los borradores pueden usarse por otra vía), pero es lo primero que habría que mirar.
- **Intentos de la versión actual (`native-draft/v23`, 9 a 23 de octubre)**: 105 de 130 intentos (81 %) no pasaron la verificación (`unsupported_material_claim` 96 veces, `personalization_invalid` 24, `tone_asunto` 15, `tone_tratamiento` 9). Pero están concentrados: **ocho investigaciones suman los 130 intentos**, una de ellas 40 seguidos en 77 minutos y otra 16 seguidos, y ninguna de las dos pasó. El problema no es parejo: hay investigaciones cuya evidencia no permite escribir un correo verificable, y el sistema reintenta sin decir por qué.
- **Avisos que ve la persona** (25 borradores recientes): «Revisa la legibilidad» 18 (era falso en los seguimientos y el cierre; PR 507), «La investigación es parcial» 12, «Revisa la relevancia comercial» 9, «person public evidence missing» 8, «official site http 403» 4, «official site content generic» 4.
- Cada intento de la versión actual cuesta unos 16.500 tokens de entrada y 3.000 de salida (más de 2.700 de razonamiento); los reintentos, unos 17.000 de entrada.

## Investigaciones (`research_snapshots`, 93)

| Qué | Cuántas afirmaciones | En cuántas investigaciones |
| --- | --- | --- |
| Empiezan con la cola de un número («000 metros…», «390 millones…» donde la página dice 1.390) | 57 de 2.827 | 17 (18 %). Corregido en el PR 508 |
| Formularios, «resuelva la adición: 2 + 7», temas de administración, índices de blog con «Leer más» | 47 de 2.827 | 6 de 88 |
| Muertes, accidentes graves o desastres como hecho de la empresa («se constató el fallecimiento de ambos trabajadores») | 68 de 2.827 | 21 de 88 (24 %) |

Ningún borrador de producción menciona hoy una tragedia (0 de 152): el riesgo es latente, no ocurrido. Lo que cambia este trabajo es que esas afirmaciones se quedan en la investigación (quien vende debe saberlas y tener cuidado) pero **no se ofrecen al redactor como evidencia**, ni en el camino de la instantánea ni en el del informe v2 ni en la cosecha de señales.

## Informes (`research_report_documents`)

El camino anterior (`native-research-report-synthesis/v8` y `v9`) dejó 118 informes `partial` el 14 y 15 de octubre; el informe v2 (`report-v2/runtime`) tiene 37 `completed` entre el 9 de septiembre y el 23 de octubre y pocos `partial` o fallidos.

## Qué sugiere

1. **Investigar mejor antes que escribir mejor.** Los avisos de cobertura (sin evidencia pública de la persona en 8 de 25, sitio oficial que responde 403 en 4 de 25, contenido genérico en 4 de 25) coinciden con lo que mide `docs/senales-de-la-investigacion-al-correo.md`: lo que separa un buen correo de uno flojo es la evidencia. El investigador de páginas con la web de Claude (PR 497, apagado) lee las páginas desde la infraestructura de Anthropic, no desde la nube de la app, que algunos sitios bloquean con 403; es una hipótesis que conviene probar con una cuenta antes de encender.
2. **Decir por qué un borrador no sale.** Con 40 reintentos seguidos sobre una investigación, la persona debería ver «la evidencia de esta empresa no alcanza» y no un botón que reintenta.
3. **Volver a investigar** los leads de las 17 investigaciones con cifras cortadas, cuando se despliegue el PR 508.

## 12 de noviembre: por qué los primeros correos no salían, y el arreglo

En los 30 días al 12 de noviembre, de 56 generaciones de primer correo se guardaron 14. Las otras 42 eran de seis investigaciones (cinco de una misma organización), y el código casi siempre era `unsupported_material_claim`: 118 veces, contra 4 de `personalization_invalid`. Los seguimientos y los cierres sí salían (26 de 30 y 13 de 19).

Repetimos en local dos de esas investigaciones con el código de producción y el modelo real, sin base de datos ni envíos, y con los datos fuera del repositorio. Antes del arreglo se guardó 1 borrador de 7. Después, 14 de 14, casi todos al primer intento. Las dos fallaban por lo mismo: **el control de negaciones y condiciones miraba la evidencia completa**. Si la evidencia tenía un «no», un «sin» o un «podría» en cualquier parte, rechazaba toda oración que compartiera dos palabras con ella y no lo repitiera:

- «organización **no** gubernamental (ONG)»: el «no» es parte del nombre, y cada oración sobre las campañas de la ONG se rechazaba por no decir «no»;
- «a primera vista el caso **podría** parecer una cuestión procesal»: un comentario del autor, al lado del hecho («la Corte declaró inconstitucional…»), obligaba a la oración sobre el fallo a decir «podría».

El mensaje que recibía el reintento, «La redacción elimina una condición o negación material de la evidencia», no decía qué oración ni qué parte de la evidencia. Por eso el reintento repetía el error y la persona volvía a intentar sin éxito.

Lo que cambió (`src/lib/server/draft-preflight-v2.ts`, `src/lib/server/native-drafts.ts`):

1. **La negación o la condición cuenta solo sobre lo que gobierna.** Se mira la cláusula de la evidencia que la oración usa, y solo las palabras que siguen al «no», «sin», «planea», «prevé» o «podría». Rechazar sigue siendo la regla cuando la oración afirma eso sin el calificativo: «Acme no opera sedes regionales» frente a «Acme opera sedes regionales». No cuentan «no obstante», «sin embargo» ni «no solo». Un plan dicho en futuro («abrirá una sede») sigue siendo un plan.
2. **El mensaje dice qué oración y qué cláusula chocan**, y qué palabra conservar. Así el reintento puede corregirlo.
3. **Si después del reintento lo único que falla es una o dos oraciones con una cifra o una afirmación sin respaldo, el borrador se guarda sin ellas**, siempre que lo que queda pase todos los controles de nuevo. Quitar una oración nunca agrega una afirmación. Si la cifra está en el asunto o en la oración en que se apoya el correo, el borrador sigue bloqueado. El intento queda registrado como válido con el código `claim_sentence_removed`.
