# Cómo se mide un cambio en Cowork: lectura ciega

Cada cambio a Cowork se mide con el modelo real (`gpt-6-luna`) y lo lee a ciegas un lector independiente: otra sesión de Claude
que solo ve un archivo con las respuestas mezcladas y etiquetas anónimas. Se integra solo lo que mejora la lectura. El lector no
gasta créditos de OpenAI. Los checks automáticos del banco completan la medición, pero no la reemplazan: un correo puede pasar
todos los checks y seguir siendo genérico.

## 1. Correr la base y el candidato

Cada versión en su propio worktree (base: `main`; candidato: la rama), con los mismos casos y repeticiones. Con
`--repeat` sobre 5, el script corre 5. Corren en paralelo sin problema.

```sh
COWORK_OFFERED_READS_ENABLED=true COWORK_TASKS_ENABLED=true COWORK_WORKSPACE_ENABLED=true COWORK_PREFERENCES_ENABLED=true \
COWORK_EXTERNAL_SEARCH_ENABLED=true COWORK_CONTACTS_IMPORT_ENABLED=true COWORK_MODEL=gpt-6-luna COWORK_RESCUE_MODEL=gpt-6-luna \
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --artifacts --preferences \
  --max-calls=400 --repeat=5 --cases=inicio-escribir,mkt-secuencia --output=/ruta/base.json
```

Para comparar versiones del banco con casos nuevos, el caso nuevo va en la base también (se copia el fixture).

## 2. Lo que se cuenta sin leer

```sh
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts stats /ruta/base.json /ruta/candidato.json
```

Cuenta correos, mezcla de tú y usted, secuencias que cierran dos veces con la misma pregunta y cautelas («sin asumir…»). Sirve para
detectar, no para decidir.

## 3. Mezclar y leer

```sh
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts mix /ruta/ciego.md /ruta/clave.json A=/ruta/base.json B=/ruta/candidato.json
```

`ciego.md` trae todas las respuestas agrupadas por caso, en orden al azar, como R01, R02…, con el pedido, la respuesta, la pregunta
final, los botones y los correos. `clave.json` dice cuál es cuál y **no se le da al lector**. Instrucciones para el lector (un agente
Claude nuevo, sin contexto):

> Lee SOLO este archivo: `<ruta>/ciego.md`. No abras ningún otro archivo ni busques en el repositorio. Trae N respuestas de un
> asistente, de versiones distintas mezcladas al azar; no intentes adivinar cuál es cuál. Ponte en el lugar de quien escribió el
> pedido […criterios del caso…]. Da una nota de 1 a 5 (5 = justo lo que necesitaba) y los problemas con estas etiquetas: […].
> Escribe JSON válido en `<ruta>/notas.json` con la forma `{"R01": {"score": 4, "issues": ["…"], "nota": "una frase citando el
> texto"}}`. Sé exigente y consistente dentro de cada caso.

Las etiquetas que más sirvieron: `generico`, `rodeos`, `trato_mixto`, `pregunta_repetida`, `enumera_funciones`, `oferta_repetida`,
`cautela_innecesaria`, `jerga`, `frase_rara`, `largo`, `inventa`, `decide_por_mi`, `no_hace_lo_pedido`.

```sh
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts score /ruta/clave.json /ruta/notas.json
```

Da la media por versión y por caso, y cuántas veces salió cada problema.

## 4. Cambios determinísticos: lectura por pares

Una limpieza del texto (`polishCoworkAnswer`) no necesita volver a llamar al modelo: se aplica a respuestas reales ya medidas y se
compara cada original con su versión limpia.

```sh
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts pairs /ruta/pares.md /ruta/clave.json offer /ruta/*.json
```

El lector dice, por par, si prefiere A, B o igual. Si la regla se ajusta con esas preferencias, se valida con respuestas nuevas antes
de integrarla.

## Cuidados

- Muestras chicas (3 a 6 corridas por caso): un caso que falla 2 de 5 puede ser ruido. Para un efecto raro, sumar mediciones o crear
  un caso del banco que lo provoque.
- El lector cambia de escala entre lecturas: compara versiones dentro de la misma lectura, no medias de lecturas distintas.
- En un worktree no uses `git reset --soft origin/main`: `origin/main` es compartido entre worktrees y puede haber avanzado, y el
  commit revertiría lo que entró entre medio. Usa la base con la que creaste el worktree (`git merge-base HEAD origin/main`).

Prueba del script: `node --loader ./scripts/ts-test-loader.mjs --test scripts/cowork-blind-read.test.ts`.
