# Investigación con la web de Claude (23 oct 2026)

**Qué es:** un investigador (un Claude con búsqueda web) que, antes de leer las páginas de una investigación, elige cuáles vale la pena leer: noticias de los últimos meses, avisos de empleo con fecha, licitaciones, cambios de gerencia. **No entrega hechos, entrega direcciones.** La investigación las lee con su propia lectura segura, interpreta sus fechas y extrae los hechos, igual que con las páginas que rankea el buscador. Todo lo que dice el informe sigue saliendo de una página que ANTON.IA leyó.

**Apagado por defecto.** El registro de la decisión de producto dice «Serper y OpenAI»; esto es una pieza opcional detrás de una bandera.

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

### Para decidir con datos reales

Con la clave de Serper en el entorno, el mismo script compara producción contra producción más investigador:

```
SERPER_API_KEY=… OPENAI_API_KEY=… ANTHROPIC_API_KEY=… \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-sources.ts --out=/tmp/investigacion
```

`sin` usa Serper; `con` agrega el investigador. No toca la base de datos ni envía correos.

## Las herramientas web básicas

El investigador usa `web_search_20250305` y `web_fetch_20250910` (opción `basic`). Las versiones nuevas con filtrado dinámico (`…20260209`) le piden al modelo que escriba código para filtrar los resultados; con Enaex, en 3 de 3 ejecuciones, ese código fallaba, el modelo lo repetía y gastaba todo el presupuesto de búsquedas en reintentos («se agotó el límite de búsquedas») tras una sola consulta real. Con las básicas hizo 3 búsquedas distintas y entregó 8 páginas. La misma opción existe para el web de Cowork (`COWORK_WEB_BASIC=true`) y `perCall` limita cuántas búsquedas puede pedir el modelo de una vez, para que mire los primeros resultados antes de seguir.
