# El informe usa las pruebas del Perfil y el nombre del producto (8 oct 2026)

## Problema

Una lectura ciega de 12 informes de investigación encontró la misma falla en todos: ignoraban el resultado que el vendedor cargó en
su Perfil («Un cliente en piloto ya lo usa a diario en reclutamiento») y le decían que no había casos que citar: «no se dispone de un
caso comparable, clientes ni resultados del vendedor». Además llamaban a la oferta por el nombre de la empresa: «Producto
recomendado: Yago SpA», en vez de AXIS.

## Causa

El informe recibe la oferta como `SellerProfileContextV2`. Cuando la organización no tiene productos propios, se arma desde el Perfil
personal (`reportV2ProfileFromPersonal`, `src/lib/server/seller-profile.ts`). Ese perfil:

- no copiaba `proofPoints`, que sí usan los borradores y Cowork;
- nombraba el producto con `companyName`.

El prompt ya decía «casos de éxito solo si el vendedor los aporta», pero nunca le llegaban.

## Cambio

- `SellerProductContextV2` suma `proofPoints`.
  - Se llena desde el Perfil personal y desde los productos de la organización (`proofPoints` o `proof_points`).
- Si el Perfil tiene un solo servicio escrito como «Nombre: descripción» («AXIS: consultas judiciales…»), ese nombre es el del
  producto. Si no, sigue el de la empresa.
- Prompts:
  - El editor (`write-report-v2.ts`, `report-v2/editor/10`) usa la prueba que más calce como respaldo en un ángulo y en la idea de
    primer correo, tal cual y sin ampliarla, y nombra la oferta por su producto.
  - El análisis (`reason-about-report-v2-account.ts`, `report-v2/p5-analysis/7`) puede usarla en un gancho.
  - Sin pruebas, todo sigue igual: dice una vez que no hay caso comparable.

Los informes ya generados no se rehacen. El worker solo procesa informes en cola o por reintentar; aplica a los nuevos.

## Medición

`scripts/review-report-v2.ts --replay` con `gpt-6-luna`, sin escrituras. Dos casos AXIS (retail y construcción), 3 informes por versión
y caso.

| | Antes | Ahora |
|---|---|---|
| Cita la prueba del Perfil | 0 de 6 | 6 de 6 |
| Llama a la oferta «Yago SpA» / «AXIS» | 1 / 0 | 0 / 53 menciones |
| Palabras | 1078 a 1218 | 1060 a 1234 |

Otra sesión de Claude leyó a ciegas los 12 informes mezclados, sin saber cuál era cuál:

| | Antes | Ahora |
|---|---|---|
| Posición media (1 = mejor de 6) | 5,00 | 2,00 |
| Mejor informe del caso | 0 de 2 | 2 de 2 |
| Buenos / mejorables / malos | 0 / 6 / 0 | 4 / 2 / 0 |
| Utilidad (1 a 5) | 3,00 | 3,83 |
| Razonamiento | 3,00 | 3,67 |
| Veracidad | 3,83 | 4,50 |
| Claridad | 2,83 | 3,33 |
| Primer correo sugerido | 2,83 | 3,33 |

En los dos casos, los tres informes nuevos quedaron por encima de los tres actuales.

## Lo que se probó y no quedó

Esfuerzo de razonamiento medio en los pasos del informe (`REPORT_REASONING_EFFORT`, rama aparte): tarda 1,7 veces más (76 a 134 s
contra 44 a 58 s) y la lectura ciega no mejoró (posición media 3,50 en los dos; veracidad 3,83 → 3,33).

Queda pendiente, según el evaluador:

- los informes son largos y repiten salvedades en varias secciones;
- le restan peso a una señal fechada de hace pocas semanas. En el banco de pruebas la fecha va solo en el texto de la evidencia, así
  que falta comprobarlo con investigaciones reales.

Sin migraciones ni flags.
