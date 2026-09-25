# Tutorial guiado para cuentas nuevas

Recorrido corto por el menú para que una persona nueva sepa dónde está cada cosa. Se ofrece solo una vez, se puede omitir en cualquier paso y se vuelve a ver cuando se quiera desde «Ver tutorial», al final del menú.

## Cómo se ve

1. **Bienvenida.** Al entrar por primera vez aparece un diálogo: «Te damos la bienvenida a ANTON.IA». Tiene dos opciones, «Empezar recorrido» (principal) y «Ahora no», y una nota: «Si lo omites, puedes verlo cuando quieras desde «Ver tutorial», al final del menú.».
2. **Recorrido.** Se oscurece la pantalla y se resalta una entrada del menú a la vez. Una tarjeta al lado muestra «Paso X de Y», un título, una frase y los botones «Atrás», «Siguiente» y «Omitir».
3. **Final.** El último paso resalta «Ver tutorial» y ofrece «Ir a mi perfil» (principal) o «Terminar».

Pasos (textos en `src/lib/onboarding/product-tour.ts`): Perfil → Conexiones → Búsqueda de Leads → Guardados · Leads → Campañas → Leads Contactados → Agente ANTON.IA → Ver tutorial. En escritorio son 8. En el teléfono son 9, porque el primero muestra el botón del menú: las entradas viven en el menú plegado, así que ese botón queda resaltado y la tarjeta dice dónde está cada entrada («En el menú: Perfil»).

## Reglas

- **Cuándo se abre solo:** cuentas con menos de 30 días que no lo han terminado ni omitido en la versión vigente. Las cuentas más antiguas no lo ven solo, pero pueden abrirlo desde «Ver tutorial».
- **Omitir:** «Omitir», «Ahora no», la X o Escape lo cierran y queda registrado como omitido. Omitir a mitad de camino muestra un aviso con el lugar donde volver a verlo. Cerrar en el último paso cuenta como terminado.
- **Volver a verlo:** «Ver tutorial» lo inicia desde el primer paso, sin bienvenida. Repetirlo no cambia lo guardado en la cuenta.
- **Escritorio:** si el menú está plegado, se abre durante el recorrido y se vuelve a plegar al terminar. Si el menú tuvo que desplazarse para mostrar una entrada, vuelve a su posición al cerrar.
- **Teléfono:** si se abre desde el menú lateral abierto, primero lo cierra y luego empieza.

## Dónde se guarda

- En la cuenta: `user_metadata.anton_tour = { version, status: 'completed' | 'skipped', updatedAt }`, escrito por `POST /api/onboarding/tour` con la sesión de la propia persona. `GET` responde `{ record, offer }`. No requiere migración.
- En el navegador: `localStorage['antonia:tour:<userId>']`, para no consultar el servidor cada vez que se carga una página.
- Se guarda desde el servidor a propósito: si el navegador actualiza el usuario, emite `USER_UPDATED` y el contexto de sesión recarga la organización y muestra su estado de carga.

## Cambiar el recorrido

- **Agregar una entrada:** en `src/components/app-sidebar.tsx`, agrega `tour: '<id>'` al ítem del menú, que se convierte en `data-tour="<id>"`, y agrega el paso en `PRODUCT_TOUR_STEPS`. La prueba unitaria exige títulos de hasta 40 caracteres, textos de hasta 140 e indicar en qué entrada del menú está cada paso.
- **Volver a ofrecerlo:** sube `PRODUCT_TOUR_VERSION`. Se ofrece de nuevo solo a cuentas de menos de 30 días.

## Accesibilidad y diseño

- Usa la tarjeta, los botones y el diálogo de `src/components/ui/*`, con los mismos tokens en modo claro y oscuro.
- El foco queda dentro de la tarjeta y parte en la acción principal.
- Las flechas ← → avanzan y retroceden. Cada paso se anuncia al lector de pantalla con «Paso X de Y: título. texto».
- Respeta «reducir movimiento». El anillo del resaltado usa `outline` para que no lo borre la sombra que oscurece la pantalla.
- El resaltado sigue a la entrada en cada cuadro mientras el paso está abierto, porque el menú se mueve después de pintarse (el selector de workspace termina de cargar, el menú se despliega o la ventana cambia de tamaño).

## Verificación (25 sep 2026)

- `node --loader ./scripts/ts-test-loader.mjs --test src/lib/onboarding/product-tour.test.ts`: cuándo se ofrece, lectura de lo guardado y límites de los pasos.
- `node scripts/test-product-tour.mjs` (DOM aislado) cubre:
  - bienvenida;
  - pasos con mouse y teclado;
  - volver atrás y dónde queda el foco;
  - omitir y el aviso;
  - volver a verlo sin reescribir la cuenta;
  - menú plegado;
  - Escape;
  - teléfono, incluido abrirlo desde el menú lateral;
  - resaltado que sigue a una entrada que se movió.
- En navegador contra Supabase local, con cuentas recién creadas, pasaron 30 de 31 revisiones:
  - escritorio 1440×900 en claro y oscuro;
  - teléfono 390×844 en claro y oscuro.

  La que falló fue «sin errores en consola». Esos errores no vienen del tutorial:
  - `/icon.png` responde 500 en desarrollo porque existe a la vez en `public/` y en `src/app/`;
  - el dashboard recibe 403 de `opportunities` y `campaigns` en la base local.