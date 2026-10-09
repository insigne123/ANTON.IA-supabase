# Cowork: «otra industria» la elige el usuario (9 oct 2026)

## Problema

Con «quiero buscar prospectos nuevos en otra industria para axis», Cowork elegía la industria por su cuenta (casi siempre retail)
y proponía la búsqueda sin consultar nada: en 3 de 5 corridas. La regla 9 ya decía que «en qué industria buscar» se pregunta con
opciones, pero la regla 5 (decidir con un valor razonable) y la 4 (proponer la acción en el mismo turno) le ganaban.

## Cambio

`src/lib/cowork/agent-instructions.ts`, regla 9 (opciones): buscar prospectos en «otra industria», «otro rubro» o «un sector nuevo»
sin nombrarlo es un dato del usuario, no un valor razonable. Cowork no la elige ni propone la búsqueda: consulta el perfil y pregunta
en cuál buscar, con 3 a 5 industrias que calcen con la oferta y que no sean las que ya trabaja.

## Medición

Con `gpt-6-luna`:

| | Antes | Con la regla |
|---|---|---|
| `opciones-industria` (checks del caso) | 2 de 5 | 5 de 5 |
| Lectura ciega del caso (1 a 5, 5 respuestas por lado) | 2,60 | 4,20 |
| Respuestas que deciden por el usuario | 3 de 5 | 0 de 5 |
| `inicio-prospectos` (control: busca con lo que ya sabe) | 5 de 5 | 5 de 5 |
| `mkt-necesito-clientes` (control) | 4 de 5 | 4 de 5 |

El lector independiente (otra sesión de Claude) leyó las 10 respuestas mezcladas y con etiquetas anónimas. El fallo de
`mkt-necesito-clientes` es el mismo check intermitente en ambos lados («parte por quienes ya tienen correo»). Según el lector,
queda pendiente: frases robóticas al pedir el dato («no tengo una industria nueva indicada»).

Sin migraciones ni flags.
