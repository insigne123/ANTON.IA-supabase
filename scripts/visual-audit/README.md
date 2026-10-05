# Auditoría visual

Recorre cada página de la app con sesión iniciada, contra un Supabase simulado en memoria. Por cada página, persona, conjunto de datos, ancho y tema guarda una captura y registra lo que falla. Ningún dato sale de la máquina y no se envía ningún correo.

```bash
npm run audit:visual                                    # todo: ~145 visitas, 390 y 1440 px, claro y oscuro
npm run audit:visual -- --routes=/search,/crm           # solo esas rutas (y sus subrutas)
npm run audit:visual -- --persona=owner --dataset=empty # estados vacíos
npm run audit:visual -- --baseline=.visual-audit/base   # qué es nuevo y qué se resolvió respecto de otro recorrido
```

Opciones: `--routes`, `--persona` (`owner`, `member`, `anon`), `--dataset` (`full`, `empty`), `--widths` (390,1440), `--schemes` (light,dark), `--concurrency` (3), `--out`, `--skip-build` y `--baseline` (carpeta o `report.json`).

Requisitos: Node 22, Playwright con Chromium (sirve el global; también `PLAYWRIGHT_MODULE` y `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). `axe-core` viene en `node_modules`. No agrega dependencias y no corre en CI.

## Qué revisa

- Errores de página (`pageerror`) y `console.error`.
- Respuestas 500 o más, sin contar los 503 que pone la propia auditoría.
- Desborde horizontal y qué elementos lo causan.
- Violaciones serias y críticas de axe (WCAG 2.1 A/AA y buenas prácticas).
- Escrituras al cargar: llamadas no-GET a `/api/*` o a Supabase sin que nadie haya hecho clic.
- Hosts externos pedidos por el navegador.
- Acceso:
  - el miembro no debe ver páginas con lista de acceso (Cowork, Oportunidades, Privacidad, Administración);
  - sin sesión, las páginas privadas llevan a `/login`.
- Páginas que no terminan de cargar.
- En el servidor:
  - tablas y RPC sin datos de prueba;
  - conexiones bloqueadas;
  - errores en el log.

## Cómo se aísla

- **Sin `.env*`:** si hay un `.env`, `.env.local` u otro que Next cargaría, no arranca. El entorno se arma desde cero en `env.mjs`:
  - banderas no secretas de `apphosting.yaml`;
  - URLs locales;
  - claves ficticias;
  - el owner en todas las listas de acceso.
- **Compilación propia:** compila en `.next-audit/` y reutiliza la compilación mientras no cambie el código.
- **Bloqueo de red:**
  - `next start` corre con `egress-guard.cjs` precargado, que corta cualquier conexión que no sea a 127.0.0.1;
  - el navegador solo alcanza la app (9005) y el Supabase simulado (54321).
- **Escrituras:** las llamadas no-GET a `/api/*` responden 503 «Bloqueado por la auditoría visual». La excepción son las de `PASS_WRITES` en `api-policy.mjs`, que solo tocan la base en memoria.
- **Realtime:** se simula en el navegador. Las suscripciones se aceptan y no llegan cambios.

## Datos de prueba

`fixtures/` tiene un archivo por dominio para la organización «Yago QA»:

| Archivo | Datos |
|---|---|
| `people.mjs` | Organización, owner y miembro, perfil con ICP e invitación |
| `leads.mjs` | 25 por completar (8 sin correo), 20 por escribir e investigaciones |
| `contacted.mjs` | 15 conversaciones, eventos y etapas del pipeline |
| `campaigns.mjs` | 3 campañas masivas con envíos y 2 secuencias antiguas |
| `cowork.mjs`, `opportunities.mjs`, `privacy.mjs`, `settings.mjs`, `quota.mjs` | El resto de las secciones |

Cada archivo exporta `default (ctx) => ({ tables, rpc?, embeds? })` y, si corresponde, `keepInEmpty`: las tablas que una organización vacía igual tiene. Las fechas son relativas al inicio del recorrido (`ctx.daysAgo(2)`).

Para una tabla nueva, agrega sus filas en el archivo de su dominio. El reporte lista las tablas que la app pidió y no tienen datos.

## Rutas

`routes.mjs` lista cada página con su nombre y, si tiene lista de acceso, su `gate`. Al agregar una página, súmala ahí.

- `notFound`: la página debe responder 404.
- `redirectsTo`: una dirección retirada que debe llevar a la que la reemplazó. Se comprueba una vez, como owner, sin capturas.
- `legacy`: lo que se va a retirar.

## Salida

`.visual-audit/<fecha>/` (en `.gitignore`):

- `report.md`: resumen, hallazgos por página y comparación con el recorrido base.
- `report.json`: todo.
- `index.html`: capturas con sus hallazgos.
- `build.log` y `app.log`.

Los hallazgos se comparan por clave, sin comparar píxeles. Así, un recorrido con `--baseline` solo marca lo que cambió.

## Recorrido de interacciones

`npm run audit:interactions` usa el mismo banco, pero en vez de mirar la vista quieta de cada página la usa:

```bash
npm run audit:interactions                                      # todo: owner y member, 33 páginas
npm run audit:interactions -- --routes=/crm,/sheet --checks=error,slow
npm run audit:interactions -- --skip-build --out=.visual-audit/interacciones-antes
```

Opciones: `--routes`, `--persona` (`owner`, `member`), `--checks` (`overlays`, `tabs`, `keyboard`, `error`, `slow`, `long`), `--concurrency` (3), `--skip-build` y `--out`.

Qué revisa en cada página:

| Revisión | Qué hace | Qué cuenta como hallazgo |
|---|---|---|
| `overlays` | Abre cada menú, diálogo, hoja, selector y desplegable (hasta 14 por página) | Abrirlo escribe datos; el foco no entra; axe falla dentro; Esc no lo cierra; el foco no vuelve a lo que lo abrió |
| `tabs` | Elige cada pestaña con clic y con las flechas | La pestaña no queda elegida o no muestra su panel; las flechas no mueven |
| `keyboard` | Recorre la página con Tab (16 paradas) | Una parada sin foco visible, o el foco que se pierde |
| `error` | Todas las lecturas (`/api/*` y Supabase) responden 500 | La página se rompe, queda en blanco, dice «vacío» o no avisa nada. Una página que se ve igual con y sin datos no cuenta |
| `slow` | Todas las lecturas tardan 3 s | Mientras espera no se ve que carga, o dice «vacío» y después muestra datos |
| `long` | Nombres, empresas y cargos 3 veces más largos | Algo empuja la página hacia el lado |

`error`, `slow` y `long` corren solo como owner, a 1440 px. Una promesa rechazada sin capturar sale como error de página, con el último `console.error` de la app antes de ella, que suele nombrar la lectura que falló.

Salida en `--out` (o `.visual-audit/interacciones-<fecha>/`): `interactions.md` con la cobertura por página y los hallazgos, `interactions.json` con todo, y en `shots/` la captura de cada página con errores (`-error.png`) y con carga lenta (`-slow.png`).


## Compilación compartida

`build.mjs` compila una sola vez para los tres recorridos (`audit:visual`, `audit:interactions` y `audit:simplicity`). Reutiliza `.next-audit/` mientras el código de la app no cambie: la huella ignora `scripts/visual-audit`, `scripts/usability`, `docs` y las pruebas.
