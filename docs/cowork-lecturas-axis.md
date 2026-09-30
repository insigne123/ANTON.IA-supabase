# Cowork · cuatro lecturas que cierran brechas del banco AXIS

Las brechas 5 (la parte del saldo), 6, 7 y 10 de `docs/cowork-banco-axis.md`. Solo lectura: sin migración, flag ni secreto.

| Brecha | Antes | Ahora |
|---|---|---|
| 7 · contar un segmento | `leads.search` se corta en 20 y `audience.analyze` listaba 100 contactos: «¿cuántos reclutadores tengo?» no tenía respuesta exacta | `leads.count`: total, con correo, sin correo y con perfil de LinkedIn de los contactos guardados que calzan con uno o varios términos (`reclutador\|recursos humanos`) en cargo, empresa o sector. Tres conteos con `head`: solo salen números. `audience.analyze` suma `totalLeads` y `roleCounts` sobre todos los contactos escaneados |
| 5 · saldo de créditos | no había forma de saber cuántos créditos quedaban ni si alcanzaban para enriquecer N contactos | `credits.balance`: lo que queda, lo usado, el límite, la antigüedad del dato (y si ya es viejo) y lo que cuesta cada cosa (un crédito el correo, diez revelar un teléfono) con cuántos alcanzan de cada tipo. Es el saldo de la cuenta compartida que la app ya muestra; si no se puede leer, dice que no puede y da solo los costos |
| 6 · cupo de LinkedIn | contaba la cola de ANTON.IA y lo enviado en 7 días | además `awaitingAcceptance`: enviadas desde ANTON.IA (30 días) que siguen sin aceptar, con `networkSynced`. Es un mínimo y la respuesta lo dice: lo enviado directo en LinkedIn no se ve, y se le pide al usuario el número que ve |
| 10 · segundo contacto | `linkedin.followups` no traía la empresa | cada candidato trae `company` (la del contacto guardado con ese perfil, o `null`: nunca se adivina) para cuidar «una empresa por día» y las exclusiones |

## Cómo se acota lo que entra a la consulta

- `leads.count` limpia cada frase como los términos de `leads.search` (sin comodines ni gramática de PostgREST), conserva las frases enteras («recursos humanos» es una) y acepta hasta seis. Va siempre por usuario y organización.
- `company` se busca por el nombre del perfil dentro de la dirección guardada (`/in/<nombre>`), solo con nombres de perfil bien formados.

## Banco

`scripts/fixtures/cowork-lecturas-corpus.ts` (+ `scripts/cowork-lecturas-corpus.test.ts`, con modelo guionado y mutaciones): contar un rol sin decir «20», cupo con las que siguen sin aceptar y lo que no se ve, seguimiento de una persona por empresa sin adivinar la de quien no la tiene, y si el saldo alcanza para 120 correos (con lo que cuesta un teléfono).
