# Cowork · corpus de marketing y recetas por intención (26 sep 2026)

## Por qué

Los 14 casos de producción ya pasaban completos (14/14) y no distinguían mejoras. Se escribieron 11 casos nuevos como los pediría un usuario nuevo de ANTON.IA que quiere prospectar por correo y LinkedIn. Con ellos se iteró el prompt usando el modelo real.

La cuenta de prueba es chica a propósito:
- 5 contactos guardados;
- 4 con correo;
- ninguna campaña y un solo correo enviado.

Los nombres son ficticios y completos: con nombres enmascarados («Ro***s») el modelo inventaba apellidos.

## Casos nuevos

Archivo: `scripts/fixtures/cowork-marketing-corpus.ts`.

| Caso | Pedido | Qué se exige, además de las 6 verificaciones comunes |
|---|---|---|
| `mkt-que-puedes-hacer` | «hola! soy nuevo aca, que puedes hacer por mi?» | Menciona correos o campañas y LinkedIn, en 12 líneas como máximo, sin preguntar qué vende |
| `mkt-campana-rrhh` | «quiero mandarle un correo a mis contactos de rrhh ofreciendo axis» | Busca el grupo; muestra el correo o propone la campaña; solo con contactos de RR. HH. con correo; sin [corchetes] |
| `mkt-secuencia` | «armame una secuencia de 3 correos… tono cercano» | 3 correos en un documento, firmados con el nombre del perfil, sin prueba gratuita no aprobada |
| `mkt-linkedin-mensaje` | «escribele a marcela por linkedin…» | Propone el mensaje de LinkedIn, breve y sin relleno |
| `mkt-linkedin-invitar` | «invita a felipe de securitas…» | Revisa el cupo semanal y propone la invitación |
| `mkt-a-quien-escribo` | «a quien le escribo hoy? tengo poco tiempo» | Nombra al menos dos contactos; no manda escribir por correo a quien no tiene correo |
| `mkt-mejorar-correo` | «mejorame este correo: …el mejor del mercado… 80%…» | Entrega la versión nueva, sin esas promesas y concreta con AXIS |
| `mkt-busqueda-y-campana` | «busca 10 gerentes de rrhh… y despues armame una campaña» | Propone la búsqueda de 10 y explica que la campaña viene después |
| `mkt-necesito-clientes` | «nesesito mas clientes pa axis, ayuda» | Entiende pese a las faltas, aterriza en la cuenta y parte por quienes ya tienen correo |
| `mkt-resultado-campana` | «como le fue a mi campaña?» | Revisa campañas; dice que no hay; ofrece crear la primera |
| `mkt-seguimiento` | «marcela no me respondio el correo, que le mando ahora?» | Revisa lo enviado; redacta el seguimiento firmado, sin reprochar ni anunciar cierre |

Cada caso tiene su respuesta ideal en `scripts/cowork-conversation-corpus.test.ts`. Esa respuesta pasa todas sus verificaciones por el bucle real, sin modelo.

## Qué se cambió

**Prompt** (`src/lib/cowork/agent-instructions.ts`):
- **Recetas de correo y LinkedIn,** al estilo de las intenciones de LeadAce: «¿qué puedes hacer?», «mándale un correo a…», «¿a quién le escribo hoy?», «mejora este correo», «no me respondió» y «¿cómo le fue a mi campaña?». Cada una dice qué consultar en paralelo y qué entregar.
- **Toda redacción** usa la oferta de `app.context` y la firma de `profile.get`, consultadas juntas.
- **«Vender más / necesito más clientes»:** parte por los contactos que ya tienen correo y después completa correos.
- **«Qué tengo pendiente»:** también propone escribir a contactos con correo que aún no se contactaron. Si preguntan a quién escribirle, se usa la receta «¿A quién le escribo hoy?».
- **Regla 10:**
  - si piden redactar, reescribir, resumir o analizar, se entrega en la misma respuesta, sin preguntar si se hace;
  - si piden escribirle a una persona por LinkedIn, se propone el mensaje con el texto listo y explicado (los correos a un grupo siguen su receta);
  - lo que se anuncia va completo;
  - una limitación no bloquea la entrega.

**Bucle** (`src/lib/cowork/agent-loop.ts`), sobre la corrección de cierre del PR de respuestas sugeridas:
- La corrección cubre también **dos o más correos escritos en el chat**: deben ir en un documento.
- El pedido de corrección **nombra lo que ya estaba bien** (el documento y las sugerencias) para conservarlo.
- **Nunca deja el turno peor que la primera respuesta:**
  - el reintento se pide con `mustAnswer`;
  - si vuelve a consultar o no es válido, se queda la primera respuesta;
  - si pierde el documento o las sugerencias, se recuperan.

  En una corrida intermedia, un trabajo falló porque el reintento se puso a consultar y se quedó sin turnos. Esto lo evita.
- **Búsqueda propuesta sin explicación:** la tarjeta recibe una nota armada con los criterios («Propongo buscar hasta 25 personas con cargos como…, del rubro…, en…»). Sin esto quedaba sin texto al lado de la aprobación.

**Saneo de sugerencias** (`src/lib/cowork/answer-quality.ts`): se descartan las que traen un relleno entre corchetes («AXIS ayuda a [describe…]»).

**Verificaciones del corpus corregidas.** No se debilitó ninguna; tenían falsos negativos:
- `ultimos-guardados`: proponer directamente la búsqueda de correos, con tarjeta, también cumple «ofrece completar los correos». Antes solo aceptaba una pregunta.
- En los casos nuevos, las verificaciones de «prueba gratuita» y «promesas sin respaldo» miran solo el correo. La explicación («quité el 80 %», «no agregué prueba gratuita») no cuenta.

## Mediciones con el modelo real

gpt-6-luna, bucle real, lecturas de fixture. Producción son los 14 casos de producción; marketing son los 11 nuevos.

| Iteración | Producción | Marketing | Verificaciones | Cierre completo |
|---|---|---|---|---|
| Línea base (prompt del PR de sugerencias) | — | 15/22 | 181/188 | 13/13 |
| Recetas de correo y LinkedIn | 28/28 | 15/22 | 413/422 | 33/33 |
| «Entrega sin preguntar» y resultados de campaña | 28/28 | 15/22 | 414/422 | 31/32 |
| Oferta y firma juntas; lo anunciado va completo | 27/28 | 17/22 | 414/422 | 32/33 |
| Receta de seguimiento; verificación de `ultimos-guardados`; 3 repeticiones | 41/42 | 30/33 | 628/633 | 49/51 |
| Correos en documento; lecturas en paralelo para campañas | 42/42 | 28/33 | 626/633 | 50/53 |
| El reintento nombra lo que conserva | 40/42 | 25/33 | 615/633 | 46/50 (1 trabajo falló) |
| La corrección no degrada; la regla 10 incluye acciones | 40/42 | 26/33 | 623/633 | 53/56 |
| **Final: regla 10 acotada a LinkedIn, nota de búsqueda y «¿a quién le escribo?»** | **40/42** | **33/33** | **631/633** | **55/55** |

Desde la fila de 3 repeticiones cada caso se corre tres veces: 42 corridas de producción y 33 de marketing. «Cierre completo» cuenta las respuestas sin propuesta que terminan con pregunta y traen sugerencias. La corrida final usó 168 llamadas para 75 casos (2,2 por caso), sin trabajos fallidos.

Las dos fallas de la corrida final son variación de casos de producción que ya ocurría antes:
- `reintento-enriquecer`: redactó el correo en vez de proponer primero la investigación.
- `metricas-semana`: usó la palabra «cobertura».

Entre corridas con el mismo código hay variación de hasta 5 casos, así que conviene medir siempre con 3 repeticiones.

La línea base usó las verificaciones iniciales. Desde la segunda fila se agregaron firma, oferta real y primera campaña, así que las cifras de marketing no se comparan uno a uno con la primera fila.

Leyendo las respuestas, además de las verificaciones:
- **«¿Qué puedes hacer?»:**
  - antes: lista genérica sin LinkedIn ni datos;
  - ahora: tres puntos con la cuenta real («5 contactos, 4 con correo») y un primer paso.
- **«Mándale un correo a RR. HH.»:**
  - antes: «¿Preparo el borrador?»;
  - ahora: el correo completo, los 3 destinatarios con correo y Andrea fuera por no tener correo.
- **«¿A quién le escribo hoy?»:**
  - antes: solo el seguimiento a Marcela;
  - ahora: Felipe, Rodrigo y Camila, que tienen correo y nunca recibieron nada, más el seguimiento de Marcela aparte.
- **«Mejora este correo»:**
  - antes: vago («soy Yago»);
  - ahora: concreto con AXIS, firmado y con una línea de qué se quitó.

## Pendientes

- **Firma y oferta cuestan lecturas.** Con 3 consultas por turno, un seguimiento necesita el contacto, lo enviado, la oferta y la firma. Incluir nombre, empresa y oferta en el contexto base de cada turno lo resolvería (hoja de ruta, punto 2).
- **Variación del modelo:** en algunas corridas falta LinkedIn en «¿qué puedes hacer?» o se propone buscar prospectos antes que escribir a los contactos existentes.
- **Un conteo equivocado:** en una corrida dijo «3 de 5 con correo» cuando eran 4. Ninguna verificación léxica lo detecta.
