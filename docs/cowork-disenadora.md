# Cowork · la Diseñadora: artefactos a medida (Plan 12, PR 3b)

Con `COWORK_CODE_ARTIFACTS_ENABLED=true`, Cowork escribe el código de un artefacto a medida (un tablero, el pipeline en un gráfico, una lista que se filtra, una ficha) y lo muestra en el lienzo, al lado del chat. El motor seguro donde corre es el del PR 3a (`docs/cowork-artefactos-codigo.md`).

Hay una regla que no cambia: **el modelo escribe el diseño y la lógica, y las cifras salen de los datos**. Las pone el servidor en `antonia.data` y la página las calcula al abrirse. El código no trae ninguna cifra, nombre ni fecha escritos a mano.

Sin el flag, `artifact.create` no existe: el coordinador no lo ve en sus instrucciones y el ciclo lo rechaza.

## Un turno con artefacto

1. **El coordinador decide `artifact.create`** con un encargo `design`:
   - `title`: qué es y de qué período o para quién;
   - `goal`: qué debe dejar ver o decidir, en palabras simples y sin cifras;
   - `tables`: de una a tres tablas;
   - `previous` y `change`: solo para cambiar un artefacto anterior.

   No necesita leer los datos antes: el servidor los pone completos.
2. **La Diseñadora** (`src/lib/server/cowork/designer.ts`) recibe el encargo y lo que trae cada tabla:
   - las columnas;
   - cuántas filas hay;
   - un resumen calculado en el servidor: cuántas filas tiene cada etapa o estado, sumas y rango de fechas;
   - cinco filas cortas de muestra.

   Escribe el `html`, el `css` y el `js`, la respuesta para el chat y las respuestas sugeridas. Usa el rol `writer` del presupuesto, con hasta 6.000 tokens de salida.

   - **La respuesta del chat:** abre con la conclusión que muestran los datos, con cifras del resumen que el tablero también muestra. En una versión nueva abre con qué cambió y, si era un error, con qué lo causaba y cómo quedó.
   - **Sin pregunta final:** el artefacto es la respuesta. El paso siguiente va como la primera respuesta sugerida, escrita como pedido y posible con esos datos («Busca los correos de los 3 contactos sin correo»).

     En las mediciones, el juez castigaba la pregunta de cierre después de un tablero («¿Apruebas buscar correos?») como un paso no pedido.
3. **Revisión del código:** `buildCoworkArtifactDocument` lo revisa (3a). Si lo rechaza, la Diseñadora recibe los problemas y su código y lo corrige **una vez**, siempre que quede tiempo en el turno. Si vuelve a fallar:
   - antes de la última decisión, el coordinador se entera y responde en el chat con una tabla o con cifras;
   - en la última decisión, el turno dice que no pudo y ofrece intentarlo de nuevo con un clic.
4. **Dónde se guarda** (`artifact-store.ts`): la página va al prefijo del turno en el bucket privado `cowork-artifacts`, como `artifact-<clave>-vN.html`. El evento `artifact.created` registra:
   - `kind: 'code'`;
   - el título;
   - la clave y la versión;
   - las tablas, con cuántas filas trae cada una.

   El código va aparte, en `….code.json`. Ese archivo nunca se registra ni se sirve: solo lo lee la Diseñadora para hacer la versión siguiente.
5. **En pantalla:**
   - el chat muestra la respuesta y una tarjeta compacta del artefacto («Artefacto · versión N · Pipeline (36 filas)»);
   - la línea de actividad dice «Diseñó un artefacto»;
   - al terminar el turno, el lienzo lo abre solo.

## Los datos (`artifact-data.ts`)

| Tabla | Qué trae | De dónde sale |
|---|---|---|
| `pipeline` | Cada contacto guardado con:<br>• su etapa, en el orden del proceso (`stage_order`; «Nuevos» si no tiene);<br>• el responsable;<br>• el próximo paso y su fecha;<br>• el monto, solo si existe la columna del PR 4b | `leads`, cruzado con `unified_crm_data` |
| `contacts` | Cargo, empresa, rubro, ubicación, si tiene correo o LinkedIn, estado y fecha | `leads` |
| `activity` | Envíos de los últimos 180 días: canal, asunto, si respondió y cómo, si rebotó | `contacted_leads` |
| `campaigns` | Nombre, estado, destinatarios y correos | `bulk_campaigns` |
| `opportunities` | Licitaciones, Compra Ágil, empresas contratando y proyectos SEIA | Las funciones de «Oportunidades», solo para quien tiene acceso |

- **Límites:** cada tabla trae hasta 2.000 filas y lo dice cuando se corta. Los contactos y las campañas son los de la persona; los envíos y el pipeline, los de su organización.
- **Sin datos de contacto:** nunca van direcciones de correo ni teléfonos; basta saber si los hay.
- **En español:** los estados llegan como los muestra la app («Borrador», «Pausada», «Respondió»), nunca en inglés.

## Fechas

`antonia.meta.today` es el día en que se armó el artefacto, en la hora de Chile. Con él se calculan:

- `agg.inMonth(filas, columna, "AAAA-MM")`: las filas de un mes; sin mes, el de `today`;
- `agg.since(filas, columna, días)`: las de los últimos N días.

La Diseñadora no usa `new Date()`: así el tablero muestra los datos del día en que se hizo, aunque se abra una semana después.

## Pedir cambios y arreglar

- **«Pedir cambios»**, al pie del lienzo, manda `Cambia el artefacto «Título» (artifact-…-vN.html): <cambio>`.
- **«Arreglarlo»**, en la barra de error, manda `Arregla el artefacto «Título» (…): falló con «…» en la línea L de su código.`
- **En el chat** («al gráfico del pipeline agrégale un filtro por empresa»): el historial de la conversación trae los artefactos de cada turno, con su nombre y su título, y el coordinador los encuentra ahí.

En todos los casos, el coordinador pone `previous` y `change`. La Diseñadora recibe el código de esa versión y entrega la siguiente con la misma clave (v2, v3…). Si `previous` no corresponde a un artefacto de las conversaciones de la persona, se rechaza.

## El lienzo (`CoworkArtifactPanel.tsx` y `CoworkCodeArtifact.tsx`)

- **El marco:** un iframe con `sandbox="allow-scripts"`, de origen opaco, servido por `/api/cowork/runs/[id]/artifacts?view=1` con la CSP del sandbox.
- **El tema:** sigue el de la app con un mensaje, sin recargar la página.
- **El encabezado:** el título, un selector de versión (todas las de la misma clave) y «Descargar». El HTML descargado funciona sin conexión.
- **Mientras carga:** «Dibujando el artefacto…». Si la página no avisa que está lista, se muestra igual a los 6 segundos.
- **Si falla:** aparece «Este artefacto falló», con el mensaje, la línea y el botón «Arreglarlo».
- **Si intenta salir de su página:** se detiene y ofrece descargar el archivo para revisarlo.

## Variables

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `COWORK_CODE_ARTIFACTS_ENABLED` | apagada | Habilita `artifact.create` y la Diseñadora |
| `COWORK_DESIGNER_MODEL` | `COWORK_WRITER_MODEL`, y si no, `COWORK_MODEL` | El modelo de la Diseñadora |

No necesita migración: usa el bucket, los eventos y el rol `writer` que ya existen.

## Cómo se mide

```bash
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --artifacts --shots \
  --max-calls=90 --cases=ur-tablero-mes,ur-pipeline-grafico,art-prospectos-filtro,art-tablero-campanas,art-cambio-boton,art-cambio-chat,art-arreglar \
  --repeat=2 --output=salida.json
node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts --live --judge-model=gpt-6-sol --max-calls=20 \
  --input=salida.json --output=salida-juez.json
```

- **`--artifacts`** enciende `artifact.create` como lo hace el flag. Los datos de cada artefacto salen del mundo del caso: los contactos guardados, sus etapas, las campañas y los envíos.
- **Al final**, cada página se dibuja en Chromium (`scripts/fixtures/cowork-artifact-render.ts`) en claro y oscuro a 1280 px y en claro a 390 px. Se registra si arrancó sin errores, el texto que se lee, el desborde a 390 px y axe en los dos temas.
- **`--shots`** guarda además las capturas junto a los HTML, en `salida-artifacts/`.
- **El juez** lee el texto visible del artefacto junto con la respuesta del chat.
- **Los casos de artefactos** están en `scripts/fixtures/cowork-artifact-corpus.ts`:
  - lista que se filtra;
  - tablero de campañas;
  - «Pedir cambios»;
  - cambio pedido en el chat;
  - «Arreglarlo».

## Resultados con el modelo real (6 oct 2026)

**Configuración:** coordinador y Diseñadora con `gpt-6-luna`, juez `gpt-6-sol`. Siete casos: `ur-tablero-mes`, `ur-pipeline-grafico` y los cinco `art-*`. La medición final repite cada uno tres veces (21 turnos).

| | Primera prueba (3 pedidos visuales × 2) | Segunda (7 casos × 2) | Final (7 casos × 3) |
|---|---|---|---|
| Artefactos que se dibujan sin errores | 4/4 | 14/14 | 20/20 |
| … a la primera, sin corrección | 4/4 | 13/14 | 20/20 |
| Sin desborde a 390 px y axe limpio en claro y oscuro | 4/4 | 14/14 | 20/20 |
| Verificaciones | — | 120/120 | 181/183 |
| Juez: buena / mejorable / mala | 0 / 0 / 6 | 10 / 2 / 2 | 20 / 1 / 0 |
| Fricción media (1 a 5) | 2,0 | 3,9 | 4,95 |
| Duración del turno (mediana) | 24 s | 20 s | 24,6 s (la Diseñadora, 19,7 s) |

- **Turno sin artefacto:** en la medición final, 1 de los 21 turnos lo respondió en el chat con una tabla, y el juez lo calificó «buena».
- **Las 2 verificaciones que fallaron** eran respuestas sugeridas con etiquetas de más de 40 caracteres, que el chat descarta. Ahora se acortan en una palabra (`coworkDesignerSuggestions`, con su prueba).
- **Gasto de la medición final:** 44 llamadas, unos 667.000 tokens de entrada (93 % en caché) y 48.000 de salida.

### Lo que se corrigió en el camino

Cada fila es una medición con el modelo real.

| Problema | Arreglo |
|---|---|
| El tablero del mes mostraba «1 al 6 de octubre»: contaba desde la fecha del navegador y no desde la de los datos | `antonia.meta.today`, `agg.inMonth` y `agg.since` |
| Estados en inglés («draft») | Los datos llegan en español |
| La respuesta del chat no decía la conclusión, o inventaba que «ninguno avanzó» | Resumen de cada tabla calculado en el servidor, y solo cifras que el tablero también muestra |
| «Arreglarlo» no decía qué falló | El encargo de una edición pide abrir con qué cambió o qué causaba el error |
| La pregunta final después de entregar el tablero («¿Apruebas buscar correos?») era la principal fricción para el juez | Sin pregunta final: el paso siguiente va en la primera respuesta sugerida |
| «Nuevos» se partía en la tabla y aparecía la columna auxiliar del orden de etapas | CSS de las celdas y regla de columnas |

## Lo que falta (3c)

- **Más ejemplos:** cuatro más para la Diseñadora (tablero de una campaña, licitaciones por monto y cierre, ficha de una cuenta y comparación de segmentos).
- **El juez de artefactos:** se dibuja sin errores, axe limpio, sin desborde a 390 px, las cifras del texto están en los datos y una rúbrica de utilidad y claridad.
