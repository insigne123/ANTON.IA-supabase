# Borradores: el servicio que responde a la señal (8 oct 2026)

## Problema

Con una señal concreta, los borradores ofrecían casi siempre el servicio principal del vendedor y su lema, aunque la señal apuntara a
otro. En el banco de ServiPro:

- Ante «la Dirección del Trabajo anunció fiscalización de acreditación de contratistas», todos ofrecían dotación temporal; el servicio
  que responde a esa señal es la administración laboral (contratos, anexos y finiquitos).
- «El costo se va con el peak» aparecía en 20 de 25 correos, también ante renuncias o rotación, donde no hay peak.

Lo notó el evaluador independiente en dos rondas ciegas.

## Cambio

`src/ai/flows/generate-outreach-from-report.ts`:

- con señal, el correo ofrece la capacidad del vendedor que responde a ella, aunque no sea la primera de su lista, y dice en una frase
  por qué;
- si ninguna responde, la señal queda como contexto, sin forzar la conexión;
- no repite el lema de la propuesta de valor cuando no calza.

`src/lib/native-draft-version.ts`: `native-draft/v21`.

## Medición

ServiPro con `gpt-6-luna`, 2 corridas por versión (34 correos por lado sin contar secuencias). Calificó a ciegas otra sesión de Claude,
sin saber cuál era cuál:

| | Actual | Con la regla |
|---|---|---|
| Posición media (1 = mejor de 4) | 2,68 | 2,32 |
| Mejor versión del caso | 6 de 17 | 11 de 17 |
| Servicio pertinente (1 a 5) | 3,35 | 3,47 |
| Veracidad (1 a 5) | 4,88 | 4,94 |
| Suena humano (1 a 5) | 2,88 | 2,76 |
| Lo enviaría tal cual / no lo enviaría | 8 / 8 | 7 / 7 |
| Correos con el lema del peak | 40 de 50 | 36 de 50 |

En la fiscalización, la mejor versión con la regla ofrece la administración laboral (servicio pertinente 4 contra 1). Ante renuncias, ofrece el
reemplazo de turnos el mismo día (5 y 5 contra 4 y 3). El efecto es moderado: en rotación de cajeros y en una startup que crece de forma
permanente sigue ofreciendo dotación temporal.

Sin migraciones ni flags.
