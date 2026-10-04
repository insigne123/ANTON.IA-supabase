# La página «Oportunidades» (Plan 8, fase 3, PR-3c)

## Qué ve la persona

**Arriba:**
- **Qué buscamos:** la oferta, los cargos, el mínimo de avisos y las regiones. Se edita con «Editar búsqueda».
- **Última búsqueda:** cuándo fue y cuántos avisos trajo. Si una fuente falló, dice cuál y por qué.
- **Gasto del mes,** contra el tope.
- **Fuentes sin conectar:** si a una fuente le falta su clave, la página lo dice sin mostrar nombres de variables; la activa quien administra ANTON.IA.

**«Buscar ahora»** muestra antes qué se consulta en cada fuente y cuánto puede costar, junto con el gasto del mes. Si la búsqueda pasaría el tope, no deja buscar.

**Cada empresa:**
- su calce de 0 a 100;
- cuántos avisos publicó en 30 días y en la última semana, y dónde;
- los cargos de la oferta que busca;
- si ya es cliente, si ya tienes contactos ahí o si aún no es contacto;
- sus avisos, con portal, fecha y enlace;
- **acciones:**
  - «Me interesa»: la marca a tu nombre;
  - «Descartar», y «Recuperar» para deshacerlo;
  - «Buscar decisores»: abre Búsqueda en esa empresa con cargos de RR. HH., Operaciones y Gerencia, y espera a que la persona busque, con su costo de siempre.

**Pestañas:** Nuevas, Me interesan, Descartadas y Todas, con un buscador por nombre.

**Estados cuidados:**
- carga con esqueletos;
- sin búsquedas: un botón para buscar;
- ninguna empresa llega al mínimo: sugiere editar la búsqueda;
- error: un botón para reintentar.

## Acceso

- **`OPPORTUNITIES_ALLOWED_EMAILS`** (en `apphosting.yaml`) dice quién ve la sección: solo cuentas con correo confirmado de esa lista. Hoy, nicolas.yarur.g@yago.cl.
- **El servidor lo comprueba en tres lugares:**
  - la página (`src/app/(app)/opportunities/page.tsx`);
  - cada ruta de `/api/commercial-opportunities`;
  - el menú, que pregunta a `/api/commercial-opportunities/access`.
- **Cualquier otra cuenta:**
  - no ve la entrada en el menú;
  - la página y las rutas de datos le responden 404.
- **Lectura y escritura:**
  - todo va por la clave de servicio, porque las tablas no dan permisos a los miembros;
  - siempre en la organización activa de la persona, nunca con un id que venga en la petición.
- **Se fue del menú:** «Empresas guardadas» y la sección vieja. Sus rutas se retiraron y redirigen a `/opportunities`; el Centro de ayuda y «Pregúntale a la IA» muestran Oportunidades con la misma regla que el menú (`OPPORTUNITIES_ALLOWED_EMAILS`).

## Cómo busca (`src/lib/server/commercial-opportunities/sync.ts`)

1. **Antes de gastar:**
   - cierra búsquedas que quedaron colgadas por más de 15 minutos;
   - no deja correr dos búsquedas a la vez;
   - compara el gasto del mes más el costo máximo con el tope (`OPPORTUNITIES_MONTHLY_USD_CAP`, US$10 por omisión).
   - Si pasa el tope, registra la búsqueda como omitida y no consulta nada.
2. **Consulta las fuentes con clave, a la vez:**
   - **Google for Jobs (JSearch):** los 10 primeros cargos, de a 3 consultas. Si la clave es rechazada o el plan se agotó, deja de consultar.
   - **LinkedIn (Fantastic Jobs):** hasta 200 avisos de los últimos 7 días.
3. **Reagrupa todos los avisos de los últimos 30 días,** los guardados y los nuevos. Así, una empresa con tres avisos ayer y dos hoy llega al mínimo.
4. **Guarda una fila por empresa con al menos un aviso,** para no perder sus avisos. La página muestra las que llegan al mínimo.
   - Una búsqueda nueva actualiza los avisos, el puntaje y la evidencia.
   - Nunca cambia el estado ni quién la tomó.
5. **Registra cada fuente** con lo que trajo, las empresas nuevas y actualizadas, el costo y el error. Si guardar falla, cierra las búsquedas como fallidas.

## Variables

| Variable | Qué es | Dónde |
|---|---|---|
| `OPPORTUNITIES_ALLOWED_EMAILS` | Cuentas que ven la sección | `apphosting.yaml` (este PR) |
| `OPPORTUNITIES_MONTHLY_USD_CAP` | Tope de gasto del mes en US$ (10) | `apphosting.yaml` (este PR) |
| `JSEARCH_API_KEY` | Clave de RapidAPI suscrita a JSearch | Secreto: lo crea y declara el mantenedor |
| `APIFY_TOKEN` | Token de Apify para Fantastic Jobs | Secreto: hoy no está en `apphosting.yaml`; lo declara el mantenedor |
| `APIFY_FANTASTIC_USD_PER_JOB` | Precio por aviso según el plan de Apify (0,005 por omisión) | Opcional |

Sin `JSEARCH_API_KEY` ni `APIFY_TOKEN`, la página abre, dice qué falta y no busca.

## Pruebas

- **`src/lib/commercial-opportunities/access.test.ts`:**
  - la lista de correos con mayúsculas y espacios;
  - sin correo confirmado no hay acceso;
  - con la lista vacía no entra nadie.
- **`src/lib/commercial-opportunities/records.test.ts`:**
  - la fila de empresa no lleva estado ni dueño;
  - la evidencia trae solo datos de empresa;
  - un aviso vuelve igual desde la base;
  - los textos se cortan a los límites de las tablas.
- **`src/lib/server/commercial-opportunities/sync.test.ts`,** con una base en memoria:
  - el plan de costos;
  - la ventana de 30 días se reagrupa;
  - el tope mensual se revisa antes de gastar;
  - una fuente caída no detiene a la otra;
  - sin cargos, sin claves o con otra búsqueda en curso no parte;
  - si guardar falla, se cierran las búsquedas.
- **`src/lib/commercial-opportunities/view.test.ts`:** pestañas, última búsqueda, dinero y fechas.
- **`src/lib/search/company-prefill.test.ts`:**
  - «Buscar decisores» llena Búsqueda;
  - un dominio inválido no se usa.
