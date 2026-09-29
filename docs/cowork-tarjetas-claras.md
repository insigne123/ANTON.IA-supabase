# Cowork · tarjetas que dicen dónde están y de dónde salen (28 sep 2026)

Cuarto PR de la Ola V del plan 2 de Cowork (punto V3): cada resultado dice qué es, en qué estado está y de dónde salió, sin tener que abrirlo.

## Qué cambia para el usuario

- **Cada correo o secuencia dice dónde está**, al final de su tarjeta:
  - «Borrador · no se ha enviado»: nadie lo usó todavía;
  - «Editado por ti · no se ha enviado»: lo cambiaste en el panel (la edición vive en esta pestaña);
  - «Versión elegida · no se ha enviado»: lo mandaste con «Usar esta versión»;
  - si pediste una campaña con esa versión: «Preparando la campaña…», «Campaña propuesta · espera tu aprobación», «Creando la campaña…», «Campaña creada · pausada», «Campaña descartada · no se creó» o «No se pudo crear la campaña».
  - Cuando cambia, el estado se reemplaza con un fundido.
- **De dónde sale la respuesta:** la línea «Siguió un plan de 3 pasos y hizo 2 consultas» muestra al lado lo que encontraron esas consultas («3 contactos», «sin envíos»).
  - En teléfono no hay espacio para los chips: el detalle está al abrir la línea.
  - Los lectores de pantalla oyen «Encontró: 3 contactos, sin envíos».
- **Cifras:** cuando la respuesta llega mientras miras, los números enteros de más de 9 cuentan hasta su valor («1.240», «45%»). Al terminar se leen exactamente como los escribió Cowork; los decimales no se animan.
- **Tablas:**
  - las filas entran una tras otra cuando la tarjeta aparece;
  - una columna de solo «Sí» y «No» se ve con íconos (check y guion), con el texto para lectores de pantalla.
- **Editar un correo:** al tocar «Listo», las palabras nuevas o cambiadas frente al original se marcan y se apagan en unos 3 s. Las borradas no se marcan.
- **Con «reducir movimiento»:**
  - los números aparecen completos y las filas quietas;
  - la marca de lo editado no se apaga de a poco: desaparece a los 3 s.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Estado de cada tarjeta a lo largo del hilo | `coworkCardStatuses` en `src/lib/cowork/presentation.ts` |
| De qué tarjeta vino un mensaje de versión | `coworkVersionSource` en `src/lib/cowork/blocks.ts` |
| Lo que encontraron las consultas de un turno | `coworkTurnFindings` en `presentation.ts` |
| Número dentro de una cifra, escrito de vuelta igual | `coworkFigureNumber` en `blocks.ts`, más `format` en `CwCount` (`motion.tsx`) |
| Palabras que cambió una edición | `coworkWordDiff` en `blocks.ts` |
| Estado en la tarjeta, cifras, filas, sí/no y marcas | `src/components/cowork/CoworkBlocks.tsx` |
| Chips de lo encontrado | `src/components/cowork/CoworkActivity.tsx` |
| Marca que se apaga | `.cw-changed` en `src/styles/cowork.css` |

**Detalles:**
- **Cómo se liga una tarjeta con lo que pasó después:**
  - «Usar esta versión» y «Crear campaña con esta versión» mandan un mensaje que nombra la tarjeta por su título;
  - se toma la última tarjeta con ese título antes de ese turno, y gana el uso más reciente;
  - un mensaje escrito a mano que solo cita el título no cuenta.
- **«Editado por ti»:** el panel guarda la edición en `sessionStorage` (como antes) y avisa a la tarjeta con un evento del navegador; nada sale del navegador.
- **Comparación de palabras:** subsecuencia común más larga, palabra por palabra. Los textos muy largos (más de unas 250 000 combinaciones) no se marcan, para no trabar la página.

Sin migraciones, sin dependencias nuevas y sin cambios de servidor.

**Queda fuera, a propósito:**
- **La tarjeta que se expande hasta el panel (`layoutId`):**
  - necesita las animaciones de layout de `framer-motion` (unos 14 KB más);
  - deformaría el contenido durante el viaje;
  - el panel ya entra deslizándose y la tarjeta abierta queda marcada, como en Claude.
- **Las pestañas entre resultados:** el resumen lateral ya lista los resultados del trabajo.

## Validación

**Pruebas sin modelo:**
- `blocks.test.ts`:
  - de qué tarjeta vino una versión (título, si fue editada y qué pidió);
  - el diff por palabras: solo lo nuevo, una marca por cambio y los textos muy largos sin marcar;
  - el número de una cifra y su escritura de vuelta («45%», «1.200», «US$ 300», «3 de 5»), con los decimales como texto.
- `presentation.test.ts`:
  - lo que encontraron las consultas, en orden y sin repetir;
  - el estado de cada tarjeta a lo largo del hilo: preparando, propuesta, creada, descartada, versión elegida, títulos repetidos y un mensaje escrito a mano que no cuenta.
- `verify-cowork` completo, con la prueba de interfaz en jsdom.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local; probado en claro y oscuro a 1440 px, en claro a 390 px y con reducción de movimiento):
- **Un turno que termina mientras miras:**
  - «1.240» cuenta desde la mitad sin bajar nunca de ahí y termina escrita igual; «45%» y «3 de 5» quedan como vienen;
  - las filas entran con `cw-rise` a los 120, 165, 210, 255 y 300 ms;
  - «Con correo» y «Contactado» se ven con íconos y dicen «Sí» o «No» a los lectores de pantalla;
  - la secuencia dice «Borrador · no se ha enviado» y la tabla no tiene estado;
  - la línea de actividad muestra «3 contactos» y «sin envíos» en escritorio y los oculta en teléfono; su nombre accesible dice «Encontró: 3 contactos, sin envíos».
- **Editar en el panel:**
  - al tocar «Listo» se marca «en minutos», lo agregado;
  - a los 3,6 s no queda ninguna marca;
  - la tarjeta dice «Editado por ti · no se ha enviado»;
  - «Volver al original» la deja en «Borrador · no se ha enviado» y borra la edición guardada.
- **Un hilo con «Crear campaña con esta versión» esperando aprobación:** la tarjeta dice «Campaña propuesta · espera tu aprobación», en el color de atención del tema claro y del oscuro.
- **Con reducción de movimiento:** la cifra aparece completa de una vez y las filas no se animan.
- **En todos los casos:** sin errores de página y sin scroll horizontal.
- **Peso:** `/cowork` queda en 245 KB de carga inicial, 2 KB más que el PR anterior.
- **Arreglo de paso:** `CwCount` (del PR de V1) podía empezar un par de unidades por debajo de su inicio, porque el primer cuadro trae una marca de tiempo algo anterior. Ahora el avance nunca es negativo.
