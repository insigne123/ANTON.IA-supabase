# Plan 16: Cowork hace lo que pediste, en palabras simples (8 oct 2026)

Esta ronda sigue el objetivo del Plan 15: que la IA sea útil y que Cowork sea una extensión del usuario. Se partió por lo que el juez
seguía marcando en el banco completo (134 casos) y por los 3 casos que fallaban siempre.

Todo se midió antes y después con el modelo real (`gpt-6-luna`; juez de Cowork `gpt-6.1-sol`), sin astra, sin escrituras en la base y
sin envíos. Ningún PR trae migraciones ni flags nuevos.

## Lo que cambió

| PR | Qué cambia | Medición |
|---|---|---|
| #259 Juez | El juez lee las tarjetas como el usuario: la búsqueda en palabras, el costo y la campaña como texto; sabe que un teléfono cuesta 10 créditos y que sin remitente elegido sale Gmail. Solo cambia la medición. | Las mismas respuestas: buenas 2 → 6 de 8; desaparecen 5 quejas falsas |
| #260 Búsqueda de prospectos | Un cargo por término: separa los cargos juntados con « / » o «;» y descarta el pedazo cortado («… / Gerente de S»). | Pasaba en 6 de 190 búsquedas guardadas (3 %); ahora no puede pasar |
| #261 Consultas | Una consulta ya hecha no vuelve como pregunta ni como botón «Sí, revisa…». Ante el saldo, Cowork dice cuántos contactos no tienen correo. | Botón viejo de vuelta 2 de 6 → 0 de 7; contactos sin correo 0 de 2 → 3 de 4; checks 19 → 24 de 26 |
| #262 Palabras simples | Reintentos sin «terminal» ni «conciliar»; dominio con cada registro explicado y los rebotes en la misma consulta; gráficos en Excel o CSV (la guía decía Word o PDF); cifras de la organización dichas como tales. | «conciliar» o «terminal» 7 → 0; Word o PDF para gráficos 4 → 0; claridad 4,00 → 4,83; veracidad 4,00 → 4,44 |
| #263 Encontrar clientes | «Ayúdame a encontrar clientes» propone buscar prospectos nuevos; «ayúdame a vender» sigue partiendo por los contactos con correo. Era la decisión pendiente del Plan 15. | Propone la búsqueda 0 → 2 de 2; los otros casos sin cambios (4 de 4) |
| #266 IA sin saldo | Con la cuenta del proveedor sin créditos, la llamada falla al primer intento (antes reintentaba y probaba otros modelos de la misma cuenta) y Cowork dice que no es la solicitud del usuario y que reintentar no sirve (antes «saturado, reintenta en un minuto»). El guion de llamada ya no muestra «OPENAI_HTTP_429:{…}» en el aviso. | Con 2 modelos y 3 intentos: 1 sola llamada; pruebas unitarias |
| #264 Seguimientos de LinkedIn | «Una persona por empresa»: Cowork elige, deja a la otra para otra semana y ofrece los mensajes con una prueba de la oferta. El juez sabe que los teléfonos se aprueban de a uno. | Elige sin preguntar 1 → 3 de 3; ofrece los mensajes con una prueba 0 → 3 de 3 |

El detalle de cada uno está en `docs/cowork-plan16-juez.md`, `docs/cowork-plan16-cargos.md`, `docs/cowork-plan16-consultas.md`,
`docs/cowork-plan16-palabras-simples.md`, `docs/cowork-plan16-encontrar-clientes.md`, `docs/cowork-plan16-uno-por-empresa.md` y
`docs/ia-sin-saldo.md`.

## Segunda parte: luna para todo y evaluación ciega (tarde del 8 oct)

El dueño pidió usar `gpt-6-luna` para todo lo posible, subir el esfuerzo de razonamiento donde hiciera falta y dejar de usar un juez
caro. Desde entonces, cada cambio se generó con luna y lo calificó a ciegas otra sesión de Claude: leía las versiones mezcladas sin
saber cuál era cuál, y no gastaba créditos de OpenAI. Las métricas automáticas (aperturas repetidas, checks del banco) completan la
medición.

| PR | Qué cambia | Medición (ciega salvo que se diga) |
|---|---|---|
| #268 Botones secundarios | Cowork quita los botones que no son el primero y piden otra consulta que podía hacer. | Quejas por ofrecer una consulta 8 → 1 de 15 (juez anterior) |
| #269 Pruebas de borradores | `evaluate-outreach-set` usa luna salvo `OUTREACH_EVAL_MODEL`, y el costo se calcula por modelo. Antes, sin querer, corría con `gpt-6-sol`. | — |
| #270 Respuestas a clientes | La respuesta a un cliente que contestó ve la oferta del Perfil y el correo enviado (antes, la investigación del lead hacía de oferta y solo pasaba el asunto). Responde lo que escribió el cliente. | Contesta lo pedido 3,00 → 4,92; veracidad 4,25 → 4,92; «lo enviaría» 2 → 12 de 12 |
| #271 Borradores sin situación inventada | Sin señal, el correo no abre con «Si hay un peak…»; lo que no se sabe sigue en condicional. | Con sol: mejor versión 4 → 13 de 17; con luna: posición media 4,00 → 3,47 |
| #272 Rescate de Cowork | `COWORK_RESCUE_MODEL` pasa a luna con esfuerzo alto, y la instrucción pide cerrar con el siguiente paso. | Falla forzada: 33 de 34 checks (sol: 17 de 17) |
| #274 Servicio según la señal | Con señal, el borrador ofrece el servicio que responde a ella, no el principal por defecto. | Mejor versión del caso 6 → 11 de 17 |
| #275 Borradores prioridad A con luna | `OPENAI_REASONING_MODEL` pasa a luna, con esfuerzo medio para cuentas bien investigadas. | Posición media 4,35 contra 4,50 de sol; ~34 s contra 14 s; unas 11 veces más barato |
| #276 Costo de una búsqueda | Cowork dice que una búsqueda usa el cupo diario, no «1 crédito del proveedor». | «1 crédito del proveedor» 2 de 3 → 0 de 9 |
| #277 «¿Cómo voy?» | Consulta a quiénes se escribió, da la conclusión en números con nombres y cierra con una acción concreta. | Buenas 3 → 8 de 12; malas 2 → 1; fricción 3,75 → 4,42 |
| #278 Prueba del perfil en correos | Los correos de Cowork citan el resultado que el usuario cargó en su Perfil, tal cual; sin él, no inventan cifras. | Buenas 1 → 9 de 16; calidad del correo 2,88 → 3,56 |
| #279 «¿A quién invito por LinkedIn?» | Lee también la red sincronizada, prioriza perfiles con cargo que decide y sin correo, y dice a quién deja fuera. | Malas 2 → 0 de 8; elección 3,63 → 4,13; mejor del caso 4 de 4 |
| #280 Seguimientos sin repetir el hecho | Los pasos 2 a 4 nombran el hecho de la empresa en una referencia breve en vez de repetir la oración del inicial (la causa era el ancla factual del prompt). | Repetición de la apertura 35 → 10 de 36; posición media 4,25 → 2,75; malas 5 → 0 de 12 |
| #281 Informe con las pruebas del Perfil | El informe recibe los proofPoints del vendedor (antes no le llegaban) y el nombre del producto, y los cita tal cual. | Posición media 5,00 → 2,00; buenos 0 → 4 de 6; veracidad 3,83 → 4,50 |
| #282 Referencia breve sin vínculos falsos | Ajuste de #280: la referencia al hecho no se pega a la prueba ni sugiere que ya trabajan juntos. | Posición media 4,17 → 2,83 contra #280; veracidad 3,50 → 4,00 |
| #283 Redactora de Cowork | Los correos abren con el trabajo del destinatario, no con su cargo; una capacidad, sin listas; nombre real a una persona; sin jerga en la respuesta. | Buenas 4 → 15 de 22; malas 7 → 2; calidad del correo 2,86 → 3,68 |
| #285 Redactora sin apertura repetida | Ajuste de #283: sin ejemplos de un rubro (el modelo los copiaba), cierre propio de cada correo, un solo trato y sin «junior». | Aperturas iguales 17 → 9 de 22; cierre de fórmula 5 → 0; posición 2,77 → 2,23 contra #283 |
| #286 Sin jerga de sincronización | Cowork no nombra la sincronización del buzón; recomienda con lo registrado y, si importa, dice «si te respondió por fuera de ANTON.IA, avísame». | Jerga 5 → 0 de 16; buenas 10 → 12; posición 2,81 → 2,19 |
| #287 «Con LinkedIn» | `leads.search` filtra «con LinkedIn» en toda la cuenta (antes miraba los 20 más recientes); los seguimientos de LinkedIn se leen junto con la red. | Veracidad 3,80 → 4,90; malas 4 → 1 de 10 |
| #288 Tablero sin marcadores | El texto del chat de un tablero quita la oración con un marcador `{{…}}`. | Prueba unitaria |
| #289 «¿A quién le escribo hoy?» | Lee a todos los que tienen correo en la cuenta, no los 20 más recientes. | Malas 4 → 1 de 9; posición 4,11 → 2,89 |
| #290 Envíos por período | `contacted.search` entiende «últimos 7 días» o «esta semana» como fecha de envío (antes lo buscaba como texto y volvía vacío). | Sabe a quién se escribió 2 → 5 de 5; posición 7,00 → 4,00 |
| #291 Textos de tableros | «Mostrar 0 más» ya no queda visible (`.btn` le ganaba a `[hidden]`) y los plurales dicen «1 categoría». | Pruebas unitarias |
| #292 Seguimiento pendiente | Un envío sin respuesta de 5 días o más se propone como seguimiento, aparte de los primeros correos. | Lo descarta 4 → 0 de 12; posición 4,08 → 2,92 |
| #293 Campañas por estado | `campaigns.list` devuelve `byStatus` y el banco lista las 19 campañas (listaba 1). | Dice cuántas hay por estado 4 de 14 → 8 de 10; conteo equivocado 1 → 0 |
| #294 Tarjetas de campaña | La tarjeta nombra la campaña, sin ID ni «(rev N)». | Prueba unitaria |
| #295 «Los de la feria» | «Feria», «evento» o «asistentes» activan la parte de archivos: lee la lista subida en vez de pedirla. | 4 → 5 de 5; 8 de 8 casos de archivos |

Con #272 y #275, ninguna variable de modelo de `apphosting.yaml` apunta a sol.

## Tercera parte: correos, opciones y limpieza de la respuesta (9 oct)

Misma regla de medición: luna para generar y un lector independiente que lee a ciegas. Las herramientas de esa lectura quedaron en
el repo (#304, `docs/cowork-lectura-ciega.md`). Un barrido de 20 casos de marketing e inicio sobre `main` (60 respuestas, media 3,38)
ordenó los problemas: cautelas innecesarias en 27 respuestas, frases raras en 15, jerga en 13 y ofertas repetidas en 10.

| PR | Qué cambia | Medición (ciega salvo que se diga) |
|---|---|---|
| #297 Tarjeta de búsqueda | Sin líneas «Sin criterio» vacías. | Cambio de presentación |
| #298 «¿Cómo voy?» sin campañas activas | Dice cuando ninguna campaña está enviando. | 0 → 4 de 5 (checks) |
| #299 Un solo trato y una pregunta por correo | La Redactora tutea y escribe directo; en una secuencia, cada correo cierra con un tipo de pregunta distinto. Chequeos de tú/usted mezclado y de pregunta repetida. | Nota 2,42 → 3,25; secuencia 1,50 → 3,50; preguntas repetidas 4 → 0 de 12 |
| #300 «Otra industria» | Sin nombrarla, Cowork no elige la industria: consulta el perfil y pregunta con opciones. | Checks 2 → 5 de 5; nota 2,60 → 4,20 |
| #301 La Revisora y el saludo | No pide `{{nombre}}` en un correo a una sola persona (la corrección no podía conservarse y el correo quedaba «por revisar»). | «Por revisar» por el saludo 4 de 25 → 0 de 10 |
| #302 Sin cautelas | La respuesta no cuenta lo que evitó suponer («sin asumir…», «sin atribuirles…»): limpieza determinística y regla en la Redactora. | Nota 2,92 → 3,33; cautelas 13 → 6 de 24; checks 229 → 231 de 231 |
| #303 La oferta, una vez | Si la pregunta final ya ofrece el paso, el texto no lo ofrece antes (limpieza determinística, conservadora). | Pares: prefiere la limpia 11 de 11 con la regla final |
| #304 Lectura ciega en el repo | `scripts/cowork-blind-read.ts` (mezclar, sumar, contar, pares) y la guía del método. | — |

#302 y #303 se armaron primero sobre una base vieja y revertían #299; se corrigieron con un commit antes de fusionarse (ver «Cuidados»
en `docs/cowork-lectura-ciega.md`).

## Lo que se probó y no se integró

- **Primera parte**:
  - una regla para no ofrecer consultas en los botones, y forzar la consulta cuando solo la ofrecía el primer botón: no movieron la
    cifra (quejas 11 → 9 de 26), quedaron fuera de #261;
  - la primera versión de #271 quitaba el «en condicional» y bajó la veracidad (4,66 → 4,36).
- **Seguimientos que no repiten la frase inicial**: dos versiones. Una cortaba la repetición (7 → 0 de 12), pero los seguimientos
  quedaron más abstractos; la otra no cambió nada. Las dos quedaron igual o peor en la lectura ciega (2,88 la actual,
  2,88 y 1,75 las versiones) y el juez de borradores las vio peor.
- **Borradores prioridad A con luna**: en una primera ronda ciega quedaron detrás de sol con esfuerzo bajo (posición 5,26 contra 3,97),
  con dos versiones y una tercera llamada que elige (4,76) y con esfuerzo alto solo al escribir (4,76). El esfuerzo alto en las dos
  llamadas igualó a sol, pero tardaba 74 s por correo.

- **Esfuerzo medio en el informe de investigación**: tarda 1,7 veces más (76 a 134 s contra 44 a 58 s) y la lectura ciega no
  mejoró (posición media 3,50 en los dos; veracidad 3,83 → 3,33). El informe sigue en esfuerzo bajo.
- **Redactora de Cowork con esfuerzo medio**: ganó una primera ronda (6 de 8 casos) y perdió la segunda, más grande (posición 4,36
  contra 3,68; malas 11 contra 6 de 22). Suma latencia (llamada de 5 a 9 s en la mediana, máximo 26 s con un límite de 30 s).
- **Seguimientos que no repiten la descripción de la oferta** (sobre #282): bajó la frase repetida (10 → 5 de 24), pero la lectura
  ciega empeoró (posición 3,83 contra 3,17; malas 7 contra 2). Con una oferta de un solo servicio falta material nuevo.
- **«Descargar» en el informe para el jefe**: la regla nueva lo hizo decir en 1 de 3 informes (0 de 3 antes); no alcanza para
  integrarla.
- **Conteos por mes para la Diseñadora** (`byMonth`): 4 contra 4 tableros del mes, sin diferencia.
- **«¿A quién le escribo hoy?» con `leads.recommend`**: en la cuenta grande solo ve 4 contactos y vuelve el «es el único de tus 4».


- **Tercera parte**:
  - **solo los chequeos de #299, sin cambiar las reglas**: 2,58 contra 2,42 de la base, muy poco; se integró junto con las reglas;
  - **aperturas directas** (chequeo de «puede sumar» en la primera frase y un ejemplo en la regla): bajó los rodeos (11 → 2 de 12),
    pero subieron las aperturas obvias (3 → 7); empate 2,83 contra 2,83, con 4 s más por la corrección. Rama
    `claude/cowork-aperturas-directas`;
  - **la fecha de hoy para la Redactora** (para que el seguimiento diga bien «hace unos días»): sin errores de plazo en 10 corridas
    por lado, ni con un envío de hace 44 días (caso `mkt-seguimiento-antiguo` en la rama). Rama `claude/cowork-redactora-fecha`;
  - **un correo por persona con 2 o 3 destinatarios**: empeoró (3,40 → 2,80; en los casos objetivo 3,80 → 2,40 y 3,40 → 2,20). Los
    «por persona» salían con el mismo cuerpo copiado y más funciones, y tardaban 5 s más. Rama `claude/cowork-correo-por-persona`.

## Para el mantenedor

1. **Desplegar `main`** con su tag `prod-AAAA-MM-DD`. Hace falta redeploy para que `apphosting.yaml` tome los modelos nuevos:
   `COWORK_RESCUE_MODEL`, `OPENAI_REASONING_MODEL`, `OPENAI_ORCHESTRATOR_MODEL` y `OPENAI_CRITICAL_MODEL` pasan a `gpt-6-luna`.
   No hay migraciones. Los borradores pasan a `native-draft/v23` y el informe a `report-v2/editor/10`; los ya generados no se
   rehacen.
2. **Pruebas de humo** de siempre (`/api/onboarding/tour` 401, `/cowork` 200, `POST /api/cowork/wake` 401).
3. **Después del deploy**: en la página Usage de OpenAI, el gasto en sol debería caer a cero. Los borradores de cuentas bien
   investigadas tardan unos 34 s, contra 14 s con sol. Si eso molesta, `OPENAI_DRAFT_PRIORITY_EFFORT=low` y
   `OPENAI_DRAFT_PRIORITY_EDIT_EFFORT=low` los dejan en unos 18 s, con algo menos de calidad.
4. **Clave de OpenAI para pruebas**: conviene una clave separada, en un proyecto con tope de gasto. Si las pruebas agotan el saldo,
   no se cae producción, como pasó a las 09:12 UTC.
5. **Rollback**: `git revert` del PR que corresponda, redeploy y pruebas de humo. Ninguno deja datos que limpiar.

## Lo que queda

- **Medir con datos reales**: sin acceso de lectura a producción, todo se midió con el banco.
- **Seguimientos de una secuencia** (#280, #282): ya no repiten la frase de la empresa. Con una oferta de un solo servicio, los
  correos 3 y 4 vuelven a describirla; una regla no bastó: haría falta planificar el ángulo de cada correo o pedir más material al
  usuario (pruebas, usos).
- **Informe** (#281): largo y con salvedades repetidas; falta comprobar con investigaciones reales cómo pesa una señal fechada.
- **Redactora** (#283, #299): las aperturas siguen siendo obvias e intercambiables entre destinatarios («revisar antecedentes laborales
  puede sumar trabajo…»). Ni la regla de aperturas directas ni el correo por persona lo resolvieron: falta material por destinatario
  (investigación, señales) o planificar el ángulo antes de escribir.
- **Primer correo a quien ya recibió uno** (`mkt-campana-rrhh`, `mkt-necesito-clientes`): sigue intermitente (4 de 60 en el barrido).
- **Frases raras y jerga de LinkedIn** («red observada», «180 perfiles revisados», «la extensión»): 13 de 60 en el barrido.
- **Cowork**, según las lecturas ciegas (la general de 26 casos: 13 buenas, 10 mejorables, 3 malas):
  - LinkedIn: con 93 invitaciones disponibles propone una sola, y con muchos contactos decide sobre los primeros que devuelve la búsqueda;
  - nombres enmascarados («Carlos Ah***a») en informes y tableros;
  - no decir que el informe se baja con «Descargar».
- **Revelar teléfonos y reintentar envíos** siguen apagados en producción por flag.
