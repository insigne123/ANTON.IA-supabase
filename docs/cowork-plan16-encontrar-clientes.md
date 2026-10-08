# Plan 16: «ayúdame a encontrar clientes» propone buscarlos (8 oct)

## Problema

En producción (1 oct), un usuario describió su oferta y pidió «ayúdame a encontrar clientes». La receta «Ayúdame a vender» parte
siempre por los contactos guardados con correo, así que Cowork respondía «Partiría por tus contactos actuales antes de buscar
prospectos nuevos» y proponía una campaña a esos 21 contactos. No buscaba a nadie nuevo, aunque eso era lo que el usuario pidió.

## Qué cambia

- La receta (`agent-instructions.ts`) distingue el pedido explícito: si pide encontrar o buscar clientes, prospectos, leads o empresas
  nuevas, Cowork propone la búsqueda de prospectos nuevos y menciona sus contactos con correo como otra opción.
- «Ayúdame a vender», «necesito más clientes» o «por dónde parto» siguen como antes: primero los contactos con correo.
- `ur-oferta-app` acepta también una tarea de varios pasos que empieza por la búsqueda (`COWORK_TASKS_ENABLED`, encendido en
  producción), como ya lo hacía `mkt-busqueda-y-campana`.

## Medición

Se corrieron 4 casos, 2 veces cada uno, con `gpt-6-luna`:

| | main | este PR |
|---|---|---|
| `ur-oferta-app` propone buscar prospectos nuevos (RR. HH. y selección en rubros con mucha contratación) | 0 de 2 | 2 de 2 (una búsqueda; una tarea que empieza por la búsqueda) |
| `vender-mas` y `mkt-necesito-clientes` parten por los contactos con correo | 4 de 4 | 4 de 4 |
| `axis-b3-canales` | 0 de 2 | 0 de 2 (sus checks piden otra cosa, sin cambios) |

Sin migraciones ni flags.
