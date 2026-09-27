# Cowork · tarjetas de correo, secuencia, tabla y cifras (26 sep 2026)

Segundo PR de la Ola A del plan de Cowork (punto 1.1: bloques estructurados en la respuesta).

## Qué cambia para el usuario

Lo que se copia, se revisa o se compara ya no llega enterrado en el texto: llega como tarjeta.

| Tarjeta | Cuándo aparece | En el chat | Al abrirla (panel lateral) |
|---|---|---|---|
| **Correo** | Un correo listo para enviar o mejorar | Asunto, primeras líneas y a quién va; «Copiar correo» | Para, asunto y cuerpo, cada uno con su botón de copiar |
| **Secuencia** | 2 a 7 correos con su día de envío | Un paso por línea («Día 1», «Día 4»…); «Copiar secuencia» | Cada correo con su día y cuántos días después del anterior |
| **Tabla** | 4 o más elementos comparables (a quién escribir, segmentos) | Las primeras 5 filas; «Descargar CSV» y «Copiar tabla» | La tabla completa |
| **Cifras** | Números con su período («¿cómo voy?») | Siempre abierta, sin panel: valor grande, qué es y sobre cuántos | — |

- El texto de la respuesta presenta las tarjetas en 1 a 3 frases, sin repetirlas.
- «Copiar tabla» pega como tabla en una planilla o un documento. El CSV abre bien en Excel, con tildes, y neutraliza fórmulas igual que la exportación de contactos.
- En escritorio, una secuencia o una tabla de 6 filas o más se abre sola en el panel cuando el turno termina mientras miras.
- Los turnos anteriores se ven igual que antes.

## Cómo funciona

- **Contrato:** `answer.blocks` es opcional, con hasta 4 tarjetas de tipo `email_draft`, `sequence`, `table` o `metrics` (`src/lib/cowork/contracts.ts`). El esquema acepta tamaños generosos, para que una tabla grande no haga fallar toda la respuesta. Después se recorta a lo que muestra una tarjeta.
- **Saneo** (`coworkBlocks` en `answer-quality.ts`):
  - mismo texto limpio que la respuesta, sin UUID;
  - una secuencia de un solo correo pasa a ser tarjeta de correo, y los pasos se ordenan por día;
  - hasta 7 pasos, 8 columnas, 50 filas y 6 cifras;
  - títulos por defecto si faltan.
- **Bucle** (`agent-loop.ts`):
  - los correos dentro de tarjetas cuentan como entregados;
  - una tarjeta con `[relleno]` pide una corrección;
  - si el reintento pierde las tarjetas, se recuperan.
- **Prompt:** la regla 11 dice cuándo usar cada tarjeta. Las recetas de secuencia, mejorar un correo, seguimiento y «¿cómo voy?» las usan.
- **Historial:** el turno siguiente ve las tarjetas del anterior, así «usa el segundo correo» funciona (`conversation-context.ts`).
- **Interfaz:**
  - `src/components/cowork/CoworkBlocks.tsx`: tarjetas del chat y vista del panel;
  - `src/lib/cowork/blocks.ts`: texto para copiar, CSV, TSV y nombres de archivo;
  - `presentation.ts`: cada tarjeta es un artefacto del panel, salvo las cifras.

No hay migración: las tarjetas viajan en `run.completed`.

## Validación

**Modelo real** (gpt-6-luna, bucle real, lecturas de fixture, 31 casos con 3 repeticiones = 93 ejecuciones), el mismo día contra el PR anterior (pregunta aparte). Ambos se califican con las verificaciones de este PR:

| | PR anterior | Este PR |
|---|---|---|
| Casos | 80/93 | **91/93** |
| Verificaciones | 812/825 | **823/825** |
| Marketing (correo y LinkedIn) | 24/33 | **33/33** |
| Respuestas con tarjetas | — | 26/93: 15 de correo, 6 de cifras, 3 de secuencia, 2 de tabla |
| Consultas por caso | 1,83 | **1,69** |
| Llamadas al modelo por caso | 2,26 | **2,09** |
| Turnos que terminan con error | 0 | 0 |

- **Las verificaciones nuevas exigen la tarjeta** en 4 casos: la secuencia, mejorar un correo, el seguimiento y las cifras de la semana. Por eso el PR anterior pierde casos. Sin esas 12 verificaciones, los dos quedan casi iguales: 1 y 2 fallas.
- **Fallas restantes**, de contenido y ajenas a las tarjetas (1 de 3 cada una):
  - `recomendacion-hoy` repitió una consulta del turno anterior;
  - `linkedin-seguimiento` no explicó cómo sincronizar LinkedIn. También falla a veces en el PR anterior.
- **Dos verificaciones del corpus estaban mal** y se corrigieron:
  - Al buscar la oferta en un correo mejorado, se cortaba en el primer «Nicolás». Ahora se corta en la firma, así que «Soy Nicolás, de Yago» ya no oculta el resto.
  - «José» con tilde no contaba como dato de la cuenta.

**Pruebas sin modelo:**
- `answer-quality.test.ts`: saneo de tarjetas.
- `agent-loop.test.ts`: correos en tarjetas cuentan como entregados; el relleno pide corrección.
- `blocks.test.ts`: texto para copiar, CSV con tildes y sin fórmulas, nombres de archivo.
- `presentation.test.ts`: tarjetas como artefactos.
- El corpus sin modelo pasa con las respuestas ideales en tarjetas.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local):
- Escritorio claro y oscuro (1440 px) y teléfono (390 px): cifras, correo, secuencia y tabla se ven; la pregunta queda aparte; sin scroll horizontal.
- La secuencia abre en el panel con sus 3 pasos.
- «Descargar CSV» baja `a-quien-le-escribo.csv`.
- No se envió nada (0 POST).

## Pendientes

- **Editar antes de aprobar** (punto 1.2 del plan): editar el correo o la secuencia en el panel y usar esa versión.
- **Gráficos y listas de pasos** (`chart`, `checklist`): quedan para la Ola B, con la Analista.
- **Exportar a XLSX y DOCX** desde la tarjeta: hoy es CSV y copiar.
