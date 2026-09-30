# Cowork · Inicio vivo (30 sep 2026)

Plan 2, punto V7. El inicio de Cowork deja de ser una pantalla fija:
- saluda por el nombre;
- muestra en una línea cómo está la cuenta, con cifras reales;
- si ANTON.IA no sabe qué vende el usuario, se lo pregunta con una tarjeta.

Además, lo que el usuario aprobó que ANTON.IA recuerde (su «Memoria») llega a cada turno de Cowork.

## Qué cambia para el usuario

- **Saludo:** «Buenas tardes, Nicolás. ¿En qué avanzamos hoy?». Sin nombre en el perfil, queda como antes.
- **Tu cuenta, en una línea bajo el cuadro:** «128 contactos guardados · 96 con correo · 3 campañas · 7 de 20 invitaciones de LinkedIn esta semana».
  - Las cifras cuentan hasta su valor una vez, al llegar (desde la mitad, como las cifras de las tarjetas); las de 9 o menos, y todas con «reducir movimiento», aparecen quietas.
  - Mientras cargan, una línea tenue ocupa su lugar, sin saltos.
  - Una cifra que no se pudo leer no se muestra: nunca un cero inventado.
  - Sin contactos ni campañas, en vez de ceros: «Aún no tienes contactos guardados: empieza buscando prospectos nuevos.».
- **«Cuéntame qué vendes»** aparece solo si no hay oferta, ni en el perfil ni en la configuración de la organización:
  - dos campos: «Qué vendes y a quién» y «Tu sitio web (opcional)»;
  - «Guardar en mi perfil» se habilita con texto y envía a Cowork «Guarda en mi perfil lo que vendo: … Mi sitio web es …»;
  - Cowork consulta el perfil y propone el cambio (`profile.update`) con su tarjeta de aprobación de siempre: nada se guarda hasta aprobarla;
  - si el envío falla, lo escrito queda en la tarjeta;
  - «Ocultar por ahora» la cierra en ese navegador.
- **Los botones de inicio** entran uno tras otro, con 45 ms de diferencia; con «reducir movimiento» ya están ahí.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Cifras del inicio: `GET /api/cowork/overview` | `src/app/api/cowork/overview/route.ts` |
| Forma de las cifras, nombre para el saludo y mensaje de la tarjeta | `src/lib/cowork/overview.ts` |
| Inicio: saludo, cifras, tarjeta y botones escalonados | `src/components/cowork/CoworkHome.tsx` |
| Lectura del resumen cada vez que se vuelve al inicio, y envío de la tarjeta | `src/components/cowork/CoworkWorkspace.tsx` |
| Memorias aprobadas en el contexto del turno | `loadCoworkMemories` en `src/lib/server/cowork/user-context.ts` |
| Cómo las usa el modelo | `memories` e instrucción en `src/lib/cowork/decision-context.ts` |
| Receta para guardar la oferta | regla de `profile.get` y `profile.update` en `agent-instructions.ts` |

- **La ruta del resumen:**
  - pide acceso a Cowork (`requireCoworkAccess`);
  - cuenta con el mismo alcance que usa Cowork: contactos guardados propios en la organización activa (y cuántos tienen un correo no vacío) y campañas propias;
  - solo cuenta (`head: true`): no lee filas ni direcciones;
  - las invitaciones de LinkedIn se leen con el rol del servidor, porque esa tabla no se lee con la sesión del usuario (como `linkedin.quota`), filtradas por usuario y organización; solo salen dos cifras;
  - el nombre y si hay oferta salen de `loadCoworkUserContext`, sin leer memorias;
  - cada cifra falla por separado (queda `null`); responde `Cache-Control: private, no-store`.
- **Memorias:**
  - se leen una vez por turno, junto al nombre y la oferta: las aprobadas (`status = approved`) de la organización y las propias del usuario;
  - nunca las personales de un compañero ni las vencidas;
  - hasta 8, las más recientes, de hasta 240 caracteres cada una y sin repetidas;
  - si la lectura falla, el turno sigue sin ellas;
  - **sin memorias, el contexto del turno es idéntico al de antes**, byte a byte.
- **La instrucción del modelo:** las memorias son cosas que el usuario aprobó recordar (preferencias, su negocio, cómo quiere que le escriban). Las sigue al redactar y decidir, salvo que el pedido de ahora diga otra cosa, y no las presenta como datos consultados.
- **La receta de la tarjeta:** con «Guarda en mi perfil lo que vendo: …», Cowork consulta `profile.get` y propone `profile.update` con `valueProposition`:
  - con las palabras del usuario ordenadas en una o dos frases;
  - sin agregar cifras, clientes, precios ni promesas;
  - con `website` si lo dio.
- **Arreglo en `profile.update`, que la tarjeta necesitaba** (`profile-proposal.ts` y `agent-loop.ts`):
  - **El problema:** la salida estructurada estricta obliga al modelo a mandar todos los campos del perfil. Un campo sin cambio llegaba como `null` y el esquema lo rechazaba, así que el turno fallaba. La otra salida del modelo era llenar todos los campos, con cargo, sector, servicios y hasta una firma desactivada.
  - **En `main`,** 2 de 3 turnos de «guardar lo que vendo» fallaban o tocaban la firma.
  - **Ahora** el modelo recibe esos campos como anulables (`coworkProfileDecisionSchema`). `null` o vacío significa «déjalo como está», y la propuesta lleva solo lo que cambia (`coworkProfilePatchFromDecision`).
  - La regla del modelo dice que en `profile` van solo los campos que el usuario pidió cambiar, y la firma solo si pidió cambiarla.

## Validación

**Pruebas sin modelo** (`npm run test:unit` y `verify-cowork`):
- `overview.test.ts` (3): nombre para el saludo; cifras en orden, en singular o plural, sin las que no se pudieron leer; y el mensaje de la tarjeta.
- `user-context.test.ts` (+2):
  - memorias de la organización y propias, sin las de un compañero ni vencidas ni repetidas, recortadas y hasta 8;
  - solo aparecen si hay; el inicio no las lee; una falla no rompe el contexto.
- `decision-context.test.ts` (+1): la instrucción de memorias solo con memorias, y la receta de la tarjeta.
- `profile-proposal.test.ts` (nuevo, 2):
  - lo que el modelo manda en modo estricto (todo, con `null` donde no cambia) queda en solo lo que cambia;
  - sin cambios no hay propuesta;
  - una firma vacía no es un cambio de firma;
  - el esquema que recibe el modelo deja cada campo en `null`.
- `test-cowork-workspace.mjs`: la página sigue hablando solo con la API de Cowork, ahora también con el resumen del inicio.
- `scripts/test-cowork-overview-route.mjs` (en `verify-cowork`):
  - sin acceso, 403 y no lee nada;
  - solo cuentas propias, sin filas;
  - LinkedIn con el rol del servidor y tu alcance;
  - una cifra que falla queda `null`, sin mostrar el detalle del error;
  - sin perfil, «¿hay oferta?» queda desconocido.
- **Corpus sin modelo:** un caso nuevo, `guardar-oferta` (el mensaje exacto de la tarjeta, y la decisión ideal con la forma estricta). Cowork:
  - consulta el perfil;
  - propone `profile.update` con la oferta y el sitio;
  - no agrega cifras;
  - no toca la firma ni datos que no se pidieron.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-v7.mjs`: 128 contactos, 96 con correo, 3 campañas y 7 invitaciones de LinkedIn en la semana; con y sin oferta, y una cuenta vacía). Lo que la página envía se captura, y la respuesta es un error local, así que no se crea nada. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **Saludo y cifras:**
  - «Buenas noches, Nicolás. ¿En qué avanzamos hoy?»;
  - «128 contactos guardados · 96 con correo · 3 campañas · 7 de 100 invitaciones de LinkedIn esta semana»;
  - la primera cifra parte desde la mitad y cuenta hasta 128 (la prueba la vio pasar por 64 a 81); con movimiento reducido aparece en 128.
- **«Cuéntame qué vendes»:**
  - «Guardar en mi perfil» empieza desactivado y el campo muestra su anillo de foco;
  - se envía «Guarda en mi perfil lo que vendo: revisión de antecedentes laborales en minutos, para equipos de RR. HH. en Chile. Mi sitio web es https://yago.cl.»;
  - tras el error local, la tarjeta vuelve con lo escrito, lista para reintentar;
  - «Ocultar por ahora» la cierra, y sigue cerrada al recargar;
  - con oferta no aparece.
- **Botones de inicio:** los 6 entran con 120, 165, 210, 255, 300 y 345 ms de retraso, sin animación con movimiento reducido, y uno llena el cuadro.
- **Cuenta vacía:** «Aún no tienes contactos guardados: empieza buscando prospectos nuevos.», sin ceros.
- **En todos los casos:**
  - sin errores de página ni scroll horizontal;
  - las cifras miden 17,9 de contraste en claro y 16,1 en oscuro, y sus palabras 4,76 y 7,8.
  - `/cowork` queda en 240 kB de carga inicial, como `main`.
- **Lo que corrigió la primera pasada:** tras un envío fallido, la tarjeta volvía vacía, porque al enviar se abre la conversación y el inicio se desmonta. Ahora lo escrito queda en el espacio de trabajo.

**Con el modelo real** (`gpt-6-luna`, con la Redactora y el juez del turno encendidos, como en producción; juez offline `gpt-6-sol`; mismo día):

| | Casos que pasan | Verificaciones | Juez: buenas / mejorables / malas | Fricción | Mediana |
|---|---|---|---|---|---|
| `guardar-oferta`, `main` × 3 | 0 de 3 | 27 de 33 | 1 / 0 / 2 | 2,0 | 17,7 s |
| `guardar-oferta`, este PR × 5 | 5 de 5 | 55 de 55 | 5 / 0 / 0 | 5,0 | 6,6 s |
| 3 casos de inicio y correo, `main` × 3 | 7 de 9 | 91 de 93 | 7 / 0 / 2 | 4,56 | 14,2 s |
| Los mismos, este PR × 3 | 8 de 9 | 92 de 93 | 5 / 3 / 1 | 4,67 | 19,4 s |

- **En `main`, guardar la oferta falla de tres formas:** un turno que no termina; una propuesta que cambia firma, cargo, sector y servicios; o ninguna propuesta. Con este PR, las 5 proponen solo la oferta y el sitio.
- **Los casos de regresión** (`mkt-que-puedes-hacer`, `mkt-mejorar-correo` e `inicio-escribir`) no usan memorias ni el perfil. Sus diferencias son de redacción y caben en el ruido medido antes.
  - Dos de las «mejorables» de este PR vienen de una falla que ya está en `main`: la pregunta final se corta en «RR. HH.» y se repite. El juez la señaló también en corridas anteriores. Va en otro PR.

## Límites

- **Las cifras se leen al abrir el inicio,** no en vivo: después de trabajar se ven al volver a él.
- **«Ocultar por ahora» vive en ese navegador.** En otro, la tarjeta vuelve mientras no haya oferta.
- **Cowork no lee el sitio web:** lo guarda en el perfil tal como se escribió.
- **Las memorias se aprueban donde ya se aprobaban** (la Memoria de ANTON.IA); Cowork solo las lee.
