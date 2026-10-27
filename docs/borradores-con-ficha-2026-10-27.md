# Borradores con la ficha de la empresa (27 de octubre de 2026)

La evaluación del 24 de octubre (APP-16) decía que lo que más ayudaría a los borradores no era código sino el Perfil: con una sola propuesta y ninguna prueba, el redactor repite la misma frase. Desde el 26 de octubre las organizaciones tienen la «Ficha de la empresa» (APP-06) y GrupoExpro la tiene completa. Esta página mide si cambió algo.

## Cómo se midió

- **Banco:** los 20 casos de `scripts/fixtures/outreach-eval-set.json` (14 en frío, 3 objeciones, 2 secuencias y 1 reconexión). Son de servicios transitorios y outsourcing, el rubro de GrupoExpro. Dos corridas por variante.
- **Dos vendedores, mismos casos:**
  - *Antes:* el perfil típico de un integrante de GrupoExpro antes de la ficha. Un servicio escrito en una sola línea con comas, una propuesta de valor genérica de una frase, una descripción de una línea y ninguna prueba.
  - *Con la ficha:* la misma persona con lo que hoy lee el borrador. Son los 13 servicios de la ficha, su propuesta de valor, 7 pruebas, 9 dolores, 6 diferenciadores, la descripción, el sector y el cliente ideal.
- **Redactor y juez:** Haiku 5.5 (`OUTREACH_EVAL_MODEL` y `OUTREACH_JUDGE_MODEL`). En producción escribe Luna; la clave de OpenAI de esta sesión estaba vencida. El 23 de octubre se midió que Haiku, Sonnet y Opus escriben al mismo nivel (`docs/cowork-claude-evaluacion-2026-10-23.md`), así que la comparación entre perfiles vale. El nivel absoluto puede diferir del de Luna.
- **Ajuste del juez:** `scripts/judge-outreach-set.ts` ahora cuenta como hechos permitidos los diferenciadores y los clientes de referencia del vendedor, además de su descripción, servicios, propuesta y pruebas. Sin eso, un correo que dice «un solo proveedor para personal, facility y seguridad» se penalizaba como inventado aunque esté en la ficha.
- **Costo:** unos US$0,25 entre generación y juicio.

## Resultado

| | Antes (perfil delgado) | Con la ficha |
| --- | --- | --- |
| Muestras juzgadas (2 corridas) | 42 | 39 |
| Suena humano (1–5) | 3,31 | 3,28 |
| Especificidad (1–5) | 3,26 | 3,38 |
| Veracidad (1–5) | 4,00 | **4,41** |
| Tono y tratamiento (1–5) | 4,17 | 4,33 |
| Un solo pedido (1–5) | 4,74 | 4,87 |
| «Enviar» | 5 (12 %) | 8 (21 %) |
| «Corregir» | 14 | 22 |
| «Revisión humana» | 23 (55 %) | **9 (23 %)** |
| Bloqueados por el preflight | 7 | 7 |

- **La ficha baja a menos de la mitad los correos que hay que revisar a mano** (de 55 % a 23 %) y sube la veracidad. Con un perfil de una línea, el redactor rellena con generalidades («optimizar su gestión») o se apoya en cifras que el juez no puede respaldar. Con la ficha tiene pruebas y diferenciadores reales que citar.
- **No suenan más humanos** (3,3 en ambos). Eso es del redactor, no del perfil: el puente entre el hecho y la oferta sigue sonando forzado, como ya se había visto el 23 de octubre.
- **«Enviar» sube poco** (de 5 a 8). La mayoría pasa de «revisión humana» a «corregir»: siguen necesitando retoques, pero de redacción y no de veracidad.
- Las diferencias de un punto o dos en las notas medias están dentro del ruido de una corrida (±0,3). La de veracidad y la de «revisión humana» se repiten en las dos corridas.

## Qué sigue

1. **Que los equipos llenen la ficha.** Es lo que más mueve, y en GrupoExpro ya está. PSOL también la tiene; las demás organizaciones no.
2. **Medir con Luna** cuando la sesión tenga una clave de OpenAI vigente: `OUTREACH_EVAL_SET=<set> OUTREACH_EVAL_OUT=<dir> node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts` y después `scripts/judge-outreach-set.ts <dir>`.
3. **El «suena humano»** sigue siendo del redactor. Lo que ya se descartó (otro modelo, un editor encima, elegir entre varios) no lo mueve. Lo que queda por probar es que el correo diga menos: una idea por correo en vez de hecho, oferta y prueba juntos.

## Cómo repetirlo

Los dos conjuntos son el de siempre con otro `seller`. Se arman con el perfil de la persona y con la ficha que lee `loadSellerProfile`; no se guardan en el repositorio porque traen el texto del perfil de una persona.

```
OUTREACH_EVAL_MODEL=claude-haiku-5-5 OUTREACH_JUDGE_MODEL=claude-haiku-5-5 ANTHROPIC_API_KEY=... \
  OUTREACH_EVAL_SET=set-ficha.json OUTREACH_EVAL_OUT=out node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
OUTREACH_JUDGE_MODEL=claude-haiku-5-5 ANTHROPIC_API_KEY=... OUTREACH_EVAL_SET=set-ficha.json \
  node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts out/outreach-eval/<fecha>
```
