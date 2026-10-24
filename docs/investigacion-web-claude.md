# Investigación con la web de Claude (23 oct 2026)

**Qué es:** un investigador (un Claude con búsqueda web) que, antes de leer las páginas de una investigación, elige cuáles vale la pena leer: noticias de los últimos meses, avisos de empleo con fecha, licitaciones, cambios de gerencia. **No entrega hechos, entrega direcciones.** La investigación las lee con su propia lectura segura, interpreta sus fechas y extrae los hechos, igual que con las páginas que rankea el buscador. Todo lo que dice el informe sigue saliendo de una página que ANTON.IA leyó.

**Encendido en producción desde el 24 de octubre de 2026** (`RESEARCH_CLAUDE_WEB_ENABLED="true"` en `apphosting.yaml`, con Haiku y esfuerzo bajo); en el código sigue apagado por defecto. El registro de la decisión de producto dice «Serper y OpenAI»; esto es una pieza que se suma a esa búsqueda, no la reemplaza: las páginas que rankea Serper se leen igual, después de las que el investigador eligió. Qué se midió con Haiku, qué se leyó y por qué se encendió está abajo y en `docs/funciones-apagadas-encendidas-2026-10-24.md`.

## Cómo se enciende

| Variable | Valor por defecto | Qué hace |
| --- | --- | --- |
| `RESEARCH_CLAUDE_WEB_ENABLED` | apagado | `true` lo enciende (también requiere `ANTHROPIC_API_KEY`) |
| `RESEARCH_CLAUDE_WEB_MODEL` | `claude-haiku-5-5` | modelo del investigador (Sonnet y Opus están bloqueados en el código) |
| `RESEARCH_CLAUDE_WEB_EFFORT` | `low` | `low`, `medium` o `high` |
| `RESEARCH_CLAUDE_WEB_SEARCHES` | 6 (1–10) | búsquedas como máximo por investigación |
| `RESEARCH_CLAUDE_WEB_FETCHES` | 3 (0–6) | lecturas de página del investigador como máximo |
| `RESEARCH_CLAUDE_WEB_SOURCES` | 8 (1–12) | páginas que entrega, como máximo |
| `RESEARCH_CLAUDE_WEB_DEADLINE_MS` | 45000 | después de esto entrega lo que tiene |
| `RESEARCH_CLAUDE_WEB_BASIC` | `true` | las herramientas web sin filtrado dinámico (ver abajo) |

Si el investigador falla o se pasa de tiempo, la investigación sigue sin él (advertencia `claude_web_unavailable`). Encenderlo cambia la huella de caché de la investigación (`claudeWebSources`), así que no mezcla resultados con y sin investigador.

## Qué entra y qué no

- Al investigador se le dice la empresa, su sitio, el país, **el cargo y el área de la persona** y lo que vende el vendedor. Nunca el nombre de la persona.
- Solo se aceptan direcciones que la API devolvió en esa ejecución (resultados o páginas leídas). Una dirección que el modelo «recuerda» se descarta, también las redes sociales, los videos y la portada del sitio de la empresa.
- **Una página que eligió y que no nombra a la empresa no se usa** (24 de octubre). Una búsqueda por nombre también encuentra homónimos, y un hecho sobre otra empresa terminaría en un correo a esta. La investigación lee cada página, así que busca el nombre de la empresa (sin forma legal ni país) o la dirección de su sitio como palabras completas; una página del propio sitio siempre pasa. Si no lo dice, no se lee para extraer hechos, queda el aviso `claude_web_page_off_topic` y `researchMetrics.claudeWeb.offTopic` cuenta cuántas fueron (`src/lib/server/company-mention.ts`). Las páginas del buscador no pasan por esta puerta.
- Las páginas elegidas se leen primero; después las que rankea Serper, con el presupuesto de páginas de siempre.

## Medido (23 oct 2026, 8 empresas chilenas, cargo «Gerente de Personas», oferta AXIS)

Ejecución real de `gatherReportV2Research` con Luna para resolver, planificar y extraer, y un juez Opus que dice cuántos hechos de los últimos 6 meses sirven de motivo para escribir hoy. **No había clave de Serper en esta máquina**, así que la comparación es contra «solo el sitio de la empresa» (varios sitios responden 503 o están hechos con JavaScript), **no contra producción**.

| | páginas | hechos | hechos de los últimos 6 meses | señales útiles (juez) | utilidad (1–5) |
| --- | --- | --- | --- | --- | --- |
| Solo el sitio | 0,6 | 2 | 0 | 0 | 1,0 |
| Con el investigador (`low`) | 5,9 | 81 | 57 | 2,6 | 3,0 |
| Con el investigador (`medium`) | 5,9 | 73 | 57 | 2,9 | 3,3 |

- `low` hace 2 búsquedas y ninguna lectura (unos 8–15 s, ≈ US$0,10 por investigación). `medium` hace 3 búsquedas y 2 lecturas, comprueba homónimos y la fecha de lo que entrega (≈ US$0,25). La diferencia entre los dos cae dentro del ruido de 8 empresas: por eso el defecto es `low`.
- Lo que más entrega son avisos de empleo y notas de prensa con fecha (Enaex: vacantes de choferes y supervisores, 28-sep-2026; Sodexo: procesos masivos, 12-oct-2026; Aguas Andinas: unos 70 avisos, 8-oct-2026).
- Fallas conocidas: con un homónimo (SalfaCorp frente a Salfa, de Salinas y Fabres) `low` entregó páginas de la otra empresa y el juez lo marcó; algunas páginas que elige no se pueden leer (la lectura segura expira en bolsas de empleo como Chiletrabajos o en la CMF). Un respaldo que use el texto que Claude sí alcanzó a leer queda pendiente.

### Con Haiku (24 de octubre de 2026): lo que se encendió

Las mismas ocho empresas, el investigador con **Haiku 5.5** (`low`, herramientas básicas), sin juez: se leyeron las páginas que eligió y los hechos que salieron de ellas. Detalle empresa por empresa en `docs/funciones-apagadas-encendidas-2026-10-24.md`.

| | páginas elegidas | páginas leídas | búsquedas | costo del investigador | hechos | «recientes» (medida tosca) |
| --- | --- | --- | --- | --- | --- | --- |
| Sonnet, `low` (23 oct) | — | 5,9 | 2 | ≈ US$0,10 | 81 | 57 |
| **Haiku, `low` (24 oct)** | 4 a 8 | 5,0 | 3 | **US$0,041** (US$0,044 con la extracción de Luna) | 43 | 22 |

- **Las ocho trajeron páginas de la empresa correcta**, con fecha y de prensa, comunicados, bolsas de empleo y licitaciones; el caso del homónimo (SalfaCorp frente a Salfa) salió bien. En dos, el investigador dijo qué homónimos descartó (Besco y Besalco Stracon, GasCo de Singapur).
- **Cuesta menos de la mitad que con Sonnet y trae menos con fecha reciente** (22 contra 57 por empresa en la misma medida, que cuenta cada hecho de una página con fecha reciente). Los casos flojos: Sodexo (0 hechos con fecha, no halló los procesos masivos que Sonnet sí) y Besalco (3: una bolsa de empleo, un agregador y un PDF no se leyeron).
- **La base de producción no tiene noticias.** En los últimos 30 días hubo 59 investigaciones nativas (24 fuentes y 38 afirmaciones en promedio): 50 con señales de contratación, 39 con señales del sitio y ninguna con `news_signal`. El investigador trae lo que ahí no hay.
- **Se encendió sin la comparación con Serper**, por su costo (del orden de US$3 al mes con las ~60 investigaciones de 30 días), porque falla hacia lo que había (sin el investigador la investigación sigue igual: `claude_web_unavailable`) y porque ahora no usa páginas de homónimos. La comparación sigue pendiente (ver abajo).

### Para decidir con datos reales

Con la clave de Serper en el entorno, el mismo script compara producción contra producción más investigador (`--modes=sin,con`; con `--no-judge` no llama a ningún juez y deja en `results.json` las páginas elegidas, las leídas y cada hecho con su fecha, para leerlos):

```
SERPER_API_KEY=… OPENAI_API_KEY=… ANTHROPIC_API_KEY=… \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-sources.ts --out=/tmp/investigacion
```

`sin` usa Serper; `con` agrega el investigador. No toca la base de datos ni envía correos. Si `con` no suma señales con fecha sobre `sin`, se apaga quitando `RESEARCH_CLAUDE_WEB_ENABLED` y desplegando.

## Las herramientas web básicas

El investigador usa `web_search_20250305` y `web_fetch_20250910` (opción `basic`). **Con Haiku las de filtrado dinámico tampoco funcionan en Cowork:** devolvieron `invalid_tool_input` en las cuatro búsquedas de una pregunta de prueba (24 de octubre), y por eso `COWORK_WEB_BASIC` ahora es `true` por defecto. Las versiones nuevas con filtrado dinámico (`…20260209`) le piden al modelo que escriba código para filtrar los resultados; con Enaex, en 3 de 3 ejecuciones, ese código fallaba, el modelo lo repetía y gastaba todo el presupuesto de búsquedas en reintentos («se agotó el límite de búsquedas») tras una sola consulta real. Con las básicas hizo 3 búsquedas distintas y entregó 8 páginas. La misma opción existe para el web de Cowork (`COWORK_WEB_BASIC=true`) y `perCall` limita cuántas búsquedas puede pedir el modelo de una vez, para que mire los primeros resultados antes de seguir.
