# Ayuda: recorrido por toda la app, «?» en cada pantalla y Centro de ayuda (1 oct)

**Pedido:** que el tutorial sea más informativo y lleve a la persona por toda la app, que cada pantalla tenga un botón «?» para preguntarle a la IA o leer preguntas frecuentes, y un manual con toda la información.

**Antes:**
- El recorrido v2 resaltaba entradas del menú, pero no abría las pantallas ni mostraba sus controles.
- «Ayuda» solo repetía la guía corta de la pantalla, y no aparecía en pantallas sin guía (Privacidad, Firmas y estilo, Tabla de datos).
- No había manual dentro de la app. `docs/manual-de-usuario-antonia.html` es un documento aparte, anterior al menú actual.

## Qué hay ahora

### 1. Un manual, una sola fuente (`src/lib/help/manual.ts`)

- **Secciones (18):** Primeros pasos, Hoy, Buscar prospectos, Oportunidades, Por completar, Por escribir, Preparar y enviar un correo, Empresas guardadas, Tabla de datos, Conversaciones, Campañas, Pipeline, Perfil, Conexiones, Firmas y estilo, Privacidad, Créditos y uso diario y Administración.
- **Cada sección tiene:**
  - para qué sirve;
  - cómo se usa, paso a paso;
  - consejos;
  - preguntas frecuentes;
  - secciones relacionadas;
  - las rutas cuyo «?» la abre.
- **Datos comprobados en el código:** cada botón y cada cifra salen de la pantalla. Por ejemplo, hasta 100 personas por campaña, 50 contactos por investigación, el teléfono a 10 créditos y el cupo diario que se reinicia a medianoche UTC.
- **Mismas reglas que el menú:** Oportunidades y Empresas guardadas solo aparecen si la función está encendida, y Administración solo para dueños y administradores. Cowork no está en el manual porque hoy es solo para el dueño.

### 2. Recorrido v3: abre cada pantalla (`PRODUCT_TOUR_VERSION = 3`)

- **Pasos:** 15 en escritorio y 16 en el teléfono (el primero muestra el botón del menú).
  - El recorrido abre cada pantalla y resalta su control real: Hoy (lo primero y la preparación), Perfil (Complétalo con IA y la oferta), Conexiones, Buscar prospectos (modos y puntos de partida), Por completar, Por escribir (investigar y contactar), Conversaciones, Campañas y Pipeline.
  - Termina en el «?» de la barra superior y en «Centro de ayuda».
- **Progreso con sección:** la tarjeta dice «Paso 3 de 15 · Perfil». El lector de pantalla lo anuncia igual.
- **Cómo navega:** cada paso tiene `route`. El recorrido abre esa pantalla con el router y espera a que aparezca el control.
  - Un control debajo del pliegue se desplaza a la vista una sola vez.
  - Si la pantalla está vacía (por ejemplo, «Por escribir» sin contactos), a los 2,5 s la tarjeta dice «Esta pantalla aún no muestra este control: aparece cuando hay datos aquí», sin resaltar nada.
- **Retoma tras recargar:** el paso en curso se guarda en `sessionStorage['antonia:tour-progress:<userId>']` y se borra al terminar u omitir.
- **Al terminar:**
  - «Empezar en Hoy» lleva a «Hoy», que dice qué hacer primero, y «Terminar» se queda donde está.
  - Las guías de las pantallas que el recorrido ya mostró se marcan como vistas: un solo `POST /api/onboarding/tour` con `{ guides: [...] }`, para que no se vuelvan a ofrecer solas.
- **Se mantiene igual:**
  - bienvenida, «Omitir», Escape y flechas;
  - menú plegado en escritorio;
  - repetirlo desde «Ver tutorial» sin reescribir la cuenta.
- **Cuentas nuevas:** el cambio de versión vuelve a ofrecer el recorrido una vez a cuentas de menos de 30 días que no vieron la v3.

### 3. «?» en cada pantalla (`src/components/help/PageHelp.tsx`)

- **Dónde:** el botón «Ayuda» de la barra superior. Abre un panel lateral con la sección de la pantalla.
- **Qué tiene el panel:**
  - «Ver guía de esta pantalla», si la pantalla tiene guía;
  - cómo se usa;
  - consejos;
  - preguntas frecuentes (acordeón);
  - «Pregúntale a la IA»;
  - «Abrir el Centro de ayuda», que va a la misma sección del manual;
  - «Ver el recorrido por toda la app».
- **Pantallas que antes no tenían ayuda:** ahora la tienen, por ejemplo Privacidad, Firmas y estilo, Tabla de datos, Componer y Secuencia, Gmail y Outlook, y Administración.
- **Sin ayuda:** solo `/cowork` y el propio Centro de ayuda.

### 4. «Pregúntale a la IA» (`POST /api/help/ask`)

- **Entrada:** `{ question, sectionId? }`, con la pregunta entre 3 y 500 caracteres. Requiere sesión (`requireAuth`).
- **Límite:** 8 preguntas cada 5 minutos por persona y por instancia. Al pasarse, responde 429 con «Hiciste varias preguntas seguidas…».
- **Respuesta:** `answerHelpQuestion` (`src/lib/help/answer-help-question.ts`) envía al modelo el manual visible para esa persona, la pantalla desde donde pregunta y la pregunta. El modelo es el de siempre (`OPENAI_MODEL`).
  - Responde en 2 a 5 frases, solo con el manual. Si el manual no lo cubre, lo dice y sugiere escribir al administrador.
  - Cita hasta 3 secciones, que aparecen como enlaces «Leer más». Se descartan las secciones inventadas u ocultas para esa persona.
- **Si el modelo falla o tarda más de 25 s:** se responde con las preguntas frecuentes más cercanas del manual, con la búsqueda sin tildes.
- **Qué no hace:** no lee la base de datos, no escribe nada y no guarda la pregunta.

### 5. Centro de ayuda (`/ayuda`)

Rediseñado en el Plan 5 (PR-11); detalle en `docs/ayuda-visual.md`.

- **Entrada en el menú:** «Centro de ayuda», al pie, sobre «Ver tutorial». Queda marcada también en la página de cada sección.
- **Portada:**
  - buscador grande, sin tildes ni mayúsculas, con las preguntas frecuentes primero;
  - «Tu camino al primer correo»: 6 pasos numerados con íconos;
  - «Preguntas populares», con la respuesta a la vista;
  - «Todos los temas»: una tarjeta por sección, agrupadas;
  - «Pregúntale a la IA», fija al costado en escritorio;
  - «Ver recorrido por la app».
- **Una página por sección (`/ayuda/perfil`):**
  - pasos como tarjetas numeradas;
  - consejos y preguntas frecuentes;
  - «Ir a <pantalla>» y «Ver guía en pantalla», que abre la pantalla con `?guia=1` y arranca su guía;
  - «Sigue con», con las secciones relacionadas.
- **Enlaces directos:** `/ayuda/perfil`. Lo usan el «?», las respuestas de la IA y la guía de Cowork. Los enlaces antiguos (`/ayuda#perfil`) llevan a la página de la sección.

## Medición con el modelo real

Comando: `npx tsx scripts/evaluate-help-ask.ts --live`. No lee la base de datos ni envía nada.

| Pregunta | Secciones citadas | Segundos | Correcta |
|---|---|---|---|
| ¿Cómo envío mi primer correo? | primeros-pasos, correo, por-escribir | 2,7 | sí |
| Busqué el correo de un contacto y desapareció de la lista, ¿dónde quedó? | por-completar | 1,7 | sí |
| Pegué un perfil de LinkedIn y no encontró a la persona | buscar | 4,0 | sí |
| ¿A cuántas personas puedo escribir en una campaña? | campanas | 1,8 | sí |
| ¿La IA manda los correos sola? | primeros-pasos, correo, campanas | 2,0 | sí |
| ¿Dónde cambio mi firma? | firmas | 1,7 | sí |
| Me quedé sin créditos, ¿qué hago? | creditos, hoy | 1,5 | sí |
| Alguien me respondió pero no lo veo en la app | conversaciones, conexiones | 1,4 | sí |
| ¿Por qué la IA no puede redactar mis correos? | perfil, por-escribir | 1,6 | sí |
| ¿Cómo invito a alguien de mi equipo? (admin) | administracion | 1,6 | sí |
| ¿Cuánto cuesta el plan premium? | — (dice que el manual no lo indica) | 1,4 | sí |
| ¿Cuál es la capital de Francia? | — («Solo puedo ayudarte con el uso de ANTON.IA») | 1,1 | sí |

Resultado: **12 de 12**, de 1,1 a 4,0 s.

- **Criterio para una respuesta con tema:** cita una sección esperada y nombra lo clave (por ejemplo, «100», «Enviar ahora» o «Actualizar mis respuestas»).
- **Criterio para una pregunta sin tema:** dice que no lo sabe.

## Mantener el manual al día

- **Cambia un botón o una pantalla:** cambia también su sección en `manual.ts`. La IA solo sabe lo que dice el manual.
- **Pantalla nueva en el menú:** la prueba `manual.test.ts` falla hasta que tenga su sección («every entry of the menu has its help»).
- **Paso nuevo en el recorrido:** agrega `route`, `section` y un `data-tour` literal en el control. La prueba exige que la ruta exista como página y que el ancla esté en el código.

## Pruebas

- `src/lib/help/manual.test.ts`:
  - secciones completas;
  - rutas reales;
  - cada entrada del menú con ayuda;
  - el «?» de cada pantalla;
  - visibilidad por rol;
  - búsqueda sin tildes;
  - nada interno ni retirado (agente, proveedores).
- `src/lib/help/answer-help-question.test.ts`: con un modelo falso, comprueba las secciones filtradas, el respaldo del manual, el corte a 500 caracteres y el límite de preguntas.
- `src/lib/onboarding/product-tour.test.ts`: pasos, orden, rutas reales, anclas existentes, guías que cubre el recorrido y comparación de rutas.
- `scripts/test-product-tour.mjs` (jsdom, en `test:unit`) cubre:
  - el recorrido completo abriendo cada pantalla;
  - la pantalla vacía;
  - volver atrás;
  - omitir;
  - repetir;
  - retomar tras recargar;
  - menú plegado;
  - el teléfono.
- `scripts/test-page-guides.mjs`: guías por pantalla repetidas desde el panel «?», y ayuda en pantallas sin guía.
- `scripts/test-help-center.mjs` (vía `__tests__/help-center-ui.test.mjs`): el manual por rol, el buscador, la IA, el respaldo del manual, el límite y el recorrido.

## Límites

- **El límite de preguntas es por instancia del servidor:** con varias instancias, alguien podría hacer algunas preguntas más. Basta para evitar bucles, no es facturación.
- **Recorrido con cambios sin guardar:** el recorrido cambia de pantalla. Si alguien lo inicia desde «Ver tutorial» con cambios sin guardar (por ejemplo, en «Perfil»), los pierde. La bienvenida solo se ofrece a cuentas nuevas.
- **Respuestas de la IA:** no se guardan. Por eso no hay métrica de qué se pregunta más. Si se quiere medir, hace falta una tabla y una decisión de privacidad aparte.
