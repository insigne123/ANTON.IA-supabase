# Plan 16 (pendiente de medir): borradores sin señal que no inventen una situación

## Problema

En la última medición del Plan 15 (ServiPro, 25 borradores, juez `gpt-6-luna`), «suena humano» quedó en 3,48 de 5, la dimensión más
baja. Los correos sin señal concreta abrían con una situación hipotética y metían en ella la ficha de la empresa:

- «Si hay un peak de dotación en la faena minera de Minera Cascada, con más de 2.000 trabajadores entre propios y contratistas, …»
- «Si aparece un peak de trabajo en una startup de pagos como PagosYa, con 90 personas, …»
- «Para una cadena de retail con 40 tiendas en la zona sur como Tiendas Ejemplo, …»

El juez los marcó «corregir»: suenan armados y plantean un problema que nadie vio. La regla del redactor pedía vincular la actividad
con el servicio «en condicional cuando corresponda», y eso empujaba a este patrón.

## Cambio propuesto

- `src/ai/flows/generate-outreach-from-report.ts`: sin señal, no abrir con una situación hipotética ni meter los datos de la empresa en
  ella. Abrir con el dato real que más le importa a lo que se vende (un crecimiento, una apertura, su escala), dicho como algo que se
  vio, o con lo que se hace aplicado a su trabajo, en presente.
- `src/lib/native-draft-version.ts`: `native-draft/v20`.

## Estado

**Sin medir.** La medición (ServiPro ×2 y AXIS ×1, en `main` y en esta rama) se cortó porque la cuenta de OpenAI de las pruebas quedó
sin créditos (`insufficient_quota`, `credit_balance_exhausted`). Esta rama no se integra hasta medirla. Para medirla, con créditos:

```
OUTREACH_EVAL_OUT=<dir> node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json OUTREACH_EVAL_OUT=<dir> node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts <dir>/outreach-eval/<fecha>
```

Se integra solo si sube «suena humano» sin bajar la veracidad ni los «listos para enviar».

`scripts/evaluate-outreach-set.ts` cuenta ahora las aperturas con situación inventada (`summary.hypotheticalOpenings`), para medir el
cambio sin depender solo del juez. En las corridas guardadas de `native-draft/v19` (ServiPro, 25 correos cada una) salieron 6, 3 y 1
de 25; en `v18`, 1 de 25. El cambio debería bajarlas a cerca de 0.
