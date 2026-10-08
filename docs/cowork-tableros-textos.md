# Tableros de Cowork sin «Mostrar 0 más» ni «1 categorías» (8 oct 2026)

## Problema

Una lectura ciega de 21 casos de uso real encontró textos rotos en los tableros que arma Cowork:

- **«Mostrar 0 más (quedan 0)»** aparecía bajo tablas que ya mostraban todas sus filas. El código oculta ese botón con el atributo
  `hidden`, pero el estilo `.btn{display:inline-flex}` le gana al estilo del navegador para `[hidden]`, así que el botón seguía en
  pantalla.
- **«Gráfico de barras con 1 categorías»**, **«Embudo con 1 categorías»** y, en la tarjeta del chat, **«· 1 categorías»**.

## Cambio

- `src/lib/cowork/artifact-runtime.ts`:
  - la regla `[hidden]{display:none!important}` hace que todo lo oculto quede oculto, también un botón;
  - «Mostrar más» queda sin texto cuando no quedan filas;
  - el resumen de cada gráfico dice «1 categoría» o «N categorías», y en un embudo «etapa» o «etapas».
- `src/lib/cowork/blocks.ts`: la línea de la tarjeta del gráfico en el chat dice «1 categoría» o «1 punto».
- Pruebas nuevas en `artifact-runtime.test.ts` y `charts.test.ts`.

Es un cambio de presentación: no cambia lo que hace el modelo, así que no hubo medición con el modelo.

Sin migraciones ni flags.
