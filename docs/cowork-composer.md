# Cowork · Composer con «@» y «/» (30 sep 2026)

Plan 2, punto V6. El cuadro donde se escribe a Cowork gana dos atajos, como en Claude y otros chats de trabajo:
- **«@»** nombra a un contacto guardado. Cowork sabe exactamente quién es, sin buscarlo por nombre ni preguntar «¿cuál Marcela?».
- **«/»** al comenzar un mensaje abre las plantillas del inicio para usarlas sin volver a él.

No hay migración ni flag: la mención viaja dentro del mensaje, como ya viajaba el contacto elegido desde una tabla.

## Qué cambia para el usuario

- **«@» y unas letras** (al inicio o después de un espacio) abre, sobre el cuadro, la lista «Tus contactos guardados»:
  - muestra hasta 6 contactos, cada uno con sus iniciales, su nombre, su cargo · empresa y si tiene correo («Con correo» o «Sin correo»);
  - las letras buscan en el nombre, el cargo, la empresa y el correo, igual que Cowork cuando busca en tus contactos; una sola letra muestra los más recientes cuyo nombre o apellido empieza con ella; sin letras, los más recientes;
  - un correo escrito en el texto («mrojas@sodexo.cl») no abre la lista, y un espacio la cierra;
  - si no hay nada, lo dice («No encontré contactos guardados con ese nombre.»); mientras busca, «Buscando en tus contactos…».
- **Al elegir** (Enter, Tab o un clic), el texto queda como «escríbele a @Marcela Rojas » y el cursor sigue después del nombre.
- **En la conversación,** la mención se ve como una etiqueta de color dentro de tu mensaje. El ID del contacto nunca se ve: ni en la burbuja, ni en el título del trabajo, ni en la lista de trabajos.
- **«/» al comenzar un mensaje** abre «Plantillas»: las 6 del inicio («Escribir a mis contactos», «¿A quién le escribo hoy?», «Mejorar un correo»…).
  - Unas letras las filtran, sin importar los acentos («/mej», «/como»).
  - Enter escribe la plantilla en el cuadro. Si trae algo por completar, queda seleccionado para escribir encima: en «Mejorar un correo» se selecciona «[pega aquí tu correo]».
  - Una barra dentro de una frase («ventas 2025/2026») es texto y no abre nada.
- **Teclado:**
  - el foco no sale del cuadro: ↑ y ↓ recorren la lista, Enter o Tab eligen, Escape la cierra sin borrar nada ni cerrar otra cosa;
  - después de Escape, seguir escribiendo la misma mención no reabre la lista; un «@» nuevo sí;
  - la línea «↑ ↓ para moverte · Enter para elegir · Esc para cerrar» lo recuerda en pantallas anchas.
- **Lectores de pantalla:**
  - el cuadro anuncia que tiene lista (`aria-autocomplete="list"`) y cuál es la opción activa (`aria-controls` y `aria-activedescendant`);
  - la lista es un `listbox` con `option` y `aria-selected`;
  - al abrirse se anuncia cuántos contactos o plantillas hay.
- **Movimiento:** la lista aparece con el mismo «pop» corto de los menús, desde la esquina del cuadro. Con «reducir movimiento», solo un fundido.
- **Si el envío falla,** el texto vuelve al cuadro y la mención sigue ligada a su contacto: al reenviar viaja igual. Lo mismo si se recarga la pestaña con el mensaje a medio escribir: el borrador vuelve con sus menciones.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Reglas del atajo: qué se está escribiendo antes del cursor (`coworkComposerToken`), insertar la mención, las referencias del mensaje, leerlas de vuelta, partir el texto en etiquetas, filtrar plantillas y ubicar lo que falta completar | `src/lib/cowork/mentions.ts` |
| Contactos para «@»: `GET /api/cowork/contacts?q=` | `src/app/api/cowork/contacts/route.ts` |
| Lista sobre el cuadro | `src/components/cowork/ComposerShortcuts.tsx` |
| Teclado, búsqueda y selección | `src/components/cowork/CoworkComposer.tsx` |
| El mensaje con sus referencias, y el borrador de la pestaña con sus menciones | `post()`, `readDraft` y `writeDraft` en `src/components/cowork/CoworkWorkspace.tsx` |
| Etiquetas en tu mensaje | `CoworkUserMessage` en `src/components/cowork/CoworkAttachments.tsx` |
| El ID fuera de la vista | `coworkDisplayMessage` en `src/lib/cowork/presentation.ts` |
| Regla del modelo | regla de `leads.search` y `leads.get` en `agent-instructions.ts` |

- **Cómo viaja una mención.** El texto lleva «@Marcela Rojas» y, al final del mensaje, «(ID de Marcela Rojas: <uuid>)», una línea por persona:
  - solo de las menciones que siguen en el texto (si se borra «@Marcela Rojas», su referencia no viaja);
  - una vez por persona, aunque se nombre dos veces;
  - antes del bloque «Adjuntos:», que sigue siendo lo último del mensaje.

  Es la misma forma que ya usaba «Preguntar por este contacto» desde una tabla («(ID del contacto: …)»), y la burbuja la oculta igual.
- **La regla del modelo:** si el mensaje nombra a alguien con «@Nombre» y termina con su referencia, el usuario ya eligió ese contacto guardado. Cowork lo lee con `leads.get` y ese ID (con `reads.parallel` si son varios), sin buscarlo por nombre ni preguntar cuál es, y el ID nunca va en su respuesta.
- **La ruta de contactos:**
  - pide acceso a Cowork (`requireCoworkAccess`) y corre con la sesión del usuario;
  - hace la misma consulta que `leads.search` (`queryCoworkLeads`): solo contactos guardados propios en la organización activa, sin el proveedor de prospectos ni créditos;
  - devuelve hasta 6, con lo que la lista muestra (`id`, nombre, cargo, empresa y si tiene correo), nunca la dirección;
  - responde `Cache-Control: private, no-store`; solo signos no es una búsqueda (lista vacía, sin leer nada); un error es 503 «No se pudieron buscar tus contactos.».
- **La búsqueda espera 150 ms** después de la última letra, para no consultar por cada una, y una respuesta vieja nunca reemplaza a una nueva.
- **Las plantillas son los botones del inicio** (`COWORK_STARTERS`), que ya son casos del corpus. Solo «Mejorar un correo» trae algo por completar, así que en lugar del mini formulario que proponía el plan, lo que falta queda seleccionado para escribir encima.

## Validación

**Pruebas sin modelo** (`npm run test:unit` y `verify-cowork`):
- `mentions.test.ts` (4):
  - cuándo abre «@» (al inicio o tras un espacio; no en un correo; un espacio la cierra; solo cuenta lo que está antes del cursor) y cuándo «/» (solo como todo el mensaje);
  - elegir reemplaza lo escrito y deja el cursor después del nombre;
  - las referencias del mensaje (una por persona, solo si sigue en el texto, sin duplicar al reenviar), leerlas de vuelta y partir la burbuja en etiquetas;
  - plantillas filtradas sin acentos, y lo que falta completar.
- `scripts/test-cowork-contacts-route.mjs` (en `verify-cowork`):
  - sin acceso, 403 y no lee nada;
  - solo los contactos propios en la organización;
  - hasta 6, sin direcciones;
  - sin letras, los más recientes; una letra, los recientes cuyo nombre o apellido empieza con ella;
  - solo signos no lee nada.
- `scripts/test-cowork-draft.mjs` (+1 paso): un borrador con una mención vuelve tras recargar y se envía con su referencia; lo que no es un ID de contacto se descarta.
- `decision-context.test.ts` (+1): la regla del modelo.
- **Corpus sin modelo:** un caso nuevo, `mencion-linkedin` («escribele a @Marcela Rojas por linkedin, algo corto presentandome» con su referencia). Cowork:
  - lee a Marcela con `leads.get` y su ID, sin `leads.search` por nombre;
  - propone el mensaje de LinkedIn a Marcela;
  - no pone el ID en la respuesta.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-v6.mjs`, con cuatro contactos guardados y dos turnos terminados). Lo que la página envía se captura, y la respuesta es un error local, así que no se crea nada. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **Tu mensaje con una mención:** «@Marcela Rojas» se ve como etiqueta y su ID no aparece en ninguna parte de la página.
- **«@» en la conversación:**
  - «escríbele a @mar» abre «Tus contactos guardados» con Marcos Díaz y Marcela Rojas, tras una sola consulta (`q=mar`);
  - el cuadro apunta a la lista y a la opción activa, y se anuncia «2 contactos. Usa las flechas para elegir.»;
  - ↓ y Enter eligen a Marcela: el texto queda «escríbele a @Marcela Rojas », con el cursor al final y la lista cerrada;
  - se envía «escríbele a @Marcela Rojas por linkedin» con «(ID de Marcela Rojas: …)» al final;
  - tras el error local, el texto vuelve y el reenvío lleva la misma referencia.
- **Escape** cierra la lista, deja el texto y el foco, y seguir escribiendo no la reabre; un «@» nuevo sí, y un clic elige («@Felipe Muñoz »).
- **Una letra** («@a») muestra a Andrea Vega; «@zzz» dice que no encontró contactos.
- **«/»:**
  - muestra las 6 plantillas, con la primera activa aunque el puntero quede encima de la lista;
  - «/mej» deja «Mejorar un correo», y Enter la escribe con «[pega aquí tu correo]» seleccionado para escribir encima;
  - «ventas 2025/2026» no abre nada.
- **En el inicio,** «@» muestra los 4 contactos más recientes.
- **Lista y etiqueta:**
  - quedan dentro de la pantalla, sin scroll horizontal ni errores de página;
  - ningún texto baja de 4,5:1 de contraste (el menor es 4,76);
  - la etiqueta de la mención mide 14,3 en claro y 9,8 en oscuro.
- **Lo que corrigió la primera pasada:**
  - la etiqueta en oscuro (3,3 con el azul sobre la burbuja; ahora va con el color del texto);
  - «Sin correo» y la línea de teclas en gris tenue (3,0);
  - el cargo en la fila activa (4,1);
  - una lista que se abría bajo el puntero quieto tomaba esa fila como activa: ahora solo el puntero que se mueve cambia la opción.

**Con el modelo real** (`gpt-6-luna`, con la Redactora y el juez del turno encendidos, como en producción; juez offline `gpt-6-sol`; mismo día):

| | Casos que pasan | Verificaciones | Juez: buenas / mejorables / malas | Fricción | Mediana |
|---|---|---|---|---|---|
| `mencion-linkedin`, `main` × 3 | 0 de 3 | 24 de 30 | 3 / 0 / 0 | 5,0 | 6,9 s |
| `mencion-linkedin`, este PR × 5 | 5 de 5 | 50 de 50 | 5 / 0 / 0 | 5,0 | 6,4 s |
| 3 casos de LinkedIn y seguimiento, `main` × 3 | 9 de 9 | 84 de 84 | 7 / 2 / 0 | 4,78 | 11,3 s |
| Los mismos, este PR × 3 | 9 de 9 | 84 de 84 | 8 / 1 / 0 | 5,0 | 9,8 s |

- **Con la mención:** `main` busca a Marcela por su nombre (`leads.search`) en las 3; este PR la lee por su ID (`leads.get`) en las 5, sin búsqueda ni pregunta. Las dos llegan al mismo mensaje, por eso el juez las da por buenas: V6 ahorra la búsqueda y la duda entre dos personas con el mismo nombre.
- **Regresión** (`mkt-linkedin-mensaje`, `vale-la-pena` y `mkt-seguimiento`): sin cambio atribuible. Las diferencias del juez son de redacción y caben en el ruido medido antes.

## Límites

- **Una palabra por mención:** un espacio cierra la lista. Basta con el nombre, el apellido, la empresa o el cargo («@rojas», «@sodexo»).
- **Solo contactos guardados propios,** los mismos que Cowork consulta. Los de compañeros y los prospectos sin guardar no aparecen.
- **La mención vive en el mensaje que se está escribiendo** (y en el borrador de esa pestaña). Una «@Nombre» escrita a mano, sin elegirla de la lista, viaja como texto: Cowork busca a esa persona por su nombre, como antes.
- **«/» solo al comenzar.** Para usar una plantilla con un mensaje empezado, se borra lo escrito o se usa el inicio.
