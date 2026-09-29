# Cowork · aprobaciones que se entienden antes y después de decidir (28 sep 2026)

Quinto PR de la Ola V del plan 2 de Cowork (punto V4): una propuesta dice qué va a pasar y qué no antes de que la apruebes, y la misma tarjeta la sigue hasta el resultado.

## Qué cambia para el usuario

- **Qué va a pasar y qué no pasa:** arriba de cada propuesta, una frase para cada cosa, antes de los detalles.
  - Ejemplo: «Se crea la campaña con estos correos, pausada.» / «No se envía nada: activarla pide otra aprobación.»
  - Cada tipo de acción tiene sus frases: guardar, enriquecer, enviar, campañas, código, perfil, búsquedas, CRM, LinkedIn…
- **Una línea de tiempo:** Propuesta → Tu aprobación → Ejecución → Resultado.
  - «Tu aprobación» espera quieta, con el color de atención;
  - la ejecución gira mientras corre;
  - cada paso hecho dibuja su check y la línea avanza hasta donde va.
- **La misma tarjeta sigue a la acción:**
  - al aprobar, el botón muestra que guarda;
  - después los detalles se pliegan y el título pasa por «Aprobado: …», «Ejecutando: …» y «Aprobaste: …»;
  - si la acción tiene una página, aparece el enlace: «Ver campañas», «Ver tus contactos», «Ver en Contactados» o «Ver tu perfil».
  - Si falla, dice «No se pudo completar: …» y marca la ejecución en rojo.
- **Descartar pliega la tarjeta en una línea:** «Descartaste: Crear campaña · No se ejecutó ningún cambio.»
- **Aviso al llegar:** cuando la propuesta aparece, entra y un anillo sale una sola vez alrededor de ella. No hay nada que lata en bucle.
- **«Cowork espera tu decisión»:**
  - si te alejas de la propuesta pendiente, el botón flotante que lleva al final lo dice, con una flecha hacia donde está;
  - al tocarlo, la tarjeta queda a la vista y con el foco.
- **Con «reducir movimiento»:** sin anillo, sin desplazamientos y con el check ya dibujado.
- **Lectores de pantalla:**
  - cada cambio de estado se anuncia una vez;
  - la línea de tiempo dice el estado de cada paso.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Qué pasa y qué no, por tipo de acción | `coworkProposalOutcome` en `src/lib/cowork/presentation.ts` |
| Estado de cada paso de la línea de tiempo | `coworkProposalTimeline` (mismo archivo) |
| Enlace al resultado | `coworkProposalLink` (mismo archivo) |
| Tarjeta única que sigue a la propuesta | `CoworkApproval` en `src/components/cowork/CoworkApproval.tsx` |
| Botón que muestra que guarda | `ReviewActions` en `ReviewParts.tsx` |
| Botón flotante «Cowork espera tu decisión» | `CoworkWorkspace.tsx` (`IntersectionObserver` sobre la tarjeta pendiente) |
| Anillo que sale una vez | `.cw-rise-attention` en `src/styles/cowork.css` |

- **Qué se reusa:** el check dibujado del plan (`DoneMark`, de V1) marca los pasos hechos.
- **Qué se quitó:** la nota final de la búsqueda externa decía lo mismo que «Qué va a pasar», así que ya no está. El límite se lee en «Qué va a pasar» («Se buscan hasta 5 contactos nuevos…»).
- **Los detalles y los botones salen de inmediato al decidir:** un botón que se estuviera plegando todavía se podría tocar dos veces. Lo que se anima es el título, la línea de tiempo y el plegado de la tarjeta descartada, que ya no contiene botones.
- **Qué no cambia:** los textos que ya leían las pruebas («Necesita tu aprobación», «Aprobaste: …», la sección «Revisar acción propuesta»).

Sin migraciones, sin dependencias nuevas y sin cambios de servidor.

## Validación

**Pruebas sin modelo:**
- `presentation.test.ts`:
  - qué pasa y qué no para cada tipo de acción, la búsqueda y la nota;
  - la línea de tiempo en cada estado: pendiente, en curso, hecha, descartada y fallida;
  - el enlace solo para una acción terminada que tiene su página.
- `verify-cowork` completo, con las pruebas de interfaz en jsdom:
  - `test-cowork-workspace.mjs` y `test-cowork-conversation-flow.mjs` siguen leyendo «Necesita tu aprobación», «Aprobaste: …» y la sección «Revisar acción propuesta»;
  - `test-cowork-search-queue-ui.mjs` ahora busca el límite en «Qué va a pasar» y comprueba que, al aprobar, el botón desaparece al instante.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local; la aprobación se intercepta y la responde el simulado, sin crear nada real; claro y oscuro a 1440 px, claro a 390 px y con reducción de movimiento):
- **Al llegar la propuesta:**
  - entra con `cw-rise` y el anillo `cw-attention` sale una vez;
  - con reducción de movimiento no hay animación;
  - «Qué va a pasar: Se crea la campaña con estos correos, pausada.» y «Qué no pasa: No se envía nada: activarla pide otra aprobación.»;
  - la línea de tiempo marca Propuesta (hecho), Tu aprobación (en curso), Ejecución y Resultado (pendientes).
- **Lejos de la propuesta:**
  - el botón flotante dice «Cowork espera tu decisión»;
  - al tocarlo, la tarjeta queda a la vista y con el foco, y el botón se va.
- **Al aprobar:**
  - el título pasa por «Crear campaña», «Aprobado: Crear campaña», «Ejecutando: Crear campaña» y «Aprobaste: Crear campaña»;
  - la línea de tiempo termina completa;
  - los detalles ya no están y aparece «Ver campañas» (`/campaigns`).
- **Al descartar:** la tarjeta queda en una línea de 88 px (107 px en teléfono), sin línea de tiempo: «Descartaste: Crear campaña · No se ejecutó ningún cambio.»
- **En todos los casos:** sin errores de página y sin scroll horizontal.
- **Peso:** `/cowork` queda en 247 KB de carga inicial, 2 KB más que el PR anterior. Con `next/link` eran 251 KB, por eso el enlace es un `<a>`.
