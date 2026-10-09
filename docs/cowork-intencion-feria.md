# Cowork: «los de la feria» lee el archivo subido (8 oct 2026)

## Problema

Ante «armame una campaña para los de la feria que todavia no tengo guardados», Cowork buscaba «feria» entre los contactos guardados y
pedía adjuntar la lista, aunque el archivo ya estaba subido. Una lectura ciega lo calificó como mala.

La causa: el enrutado por intención (`intents.ts`) solo activa la parte de archivos si la petición dice «archivo», «Excel», «CSV»,
etc. «La feria» no activaba esa parte, así que Cowork no tenía la receta de archivos ni de importar contactos.

## Cambio

`src/lib/cowork/intents.ts`: la intención `files` también se activa con feria, evento, congreso, seminario, webinar, asistentes y
listado. Prueba nueva en `intents.test.ts`.

## Medición

`importar-para-escribir`, con `gpt-6-luna`: 4 de 5 sin el cambio, 5 de 5 con él. Además, 4 casos de archivos e importación
(`importar-para-escribir`, `importar-feria`, `archivo-a-quien`, `importar-excel`), 2 veces cada uno: 8 de 8.

Sin migraciones ni flags.
