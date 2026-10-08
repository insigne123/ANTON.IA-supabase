# Plan 16: borradores sin señal que no abren con una situación inventada (8 oct 2026)

## Problema

Los correos sin señal concreta abrían con una situación hipotética y metían en ella la ficha de la empresa:

- «Si hay un peak de dotación en la faena minera de Minera Cascada, con más de 2.000 trabajadores entre propios y contratistas, …»
- «Si aparece un peak de trabajo en una startup de pagos como PagosYa, con 90 personas, …»

Suenan armados y plantean un problema que nadie vio.

## Cambio

`src/ai/flows/generate-outreach-from-report.ts`:

- Lo que no se sabe de la operación del cliente (si tiene peaks, si le falta personal, si le serviría) sigue en condicional, nunca como hecho.
- Sin señal, el correo no empieza con esa condición ni mete los datos de la empresa dentro de ella. Abre con el dato real que más le
  importa a lo que se vende o con lo que se hace aplicado a su trabajo, y deja el condicional para después.

`src/lib/native-draft-version.ts`: `native-draft/v20`. `scripts/evaluate-outreach-set.ts` cuenta las aperturas con situación inventada
(`summary.hypotheticalOpenings`).

## Medición

ServiPro, 25 correos por corrida. Los correos los calificaron a ciegas otras sesiones de Claude, sin saber cuál era cuál. Las primeras
corridas salieron con `gpt-6-sol` porque los casos son cuentas prioridad A (lo corrigió #269); después se midió con `gpt-6-luna`.

| | Actual | Esta versión |
|---|---|---|
| Aperturas con situación inventada (2 corridas por modelo) | sol 2 de 50; luna 5 de 50 | sol 0 de 50; luna 3 de 50 |
| Con sol, evaluación ciega (34 correos por lado): posición media entre 4 | 2,82 | 2,18 |
| Con sol: lo enviaría tal cual / correos con un hecho sin respaldo | 7 / 4 | 13 / 4 |
| Con luna, evaluación ciega de 6 versiones (34 por lado): posición media | 4,00 | 3,47 |
| Con luna: lo enviaría tal cual / no lo enviaría | 3 / 11 | 6 / 8 |
| Con luna: veracidad (1 a 5) / correos con un hecho sin respaldo | 4,88 / 4 | 4,79 / 6 |

Los hechos sin respaldo que suma esta versión son del mismo tipo que los de la actual: inferencias menores («puede servir para el
peak de esa apertura») calificadas 4 de 5. El error más grave («abrió» por «abrirá cinco sucursales») sale en las dos versiones.

El juez automático de borradores (`gpt-6-luna`) vio lo mismo en «suena humano» (3,44 → 3,64) y en «enviar» (19 → 21 de 50), pero
contó más hechos sin respaldo (6 → 12 de 50): marca como hecho lo dicho como posibilidad («la carga podría aumentar»).

## Lo que se probó y no quedó

La primera versión quitaba el «en condicional cuando corresponda». El modelo pasó a afirmar necesidades del cliente como hechos: la
veracidad del juez bajó de 4,66 a 4,36 y «enviar» de 19 a 13 de 50.

Sin migraciones ni flags.
