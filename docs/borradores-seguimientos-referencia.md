# Seguimientos que no repiten el hecho de la empresa (8 oct 2026)

## Problema

En una secuencia, los pasos 2 a 4 abrían con el mismo hecho del primer correo:

- «En una faena minera con más de 2.000 trabajadores entre propios y contratistas, cubrir un turno el mismo día…»
- «En una faena minera con más de 2.000 trabajadores, entre propios y contratistas, los contratos de personal temporal…»
- «En una faena minera con más de 2.000 trabajadores, entre propios y contratistas, la dotación temporal…»

Dos intentos anteriores (Plan 16) solo cambiaban reglas de redacción y no mejoraron la lectura ciega.

## Causa

El prompt pedía lo mismo en cada correo, también en los seguimientos:

- «ANCLA FACTUAL: el hecho … debe quedar reconocible… conserva al menos dos de estos términos: faena, minera, trabajadores,
  contratistas»;
- «integra el hecho primario en un motivo concreto para escribir»;
- «opening aporta un detalle factual».

La verificación (`hasGroundedPersonalization`, `src/lib/server/draft-preflight-v2.ts`) solo exige dos términos del hecho en una
misma oración: «para la faena minera» ya cumple. Pero el prompt empujaba al modelo a repetir la oración entera.

## Cambio

`src/ai/flows/generate-outreach-from-report.ts`. En los correos posteriores al inicial:

- **Ancla factual:** basta una referencia breve, de 2 a 5 palabras, con dos términos del hecho («para la faena minera», «con las
  tiendas nuevas»), dentro de la frase del enfoque nuevo. No repite la oración, las cifras ni los detalles del primer correo, y no
  abre el correo con ese hecho.
- **Estrategia:** el motivo para escribir es el enfoque nuevo, es decir, la capacidad aplicada a un momento concreto del trabajo del
  destinatario.
- **Estructura:** `opening` abre con el enfoque de ese correo, no con el hecho del destinatario.

El correo inicial no cambia. La verificación tampoco cambia: sigue exigiendo los dos términos en cada correo.

`src/lib/native-draft-version.ts`: `native-draft/v22`.

## Medición

4 casos de secuencia (ServiPro retail y minería; AXIS retail y construcción), 3 corridas por versión, con `gpt-6-luna`: 12
secuencias y 36 seguimientos por versión.

| | Antes | Ahora |
|---|---|---|
| Seguimientos cuya primera frase repite la apertura del inicial (3 o más palabras) | 35 de 36 | 10 de 36 |
| Seguimientos que repiten una cifra del inicial | 5 de 36 | 2 de 36 |
| Pasos válidos | 47 de 48 | 48 de 48 |

Otra sesión de Claude leyó a ciegas las 24 secuencias mezcladas, 6 por caso, sin saber cuál era cuál:

| | Antes | Ahora |
|---|---|---|
| Posición media (1 = mejor de 6) | 4,25 | 2,75 |
| Mejor secuencia del caso | 0 de 4 | 4 de 4 |
| Buenas / mejorables / malas | 0 / 7 / 5 | 2 / 10 / 0 |
| La enviaría tal cual | 0 de 12 | 2 de 12 |
| Avance entre correos (1 a 5) | 2,33 | 2,83 |
| Naturalidad | 2,00 | 2,50 |
| Concreción | 2,50 | 2,50 |
| Veracidad | 4,92 | 4,50 |

Lo que baja la veracidad: a veces la referencia breve se pega a otra idea y sugiere un vínculo que no existe. Por ejemplo, «Con la
temporada de Navidad, un cliente en piloto ya usa AXIS a diario» (el piloto no tiene que ver con Navidad), o «En Minera Cascada,
ServiPro pone dotación temporal» (se lee como si ya trabajaran ahí).

## Ajuste: la referencia no crea vínculos falsos (`native-draft/v23`)

El ancla de los seguimientos agrega que la referencia acompaña lo que harías para ellos («para las obras del Biobío, revisamos…»). No
se pega a una prueba ni a otra idea con la que no tiene relación, y no sugiere que ya trabajas con su empresa.

Mismos 4 casos, 3 corridas, contra la versión anterior (#280). Lectura ciega de otra sesión de Claude, 24 secuencias:

| | #280 | Con el ajuste |
|---|---|---|
| Posición media (1 = mejor de 6) | 4,17 | 2,83 |
| Mejor secuencia del caso | 0 de 4 | 4 de 4 |
| Buenas / mejorables / malas | 0 / 8 / 4 | 0 / 11 / 1 |
| Veracidad (1 a 5) | 3,50 | 4,00 |
| Avance / concreción / naturalidad | 2,42 / 2,33 / 2,17 | 2,58 / 2,58 / 2,42 |
| Pasos válidos | 48 de 48 | 47 de 48 |

El evaluador de esta ronda fue más estricto con la veracidad que el anterior; la comparación vale dentro de la ronda.

Queda pendiente, según los evaluadores:

- con una oferta de un solo servicio (AXIS), los correos 3 y 4 vuelven a describir la oferta con la misma frase («consultas
  judiciales automáticas… sin trámites manuales»);
- ningún seguimiento usa el volumen o el plazo de la señal (300 trabajadores, 150 vendedores) para aterrizar el beneficio;
- falta un paso más fácil, como ver un ejemplo o probar con pocos casos;
- el cierre repite la propuesta del primer correo.

Sin migraciones ni flags. Los borradores ya generados no cambian.
