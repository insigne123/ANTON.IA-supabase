# Cowork: subagentes en paralelo (23 oct 2026)

**Qué falta frente a Claude Code y Claude Cowork:** ambos reparten un trabajo grande entre agentes que lo hacen a la vez y devuelven un resumen. El agente de Cowork investigaba de a una empresa por vez, con un presupuesto de 4 búsquedas para todo el turno. Con los subagentes, «investiga a Enaex, Besalco y Gasco» las reparte en tres **Investigadoras** que trabajan en paralelo, cada una con su propia web (3 búsquedas y 2 lecturas de página) y su propia conversación, y vuelven con un informe corto cada una. El coordinador solo ve esos tres párrafos, no las páginas que leyeron.

**Apagado por defecto.** Necesita el agente nuevo (`COWORK_RUNTIME=harness`), la web (`COWORK_WEB_ENABLED=true`) y `COWORK_SUBAGENTS_ENABLED=true`, y la migración `20261023130000_cowork_delegate_model_calls.sql` (un rol nuevo en el libro de consumo). La migración está escrita y tiene su prueba pgTAP (corre en el CI), pero **no se ha aplicado a producción**: esa decisión es de quien despliega.

## Cómo funciona

1. El coordinador (el agente de siempre) tiene una herramienta más, `delegar`, con la `investigadora`. Cuando la persona pide investigar o comparar 2 o más empresas, llama a `delegar` una vez por empresa **en la misma ronda**, así corren juntas. Para una sola empresa busca él mismo.
2. Cada Investigadora es un Claude (`COWORK_SUBAGENT_MODEL`, el del coordinador por defecto; esfuerzo bajo) sin herramientas de la cuenta: solo búsqueda y lectura web, con su presupuesto (`COWORK_SUBAGENT_SEARCHES` 3, `COWORK_SUBAGENT_FETCHES` 2, `COWORK_SUBAGENT_MAX_ROUNDS` 4, `COWORK_SUBAGENT_DEADLINE_MS` 45 s). Recibe la tarea y un contexto breve (a qué cargo se le escribirá, qué vende la persona); nunca correos, teléfonos ni datos de contacto. Devuelve un informe de hasta 250 palabras con cada dato, su fecha y su enlace, y lo que no encontró.
3. El coordinador integra los informes: compara, concluye y cita los enlaces. Una empresa sin informe, o con un error, se dice así; no se rellena.
4. Hasta `COWORK_SUBAGENTS_MAX` (3) tareas por turno; una cuarta vuelve con el aviso «Ya delegaste 3 tareas en este turno».

## Qué ve la persona

- Una línea «Investigadora · Investigando en la web…» que pasa a «Investigación lista» (una sola, aunque trabajen tres a la vez), y las búsquedas de cada una con sus fuentes, igual que las del coordinador.
- Los enlaces de la respuesta que vienen del informe de una Investigadora no se devuelven por «dirección que nadie vio»: sus búsquedas quedan registradas como las del coordinador.

## Consumo: un rol nuevo en el libro

Cada llamada de una Investigadora se reserva con el rol `delegate`, que corre dentro del turno bajo el arriendo de la ejecución, como el coordinador. La migración le da **su propio espacio en el turno** (hasta 12 llamadas y 40.000 tokens reservados entre todas, a 2.500 por llamada) sin tocar el de los demás roles (11 llamadas y 55.000 tokens, como siempre): una investigación en abanico no deja sin turnos al coordinador y el coordinador no deja sin turnos a las Investigadoras. Por conversación (200 llamadas, 1 M de tokens) y por persona y día (300 llamadas, 1,8 M de tokens) cuentan como cualquier otra llamada. El consumo de cada llamada se registra con su propia reserva.

Sin la migración, la reserva del rol falla («No se pudo reservar presupuesto…»): `delegar` devuelve el error al coordinador y este sigue investigando con su propia búsqueda. Por eso **primero se aplica la migración y después se enciende la bandera**.

## Medido (23 oct 2026, Sonnet 5.5, una petición real)

«Investiga en la web a Enaex, Besalco y Gasco: qué han hecho en los últimos meses en contratación y qué cargo de Recursos Humanos conviene para escribirles» (tres empresas, vendiendo AXIS):

| | llamadas al modelo | tiempo | costo | búsquedas posibles |
| --- | --- | --- | --- | --- |
| El coordinador solo | 1 | 28 s | US$0,23 | 4 en total |
| Con tres Investigadoras | 5 (2 del coordinador y 3 de ellas) | 35 s | US$0,43 | 9 (3 cada una) |

La respuesta con Investigadoras trae, por empresa, señales con fecha y enlace (Enaex: 38 ofertas al 8-jun y vacantes publicadas el 19-jun; Besalco: 102 contratos vigentes, inversión de US$400 millones y reclutamiento de operadores abierto hace 6 días; Gasco: nombramiento en la CMF el 4-ago) y dice qué no encontró. El coordinador solo, con el mismo pedido, dio cargos «como hipótesis» y fechas que él mismo marcó como inconsistentes. Cuesta el doble y tarda 7 segundos más por tres veces el presupuesto de búsqueda; con una petición de más empresas la diferencia a favor crece, porque van en paralelo. Una petición más amplia («investiga a estas tres y dime a quién escribirle», con búsqueda de contactos) llegó a US$0,77 con 6 llamadas.

Es una muestra de una petición, no un estudio: sirve para ver que el camino funciona de punta a punta y para estimar el costo, no para afirmar cuánto mejora la respuesta en general.

## Para encenderlo

1. Aplicar la migración (una sola, hacia adelante) y revisar esquema y registros (`cowork_model_calls_role_check` debe nombrar `delegate`).
2. En el entorno de la aplicación: `COWORK_SUBAGENTS_ENABLED=true` (con `COWORK_RUNTIME=harness` y `COWORK_WEB_ENABLED=true`). Probarlo primero con `COWORK_HARNESS_USER_IDS` para una persona.
3. Pedir «investiga a A, B y C» y mirar la línea de la Investigadora, los enlaces y el consumo del día.

## Pruebas

- `src/lib/agent-harness/agents.test.ts`: un delegado con web, ganchos propios por ejecución y tope de tareas por turno.
- `src/lib/cowork/harness-turn.test.ts`: dos tareas que corren a la vez con su reserva y su consumo propios, lo que ve la página, el tope, los enlaces de un informe, el fallo de la reserva y la ausencia de `delegar` sin web o sin la bandera; límites y valores por defecto de la configuración.
- `supabase/tests/database/cowork_delegate_model_calls.test.sql`: el rol nuevo, sus 12 llamadas y 40.000 tokens por turno, que no gasta el espacio de los demás ni al revés, el arriendo, los topes por conversación y el registro del consumo.
- `scripts/evaluate-cowork-harness.ts --live --ask="…"` con `COWORK_SUBAGENTS_ENABLED=true` y la web: la misma petición con y sin subagentes.
