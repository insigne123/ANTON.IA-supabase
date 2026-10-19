# Oportunidades: Mercado público («Cómo ganar», contratos por vencer y competidores)

Propuestas 9, 10 y 11, 19 oct 2026. Tres funciones sobre los datos abiertos de licitaciones de ChileCompra, dentro del workspace de Oportunidades (`OPPORTUNITIES_WORKSPACE_ENABLED`).

## Qué ve el equipo

- **«Cómo ganar»**, pestaña de cada licitación y Compra Ágil, para todos los que ven la oportunidad. Muestra lo que ese organismo licitó antes que se parece (36 meses), quién ganó, con cuántos oferentes, cuántas quedaron desiertas y cuánto se adjudicó frente al estimado; y lo mismo para otros organismos en el último año. «Preparar estrategia» encola un trabajo `winplan`: Sonnet escribe un resumen, un rango de precio apoyado en lo que realmente se pagó, qué destacar (ligado a los criterios del informe), riesgos y hasta cinco competidores.
- **«Mercado público»**, vista de administradores junto a «Embudo» y «Lista», con tres partes:
  - «Demanda futura»: el Plan Anual de Compras (ver `oportunidades-oferta-y-demanda.md`).
  - «Contratos por vencer»: contratos adjudicados a otras empresas que terminan entre un mes atrás y 15 meses adelante y calzan con la oferta, con quién los tiene, monto, duración y fecha estimada de término. «Seguir» crea una oportunidad privada «Renovación: …» (origen `expiring_contract`, una por código en el workspace).
  - «Competidores»: buscar proveedores por nombre o RUT, seguir hasta 30, y ver por cada uno sus ofertas, ganadas, monto adjudicado y últimos movimientos (12 meses). Con el RUT de la «Ficha para licitaciones» muestra el historial propio y sugiere a quienes ofertaron en las mismas licitaciones; sin RUT, a quienes más ganan en las palabras del workspace.
  - Personas naturales: ChileCompra publica también a las personas que ofertan (RUT bajo 50.000.000). En «Competidores», «Contratos por vencer», «Cómo ganar» y la descripción de un contrato seguido se muestra solo su nombre, con «Persona natural» en vez del RUT (`rutLabel` e `isPersonRut` en `src/lib/public-procurement/market.ts`). La búsqueda por RUT sigue funcionando para quien ya lo conoce.
- El **Asistente** de Oportunidades lee también los 25 contratos por vencer más próximos (solo administradores).

## Datos

Fuente: `https://transparenciachc.blob.core.windows.net/lic-da/{año}-{mes}.zip` (desde 2022-10), un CSV por mes separado por «;», en latin1, con 110 columnas y una fila por línea de oferta (unos 15 MB comprimido y 150 mil a 250 mil filas por mes). Unidades de duración: 4 = meses, 2 = días, 3 = semanas; 1 y 0 no traen largo.

Tablas (`20261019120000_public_procurement.sql`, solo `service_role`, RLS activo):

| Tabla | Qué guarda |
| --- | --- |
| `public_procurement_agencies` | organismo por `CodigoOrganismo`, con su nombre plegado (`name_key`) |
| `public_procurement_suppliers` | proveedor por RUT normalizado |
| `public_procurement_tenders` | licitación por `Codigo` numérico: código externo, nombre, organismo, región, tipo, estado, moneda, montos estimado y adjudicado, oferentes, fechas, duración en meses, rubro más frecuente y, en el último año, los nombres de los criterios de evaluación |
| `public_procurement_bids` | oferta por licitación y proveedor: monto ofertado, adjudicado y si fue seleccionada |
| `public_procurement_loads` | qué meses están cargados y con qué alcance |
| `opportunity_competitors` | competidores que sigue cada workspace |

Alcance por antigüedad (`monthPlan`): los últimos 12 meses con todas las licitaciones y ofertas; los meses 13 a 24 solo las adjudicadas con sus ofertas ganadoras (sin criterios); los meses 25 a 48 solo las adjudicadas con contratos de 18 meses o más (para «Contratos por vencer»). Con los 48 meses cargados en una copia local (oct 2026): 205 mil licitaciones, 590 mil ofertas, 50 mil proveedores y 1.133 organismos, **208 MB**.

Búsqueda por palabras: cada licitación guarda en `search_text` su nombre y su rubro normalizados (minúsculas, sin tildes y separados por un salto de línea, para que una frase no empiece en el nombre y termine en el rubro). Esa columna tiene un índice de trigramas (`pg_trgm`) que sirve a `LIKE '%…%'`, y «Contratos por vencer» usa además un índice por la fecha de término del contrato. Sin ellos, cada consulta normalizaba fila por fila y en producción (plan gratuito, donde la API corta a los 8 s) «Contratos por vencer» tardaba 18 s y los competidores por palabras 10 s, así que fallaban. En la copia local, con 12 palabras, bajaron de 3,6 s a 0,2 s y de 1,2 s a 0,25 s; con 25 palabras amplias quedan en 0,35 s y 0,55 s. La columna y los índices suman unos 58 MB de los 208 (migraciones `20261019150000` y `20261019151000`). Si cambia `public_procurement_fold`, hay que recalcular la columna (`update public_procurement_tenders set name = name`).

Particularidades del archivo que el cargador resuelve (`scripts/public-procurement/aggregate.mjs`, con pruebas):

- El mismo `Codigo` aparece con dos `CodigoExterno` (uno con una errata, «2446;68-LE26»): se agrupa por el número y se conserva el código bien formado.
- Montos imposibles («2e+86» en marzo de 2026): todo monto sobre 10^14 pesos se descarta.
- El organismo de una oportunidad se escribe distinto que en ChileCompra («Municipalidad de Maipú» y «I MUNICIPALIDAD DE MAIPU»; «Hospital de Talca» y «SERVICIO DE SALUD DEL MAULE HOSPITAL DE TALCA»): se busca primero el nombre y sus variantes con «I» o «Ilustre», luego el organismo cuyo nombre contiene todas las palabras del comprador con menos palabras extra. Un mismo nombre puede tener varios códigos (el MOP tiene 11): se usan todos.
- Licitaciones parecidas: manda el nombre. El rubro es la familia de la línea principal y puede engañar («Insumos óptica comunal» con rubro «Seguridad, vigilancia y detección»), así que solo suma a un nombre que comparte una palabra o reemplaza a un nombre que no dice nada («Propuesta pública N° 486-2023»). Sinónimos frecuentes cuentan como la misma palabra (guardia y vigilancia, aseo y limpieza, mantención y conservación…). Entre parecidas de igual puntaje van primero las ya resueltas.

## Carga mensual

```
SUPABASE_URL=https://yfdelflsheurzaicwayi.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-public-procurement.mjs
```

Sin dependencias del proyecto (curl, unzip y la API REST). Primero reduce los meses que envejecieron y borra los que salieron del plan (Postgres reutiliza ese espacio), luego carga los meses nunca cargados y recarga los tres últimos (sus licitaciones cambian de estado). Antes de cada mes consulta `public_procurement_db_bytes()` y se detiene si la base pasa `--max-db-mb` (420 por defecto; el plan gratuito de Supabase permite 500). Un archivo de unos 15 MB a la vez en disco; 10 a 17 s por mes. Opciones: `--months=2026-9,2026-8`, `--zip-dir=carpeta`, `--dry-run`.

Corre como tarea programada de Claude Code una vez al mes, igual que la copia del Plan Anual de Compras. ChileCompra va completando el archivo del mes en curso (el 19 de octubre ya estaba el de octubre, con 17 mil filas), por eso se recargan los tres últimos meses en cada corrida.

## Trabajos y costo

- `winplan` (por clic): una llamada a Sonnet en la categoría `research` del presupuesto mensual, en caché por prompt. Guarda en el resultado del trabajo la estrategia y en qué se basó (organismo, cuántas parecidas, cobertura de los datos). Se valida: los competidores solo pueden ser RUT que aparecen en el historial dado, y un rango a más de 1,5 veces o bajo 0,2 veces el estimado se descarta como error de unidad.
- `contracts` (mensual con la búsqueda diaria, o «Actualizar»): `public_procurement_expiring` trae hasta 600 contratos que dicen alguna palabra del workspace; Haiku filtra en lotes de 120 (categoría `evaluation`) y quedan los que la empresa podría ganar, con un motivo. El resultado queda en el trabajo; la vista muestra la última lectura terminada. Si el historial no responde (por ejemplo, la consulta pasa el límite de la API), la lectura queda bloqueada con «No pudimos leer el historial de ChileCompra ahora» y la siguiente búsqueda diaria la vuelve a encolar, igual que «Demanda futura»; «Aún no cargamos el historial» queda solo para una base sin las funciones.
- El radar no usa IA: lee las tablas.

## Migración y puesta en producción

1. `20261019120000_public_procurement.sql`: tablas, funciones (`public_procurement_db_bytes`, `public_procurement_expiring`, `public_procurement_cobidders`, `public_procurement_top_winners`) y los tipos `winplan` y `contracts` en `opportunity_jobs`.
2. Desplegar la app. Sin datos cargados, las vistas dicen «Aún no cargamos el historial de ChileCompra» y los trabajos no se encolan.
3. Correr el cargador (unos 15 minutos para los 48 meses) y verificar el tamaño de la base.
4. Programar la carga mensual.
5. Búsqueda rápida, una migración a la vez: `20261019150000_public_procurement_search_text.sql` (reescribe la tabla de licitaciones; verificar que `search_text` no quede vacía y el tamaño de la base) y luego `20261019151000_public_procurement_search_index.sql` (índices y funciones; verificar con `EXPLAIN` que «Contratos por vencer» use los dos índices). En producción (19 oct 2026) la primera tardó cerca de un minuto: la herramienta de migraciones se cortó a los 60 s pero la base terminó y la registró, y mientras la tabla estaba bloqueada la API respondió 503 (`PGRST002`, no podía recargar su esquema) durante un minuto y medio. Una reescritura así va fuera de horario. La segunda (índices) no bloqueó lecturas ni dio errores. La base quedó en 393 MB.

## Producción en el plan gratuito

El servidor de base de datos del plan gratuito tiene unos 430 MB de RAM, y Postgres reserva 224 MB para su caché. Desde septiembre usa swap todo el tiempo (unas 400 páginas por segundo en promedio y 544 el 19 de octubre). Con el historial cargado, una consulta de Mercado público que lee decenas de MB puede tardar de 1 a más de 8 s según qué páginas estén en swap, y cortarse. El 19 de octubre, entre la carga, las migraciones y las pruebas, el p95 de toda la API pasó de unos 0,4 s a 1,2–1,8 s; conviene volver a medirlo en un día normal. Por eso las pantallas tienen salidas honestas («No pudimos leer el historial de ChileCompra ahora», el radar sin sugerencias y con «Reintentar») y la lectura mensual de contratos se reintenta sola. El arreglo de fondo es un servidor con más memoria (plan Pro con cómputo Micro o mayor); otra opción, peor, es guardar menos meses.
