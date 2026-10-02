# Centro de ayuda más claro (Plan 5, PR-11)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`)

El Centro de ayuda era una sola página larga: un índice y las 18 secciones del manual, una tras otra. Para encontrar algo había que buscarlo o bajar. Tampoco se veía por dónde empezar. El usuario pidió que el manual «se vea mejor».

## Qué cambia

### Portada (`/ayuda`)

- **Buscador grande:** sin tildes ni mayúsculas, con las preguntas frecuentes primero. Cada resultado abre la página de su sección.
- **«Tu camino al primer correo»:** 6 pasos numerados, con íconos, en el orden en que se hacen.
  1. Perfil.
  2. Conexiones.
  3. Buscar.
  4. Por completar.
  5. Por escribir.
  6. Conversaciones.
- **«Preguntas populares»:** 5 preguntas con la respuesta a la vista y «Más en <sección>».
- **«Todos los temas»:** una tarjeta por sección, con su ícono y su resumen, agrupadas como el menú.
- **«Pregúntale a la IA»:** fija al costado en escritorio. En el celular va al final; arriba queda el buscador.
- **«Ver recorrido por la app»:** como antes.

### Una página por sección (`/ayuda/<sección>`)

- **Encabezado:** ícono, grupo, título y para qué sirve.
- **«Ir a <pantalla>»:** abre la pantalla.
- **«Ver guía en pantalla»:** abre la pantalla con `?guia=1` y su guía arranca sola cuando sus controles están a la vista, o a los 3 s con los que haya. No muestra antes la tarjeta «¿Te muestro?». Solo aparece si la pantalla tiene guía.
- **«Paso a paso»:** cada paso es una tarjeta numerada.
- **«Consejos»** y **«Preguntas frecuentes»**.
- **«Sigue con»:** las secciones relacionadas que la persona puede ver.
- **«Pregúntale a la IA»:** la pregunta lleva la sección (`sectionId`).
- **Si la sección no existe** o no es para esa cuenta (por ejemplo, Administración para un miembro), lo dice y ofrece «Ir al Centro de ayuda».

### Enlaces

- `helpSectionHref` ahora da `/ayuda/<sección>`. Lo usan el «?» de cada pantalla, las respuestas de la IA y la guía de Cowork.
- Los enlaces antiguos (`/ayuda#perfil`) llevan a la página de la sección, si la persona puede verla.
- «Centro de ayuda» queda marcado en el menú también en la página de cada sección.

## Contenido

`src/lib/help/manual.ts` sigue siendo la única fuente. Se agregan:
- `HELP_ICONS`: el ícono de cada sección, dibujado en `src/components/help/help-icons.tsx` con `lucide-react`;
- `FIRST_EMAIL_PATH`: los pasos del camino al primer correo;
- `POPULAR_QUESTIONS`: las preguntas populares. Se toman del manual palabra por palabra, y la prueba falla si una deja de existir.

## Fuera de este PR

**Capturas reales de cada pantalla.** El plan las pedía en cada sección. Necesitan una cuenta con datos de prueba y una sesión en la app; el arnés aislado no basta. Por ahora se usan «Ver guía en pantalla» y el recorrido, que muestran la pantalla real.

## Pruebas

- **Unitarias (`manual.test.ts`):**
  - cada sección tiene ícono;
  - el camino lo ven todos los miembros;
  - las preguntas populares existen y se ocultan con su sección.
- **DOM:**
  - `scripts/test-help-center.mjs`: la portada por rol, la búsqueda, la IA y los enlaces antiguos;
  - `scripts/test-help-section-page.mjs`: la página de cada sección, su guía, «Sigue con» por rol y las secciones ocultas o inexistentes;
  - `scripts/test-product-tour.mjs`: `?guia=1` arranca la guía sin la oferta y se borra de la dirección.
- **Capturas** en un arnés aislado con Tailwind y los tokens reales: portada y sección en escritorio claro y oscuro, y a 390 px. Sin desborde horizontal.
