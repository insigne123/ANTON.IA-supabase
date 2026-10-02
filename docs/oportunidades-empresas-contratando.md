# Empresas contratando (Plan 8, fase 3, PR-3b)

## Qué hace

Convierte avisos de empleo en oportunidades: una por empresa que publica muchos avisos para los cargos que la oferta cubre. Para el piloto de GrupoExpro son cargos operativos: operario, bodeguero, reponedor, cajero, vendedor, guardia, conductor, auxiliar de aseo, temporero y otros (`src/lib/commercial-opportunities/pilot.ts`).

Este PR trae las fuentes y el cálculo. La página y el guardado en las tablas de #119 llegan con PR-3c.

## Fuentes

| Fuente | Archivo | Qué trae | Costo |
|---|---|---|---|
| JSearch (Google for Jobs, RapidAPI) | `src/lib/server/commercial-opportunities/jsearch.ts` | Avisos de Chile del último mes, con empresa, sitio, portal, fecha y enlace | US$0,0025 por página en el plan Pro (US$25 por 10.000) |
| LinkedIn Job Search API de Fantastic Jobs (Apify) | `src/lib/server/commercial-opportunities/fantastic-jobs.ts` | Avisos de LinkedIn de los últimos 7 días, con tamaño e industria de la empresa | US$5 por 1.000 avisos en los planes gratis y Bronze de Apify, 3,5 en Silver y 1,5 desde Gold (`APIFY_FANTASTIC_USD_PER_JOB`) |

- **JSearch** usa `JSEARCH_API_KEY`, que va solo en el encabezado y nunca en la dirección ni en los mensajes de error.
- **Fantastic Jobs** usa el `APIFY_TOKEN` que ya existe, también por encabezado. Pide los avisos sin agencias (`removeAgency`) y sin descripción.
- **Del aviso no se guarda al reclutador:** Fantastic Jobs lo trae, pero se descarta.

## Cómo se calcula (`src/lib/commercial-opportunities/hiring.ts`)

1. **Normaliza** cada aviso a la misma forma: título, empresa, sitio, LinkedIn de la empresa, tamaño, industria, lugar, región de Chile, portal, enlace y fecha.
2. **Aparta lo que no es una empresa que contrata:**
   - agencias de personal y portales de empleo (otras EST son competencia);
   - avisos anónimos («Importante empresa del rubro», «Confidencial»);
   - avisos de fuera de la ventana (30 días).
3. **Junta a la misma empresa** por su sitio o, sin sitio, por su nombre sin «S.A.», «SpA», «Ltda.» ni «Chile».
4. **Cuenta cada aviso una vez:** el mismo título, en la misma región y la misma semana, en dos portales es un aviso. Las copias igual aportan los datos de la empresa.
5. **Deja las empresas con el mínimo de avisos** (5 en el piloto).
6. **Puntaje de 0 a 100, con sus motivos:**

| Qué | Puntos |
|---|---|
| Cantidad de avisos | hasta 40 (10 × log₂(avisos + 1)) |
| Ritmo: 3 o más en la última semana, o al menos 1 | 10 o 5 |
| Cargos de la oferta: 80 % o más, 50 % o más, o alguno | 20, 12 o 6 |
| Región del perfil | 10 |
| Tamaño: 200 o más empleados, o 50 o más | 10 o 5 |

Ejemplo de motivos: «14 avisos en 30 días (5 en la última semana) · cargos: operario (8), bodeguero (4) · en Antofagasta · 201-500 empleados · aún no es contacto».

Los clientes van al final; los que ya son contactos se marcan.

## Medición con las claves

`scripts/measure-opportunity-sources.ts --live` corre la búsqueda del piloto en las dos fuentes, sin escribir en la base, y reporta:
- cuántos avisos trae cada fuente y cuántos son de empresas, agencias o anónimos;
- con sitio y con región;
- los portales que aparecen en JSearch (Computrabajo, Laborum, Trabajando…);
- cuántas empresas llegan al mínimo, cuántas están en las dos fuentes y las 15 mejores;
- el costo.

Con eso se decide si JSearch cubre bien Chile o si entra Jooble. Necesita `JSEARCH_API_KEY` y `APIFY_TOKEN` en el entorno.

## Pruebas

- **`src/lib/commercial-opportunities/hiring.test.ts`:**
  - regiones por nombre o ciudad, en español o inglés;
  - agencias, portales y anónimos apartados (una consultora minera sí contrata para sí);
  - la misma empresa por sitio o por nombre;
  - las dos fuentes con la misma forma, sin el reclutador;
  - avisos contados una vez entre portales, ventana de 30 días, puntaje y motivos, el cliente al final.
- **`src/lib/server/commercial-opportunities/sources.test.ts`:**
  - JSearch pide Chile y el último mes, y la clave va solo en el encabezado;
  - sus errores no muestran la clave;
  - Fantastic Jobs corre en Apify sin agencias ni descripción y descarta al reclutador.
