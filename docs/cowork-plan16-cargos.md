# Plan 16: la búsqueda de prospectos va con un cargo por término (8 oct)

## Problema

La búsqueda admite cinco cargos, y las instrucciones piden incluir los equivalentes en español e inglés. Para que le cupieran, el
modelo a veces juntaba varios en un mismo término, separados con « / » o «;». Ese término llega al proveedor como un solo cargo, por
ejemplo «Gerente de Personas / People Manager; Director de RR. HH.», y no coincide con nadie. Cuando además llegaba al largo máximo
(100 caracteres), se cortaba a mitad de palabra: «Head of People / Head of HR / … / Gerente de S». La tarjeta de aprobación lo
mostraba así.

En las corridas guardadas del banco, 6 de 190 búsquedas (3 %) tenían un término así, y 5 estaban cortadas.

## Qué cambia

- `coworkSplitTerms` (`src/lib/cowork/search-proposal.ts`) separa cada término por « / », «;» o «|», en cargos, rubros y
  ubicaciones:
  - primero entra la primera parte de cada término y después el resto, hasta cinco; los cargos parecidos que no caben los trae el
    proveedor;
  - descarta los repetidos, sin distinguir mayúsculas ni tildes;
  - si el término llegó al largo máximo, descarta su última parte, que quedó cortada;
  - «Director/a» y «Santiago, Chile» quedan enteros.
- Instrucciones: un cargo o rubro por término, nunca varios juntos; como la búsqueda ya trae cargos similares, conviene elegir los
  cinco más representativos.
- El esquema que ve el modelo no cambia (cinco términos de hasta 100 caracteres). La separación también corre al leer los criterios
  guardados y da el mismo resultado.

## Medición

Se corrieron 6 casos de búsqueda, 2 veces cada uno, con `gpt-6-luna`: pasan los mismos en `main` y aquí (3 de 6; los AXIS que fallan
lo hacen por checks que no tocan la búsqueda). En esta muestra no salió ningún término juntado. Por eso el test usa el caso real
cortado (`inicio-prospectos`, del banco del Plan 15), que ahora queda en cinco cargos limpios.

Sin migraciones ni flags.
