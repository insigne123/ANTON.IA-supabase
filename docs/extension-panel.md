# Panel de LinkedIn renovado (Plan 8, fase 4, PR-4a)

El panel lateral de la extensión se reordena alrededor de la persona abierta en LinkedIn. Arriba se ve dónde está ese contacto y un solo botón con el paso siguiente; el resto queda en cuatro pestañas. Usa la paleta de la app, en claro y en oscuro, y sigue el perfil abierto sin consultar cada segundo.

## Estructura

**Encabezado:**
- la organización y la cuenta conectada;
- los créditos de hoy, los mismos que muestra la app (`quota/status`): una sola asignación para buscar correos y teléfonos e investigar;
- el botón para desconectar.

**La persona** (`chrome-extension/ui/person-status.ts`):
- **Estados:** «Guardado» o «Sin guardar», «Con correo» o «Correo verificado», «Teléfono pendiente», «Investigando…», «Investigado», «Investigación con problemas» y «Mensaje enviado». Cada uno dice su estado en texto, no solo con color.
- **El paso siguiente,** en el orden en que un contacto queda listo:
  1. «Enriquecer perfil»;
  2. «Guardar lead»;
  3. «Buscar correo»;
  4. «Investigar lead»;
  5. «Escribir mensaje», o «Revisar el mensaje» si ya hay un borrador.
- **Mientras se investiga o después de enviar,** no hay botón: lo dicen los estados.
- **Las pestañas no repiten el botón de la tarjeta:** lo que ofrece la tarjeta, la pestaña lo deja fuera. Así no hay dos botones iguales a la vista.

**Pestañas** (con las flechas del teclado, `Inicio` y `Fin`):

| Pestaña | Qué tiene |
|---|---|
| Resumen | Qué buscar al enriquecer, los datos del contacto, «Guardar cambios» y «Buscar teléfono» |
| Investigación | El estado con los tres pasos de la app (buscar y leer fuentes, escribir y revisar el informe, listo para escribirle), el informe, el PDF y «Investigar de nuevo» |
| Mensaje | El mensaje de LinkedIn (redactar, opciones, preparar, copiar y enviar con confirmación) y el correo (secuencia, primer correo y campaña existente) |
| Más | Trabajos de Cowork, barrido de red y bandeja, e historial de LinkedIn |

## Cómo sigue el perfil abierto

**Antes,** el panel preguntaba por el perfil cada 1,5 segundos y por la sesión cada 10.

**Ahora, solo con eventos:**
- **La página de LinkedIn avisa** (`prospecting-content.js`) cuando cambia el perfil en pantalla:
  - por la URL o por el nombre, que LinkedIn dibuja después de la URL;
  - lo detecta con un `MutationObserver` y `popstate`, con 300 ms de espera.
- **El aviso es solo una señal:** el panel vuelve a leer el perfil por el worker, con sus validaciones de siempre. Solo acepta avisos de la propia extensión, desde una pestaña de LinkedIn.
- **El navegador avisa** cuando cambia la pestaña (`tabs.onActivated` y `tabs.onUpdated`).
- **La sesión cambia en el almacenamiento** (`storage.onChanged`) y se revisa cuando el panel vuelve a estar visible.

## Estados de error y reconexión

- **Sesión terminada:** si la sesión desaparece sin «Desconectar» (expiró o cambió la cuenta), la bienvenida lo dice y ofrece conectar de nuevo.
- **Panel desactualizado:** si la extensión se actualizó con el panel abierto, una tarjeta lo explica y ofrece «Recargar panel». Los borradores se conservan.
- **Sin internet:** un aviso dice que lo que se haga se reanuda al volver la conexión.
- **Mientras abre:** esqueletos de carga.
- **Avisos:** lo que corre, lo que falló o lo que se hizo va en una barra al pie, que entra y sale sin tapar el área de trabajo. Un solo aviso anunciado a lectores de pantalla.

## Aspecto

- **Tokens:** `chrome-extension/ui/panel.css` importa `src/styles/design-tokens.css` y usa sus alias `cw-*`. No hay colores propios. El modo oscuro sigue al sistema (`html.dark`), como la app.
- **Movimiento** (`docs/ui-ux/motion.md`):
  - lo que entra lo anima CSS: tarjeta, estados y pestaña;
  - la barra de avisos entra y sale con `framer-motion`, con `MotionConfig reducedMotion="user"`;
  - con «reducir movimiento», solo queda el indicador de trabajo.
- **Tamaño del panel:** sube 29 KB comprimido, por `framer-motion`.

## API

La extensión suma la acción `quota` en `/api/extension/workspace`:
- no pide un perfil;
- devuelve `{ credits: { used, limit, remaining, resetAt } }` de la persona y la organización conectadas;
- otra cuenta u organización en el pedido responde 409 antes de leer nada.

## Pruebas

- **`chrome-extension/tests/person-status.test.mjs`:** el orden de los pasos, sin botón mientras se investiga, los estados y los tres pasos de la investigación.
- **`chrome-extension/tests/profile-announce.test.mjs`:**
  - un perfil nuevo y su nombre se anuncian una vez cada uno;
  - lo que no cambia el perfil no se anuncia;
  - una navegación sin recargar sí se anuncia;
  - sin la extensión, la página no se rompe.
- **`src/app/api/extension/workspace/route.test.ts`:** los créditos de la persona, sin perfil, y otra cuenta rechazada.
- **`scripts/test-linkedin-extension-browser.mjs`** (Chromium, con la frontera de Chrome simulada):
  - el flujo completo, en claro y oscuro, a 320, 380 y 520 px;
  - créditos, estados y el paso siguiente;
  - pestañas con teclado;
  - el cambio de perfil por aviso, y que sin aviso no se consulta nada en 2 segundos.
  - Para correrlo sin Chrome estable: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<ruta de Chromium>`.

## Publicación

- **Se compila con `npm run extension:build`.** El ZIP para la tienda y la versión (4.1.0, al cerrar la fase 4) los publica el mantenedor.
- **Permisos:** no hay permisos nuevos.
