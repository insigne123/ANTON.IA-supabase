# Cowork: la Revisora no pide {{nombre}} en un correo a una sola persona (9 oct 2026)

## Problema

En un seguimiento a una sola persona («marcela no me respondió el correo, ¿qué le mando?»), la Revisora a veces marcaba el saludo
«Hola Marcela,» como «nombre fijo en un texto que irá a varias personas» y pedía «Hola {{nombre}},». Los chequeos determinísticos
exigen lo contrario: un correo con un solo destinatario se saluda por su nombre. La corrección rompía ese chequeo y no se conservaba,
así que el correo quedaba con «puntos por revisar» por un problema que no existía. Además, se gastaba una llamada y unos segundos.

## Cambio

`src/lib/cowork/writer.ts`:

- `coworkReviewIssues` descarta los problemas de «nombre fijo» o `{{nombre}}` que la Revisora marca en un correo con un solo
  destinatario en `to` (el bloque que nombra el problema o, si hay uno, ese).
- Regla de la Revisora: el nombre de pila en el saludo de un correo con un solo destinatario no es un problema.

## Medición

`mkt-seguimiento` (y `inicio-escribir` como control) con `gpt-6-luna`:

| | Sin el cambio | Con el cambio |
|---|---|---|
| Seguimientos que quedaron «por revisar» por el saludo | 4 de 25 | 0 de 10 |
| Checks automáticos (`mkt-seguimiento`, `inicio-escribir`) | 108 de 110 | 110 de 110 |

Las 25 corridas sin el cambio vienen de cuatro mediciones de este mismo caso (dos sobre `main` y dos con otros cambios a la
Redactora que no tocan la Revisora). La muestra es chica, pero el mecanismo es determinístico: con un solo destinatario, la corrección
que pedía la Revisora nunca podía conservarse.

Sin migraciones ni flags.
