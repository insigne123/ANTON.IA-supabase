# Proyectos de inversión del SEIA (Plan 8, fase 3, PR-3e)

## Qué hace

La página «Oportunidades» suma la pestaña «Proyectos de inversión». Muestra proyectos en evaluación ambiental o aprobados, de los sectores elegidos y sobre una inversión mínima. El titular de cada proyecto es la empresa a contactar: construir y operar un proyecto grande pide personal.

## Por qué se sube un archivo

**El mapa de proyectos del SEIA** (sig.sea.gob.cl/mapadeproyectos):
- consulta un servicio ArcGIS con un token que emite su propia página: no es una API pública ni estable;
- datos.gob.cl solo tiene resúmenes de 2015.

**El flujo es manual:**
1. La persona exporta el resultado del mapa en CSV, una vez al mes, con los filtros que quiera.
2. Lo sube en la página.
3. El archivo se lee en memoria y no se guarda.

**Formatos:**
- CSV con cualquier separador, con o sin BOM;
- Excel `.xlsx`;
- el `.xls` antiguo no se abre;
- hasta 10 MB y 60.000 filas.

## Columnas que se leen (`src/lib/commercial-opportunities/projects.ts`)

Se reconocen por el nombre de campo del mapa o por un encabezado legible:

| Dato | Campo del mapa | También |
|---|---|---|
| Id | `ID_EXPEDIENTE` | «Expediente», «Id» |
| Nombre (obligatorio) | `NOMBRE_PROYECTO` | «Nombre del proyecto», «Nombre» |
| Titular | `TITULAR` | «Empresa» |
| DIA o EIA | `FORMA_PRESENTACION` | «Tipo» |
| Tipología | `LETRA_TIPOLOGIA`, `NOMBRE_TIPOLOGIA` | «Tipología», «Sector» |
| Región y comunas | `REGION`, `COMUNAS` | «Región», «Comuna» |
| Estado | `ESTADO_EVALUACION` | «Estado» |
| Fechas | `FECHA_PRESENTACION`, `FECHA_CALIFICACION` | dd/mm/aaaa, ISO o número de Excel |
| Inversión (millones de US$) | `INVERSION_US` | «Inversión (MMU$)»; acepta «1.250,5» y «1250.5» |
| Enlace | `URL_EXPEDIENTE` | «URL» |

**Un proyecto sin id** se identifica por su nombre y su titular.

**Si el archivo repite un id,** cuenta una vez.

## Cuándo calza

**Calza cuando cumple todo esto:**
- **está en calificación o aprobado.** «Rechazado», «Desistido», «No admitido a tramitación», «No calificado», «Caducado» y similares nunca calzan;
- **es de un sector elegido:**
  - se lee de la letra de la tipología (art. 3 del reglamento del SEIA) o, sin ella, de sus palabras;
  - sin sectores elegidos, sirven todos;
- **llega a la inversión mínima** del perfil (US$ 10 millones en el piloto);
- **fue presentado en los últimos dos años.**

| Qué | Puntos |
|---|---|
| Inversión: 500 millones o más, 100 o más, 10 o más, o menos | 40, 30, 20 o 10 |
| En calificación (aún no se construye) o aprobado | 25 o 20 |
| Presentado hace 6 meses o menos, o hace 1 año o menos | 15 u 8 |
| Sector reconocido | 10 |
| Región del perfil | 10 |

**Sectores del piloto:** minería, energía, inmobiliario y urbano, infraestructura, industria y bodegaje, y agroindustria. Se editan en «Editar búsqueda» junto con la inversión mínima.

## Guardado

- **Una fila por proyecto** en `commercial_opportunities`:
  - tipo `project`;
  - la clave es el id del expediente;
  - el titular va como empresa;
  - el monto, en US$.
- **La evidencia** va en `commercial_opportunity_signals`, con fuente `seia`.
- **Cada subida es una búsqueda** con disparo `upload`.
- **El estado y el dueño** nunca se pisan.
- **Cada tarjeta lleva:**
  - «Buscar decisores» del titular;
  - «Expediente», si el archivo trae el enlace.

## Pruebas

- **`src/lib/commercial-opportunities/projects.test.ts`:**
  - campos del mapa y encabezados legibles;
  - números y fechas en formato chileno;
  - la columna obligatoria;
  - estados vivos y muertos;
  - sector, inversión y antigüedad;
  - el sector por letra o por palabras.
- **`src/lib/server/commercial-opportunities/project-import.test.ts`:**
  - CSV con punto y coma y BOM, y `.xlsx`;
  - `.xls` y archivos grandes rechazados;
  - una subida guarda cada proyecto una vez, con su evidencia, como una búsqueda;
  - un archivo sin nombre de proyecto no guarda nada.
