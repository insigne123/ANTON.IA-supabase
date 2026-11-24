# Investigación: la lista no trae todos los informes cada vez y la fila no se bloquea (24 nov)

**Problema (23 y 24 nov 2026, reportado por un cliente: «no carga», «se queda pegada»):**

- **La base dejó de responder para todos** el 24 nov entre las 15:04 y las 15:22 (hora de Chile). En los 14 minutos anteriores, una sola cuenta con 230 leads investigados pidió 64 veces la lista de estados de investigación, y cada respuesta traía el informe completo de cada lead (unos 90 KB cada uno, 36 MB en total). La página de leads enriquecidos recarga esa lista con cada cambio de un lead.
- **Una investigación esperó casi 9 horas** el 23 nov. Cuarenta investigaciones de otra cuenta, rechazadas por falta de cupo, quedaron primeras en la fila: se reintentaban cada minuto y ocupaban todos los lugares de cada pasada.
- **Los lotes esperaban 15 minutos (mediana)** aunque cada investigación tarda unos 5 segundos: la fila tomaba 5 y no volvía a tomar hasta terminar de escribir los informes de esas 5.

## Qué cambia

1. **La lista de estados** (`listNativeResearchLeadStatuses`, `POST /api/native-research/status`):
   - Primero lee cuál es la última investigación de cada lead, sin los informes. Después lee solo los informes que hacen falta, de a 20 por consulta.
   - La página dice qué tiene (`known`: una `version` por lead). Lo que no cambió vuelve como `unchanged`, sin informe. Una recarga de la lista ya no lee ningún informe.
   - Ya no se leen los informes anteriores de un lead investigado más de una vez.
   - En el navegador: `src/lib/native-research-status-client.ts` guarda lo que la pestaña ya tiene y pide de a 50 leads. Lo usan «Investigación» y «Leads enriquecidos».
2. **El seguimiento de un lote** (`listNativeResearchRun`, `GET /api/native-research/run/[runId]?have=`): la página pregunta cada 3 segundos. Antes cada respuesta traía de nuevo todos los informes ya terminados; ahora solo los que la página no tiene.
3. **La fila** (`processNativeResearchQueue`):
   - **Turnos:** cada ronda toma una investigación por persona, por orden de llegada. Un lote ya no deja esperando a quien pidió una sola.
   - **Sin cupo:** la investigación rechazada queda para el siguiente día (UTC, como se cuenta el cupo) en vez de reintentarse cada minuto. La persona lee «Queda en la fila… se hará sola cuando se renueve el cupo».
   - **Más rondas por pasada:** la pasada del programador sigue tomando rondas durante un minuto mientras se escriben los informes de la primera (`keepTakingForMs`). Siguen siendo 3 investigaciones a la vez.

## Lo que no cambia

- Qué informe ve cada persona y con qué permisos: las mismas condiciones de usuario y organización en cada lectura.
- El contenido del informe y cuándo un lead queda «listo para escribir».
- La escritura de informes: los mismos por pasada.

## Pruebas

- `src/lib/server/native-research-status-read.test.ts`: solo el informe más reciente de cada lead; lo que la página tiene vuelve sin leerse; lecturas de a 20; el seguimiento de un lote no relee lo que la página tiene.
- `src/lib/native-research-status-client.test.ts`: la recarga conserva los informes; pedidos de a 50; un estado «sin cambios» que la pestaña no tiene se vuelve a pedir completo.
- `src/lib/server/native-research-queue.test.ts`: turnos por persona, día en que se renueva el cupo, rondas mientras vuelven llenas y hay tiempo.
- `src/components/research/research-workspace-ui.test.ts`: la investigación sin cupo se muestra como en la fila.
