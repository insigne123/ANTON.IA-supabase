# Cowork razona tu cliente ideal (Plan 8, fase 2, PR-2a)

## Qué pidió el usuario

Que Cowork razone e investigue el cliente ideal (ICP): «¿cuál es mi ICP?», «¿a quién debería contactar?», «¿a qué leads les ofrezco este servicio?».

## Qué había

- **«Perfil»** guarda «Tu cliente ideal» (#77): cargos, industrias, tamaño, regiones, problemas, diferenciadores y clientes. Búsqueda lo usa como punto de partida.
- **`audience.analyze`** cuenta cargos y sectores de los contactos guardados, pero no mira resultados.
- **Nada cruzaba los resultados por segmento.** Además hay pocos datos: el 2 oct 2026, la organización con más envíos tenía 600, con 5 respuestas y 2 positivas.

## Qué cambia

### 1. La lectura `icp.analyze`

Archivos: `src/lib/cowork/icp.ts` (cálculo puro) y `src/lib/server/cowork/icp-read.ts` (lectura).

**Lee:**
- lo declarado en «Perfil» (los mismos campos que `profile.get`);
- los envíos de la organización (`contacted_leads`);
- los contactos guardados (`leads`);
- las etapas del pipeline (`unified_crm_data`).

Hasta 5.000 registros por tabla; si hay más, lo dice.

**Devuelve:**

| Parte | Qué trae |
|---|---|
| `declared` | El cliente ideal de «Perfil», o null si no hay nada |
| `totals` | Personas contactadas, respuestas, positivas, reuniones, ganados y rebotes, con el rango probable de cada tasa |
| `segments` | Lo mismo por área del cargo, nivel, industria y ubicación: los 6 grupos con más personas y el resto sumado |
| `coverage` | Cuántos contactos guardados calzan con lo declarado y cuántos aún no reciben nada, por área |
| `gaps` | Lo que falta: cargos o industrias en «Perfil», tamaño de empresa, muestra chica, industria sin registrar |

**Cómo cuenta:**
- **Una persona cuenta una vez,** aunque haya recibido varios correos.
- **Respuesta:** sin respuestas automáticas ni fallas de entrega.
- **Positiva:** interés o pedido de reunión.
- **Reunión y ganado:** según la etapa del pipeline.
- **Rango probable:** intervalo de Wilson al 95 %. Con 2 de 10, la tasa es 20 %, pero puede estar entre 5,7 % y 51 %.
- **Muestra:**
  - menos de 30 personas: «muestra chica: no concluyas»;
  - de 30 a 99: «indicio»;
  - 100 o más: «suficiente».

**El área del cargo** se lee del título. Primero la función: «Gerente de Operaciones» es Operaciones, y solo lo que queda es gerencia general. El nivel distingue «subgerente» de «gerente».

### 2. La receta «¿Cuál es mi ICP?»

Cowork lee `icp.analyze` y `profile.get` en paralelo (más el sitio si la oferta no está clara). Con el estilo explicativo de la fase 1, entrega:
- **la respuesta en el chat:** la conclusión, qué revisó, qué encontró y qué propone;
- **el documento «Tu cliente ideal»:** quién te compra y por qué, qué empresas, a quién no, qué dicen tus resultados (con su muestra), hipótesis y cómo probarlas (2 segmentos de 30 contactos, 3 semanas, medidos en respuestas positivas), y próximos pasos.

**Reglas:**
- nunca dice que un grupo «funciona mejor» con menos de 30 personas;
- no inventa tasas de mercado.

### 3. Guardar el cliente ideal en «Perfil»

`profile.update` ahora acepta los campos de «Tu cliente ideal»:
- `targetRoles` y `targetIndustries`, como listas separadas por coma;
- `targetCompanySize`, una de las opciones de «Perfil»;
- `targetLocations`.

Si en «Perfil» faltan los cargos o las industrias, la pregunta final ofrece guardarlos. Como siempre, con la tarjeta de aprobación, que ahora muestra esos campos con su nombre.

## Pruebas

- **`src/lib/cowork/icp.test.ts`:**
  - área y nivel por cargo;
  - el rango de Wilson y las etiquetas de muestra;
  - una persona cuenta una vez y la respuesta automática no cuenta;
  - las reuniones salen del pipeline;
  - «Retail» y «retail» son una industria;
  - cobertura y lo que falta;
  - los 6 grupos más grandes y el resto sumado.
- **`src/lib/server/cowork/icp-read.test.ts`:**
  - lo declarado sale de «Perfil»;
  - la lectura es por organización y devuelve la oferta preguntada;
  - un error de lectura es un error, nunca un historial vacío.
- **`src/lib/cowork/profile-proposal.test.ts`:** los campos nuevos y un tamaño fuera de las opciones rechazado.
- **`scripts/cowork-icp-corpus.test.ts`, con modelo guionado sobre el loop real:**
  - un buen turno pasa todas las verificaciones;
  - responder sin leer o leer y no decir nada fallan al menos 3;
  - decir que un grupo chico «funciona mejor» se detecta.
- **Con el modelo real:** el caso `icp-cual-es-mi-icp` (`scripts/fixtures/cowork-icp-corpus.ts`), 3 veces. Ver el PR.

## A quién escribir: `leads.recommend` (PR-2b)

Archivos: `src/lib/cowork/lead-recommend.ts` (cálculo puro) y `src/lib/server/cowork/lead-recommend-read.ts` (lectura).

**Ordena** los contactos de la organización, de las dos listas:
- **«Por escribir»** (`enriched_leads`), casi siempre con correo;
- **«Por completar»** (`leads`).

**Una persona en las dos listas cuenta una vez,** como la de «Por escribir». Se reconoce porque guarda el id del contacto de origen, o por correo o LinkedIn. En GrupoExpro, el 2 oct 2026, 98 de los 123 contactos de «Por escribir» tenían correo, contra 3 de 354 en «Por completar».

**Deja fuera:**
- a quien ya recibió algo: por el id del contacto, por su correo en los envíos, o porque «Por escribir» lo marca contactado;
- a quien trabaja otro miembro del equipo (los bloqueos de `team-locks`).

**«Ya está investigada»** sale de los informes de la persona que pregunta: los informes son privados de quien los pidió.

**El criterio:**
- **Pedido:** los cargos e industrias de la oferta preguntada, que Cowork deduce de su descripción («RR. HH., selección, retail»).
- **Perfil:** si no hay pedido, el cliente ideal de «Perfil».
- **Ninguno:** el orden es solo por nivel y preparación, y la respuesta lo dice.

**El puntaje (hasta 100):**

| Qué | Puntos |
|---|---|
| El cargo calza | 40 |
| La industria o la empresa calzan | 25 |
| Nivel: dirección, jefatura o profesional | 15, 10 o 3 |
| La región calza | 5 |
| Tiene correo | 10 |
| Ya está investigada | 3 |
| Tiene LinkedIn | 2 |

**Devuelve:**
- los 20 mejores, con sus motivos («su cargo calza con «RR. HH.»», «tiene correo») y lo que les falta (buscar su correo o investigarla);
- cuántos calzan, cuántos están listos para escribirles, cuántos necesitan correo, cuántos trabaja otro miembro y cómo se reparten por área.

**La receta «¿A quiénes debería contactar? / ¿A quiénes les ofrezco X?»:**
1. Explica el criterio y de dónde salió.
2. Muestra a los mejores en una tabla: contacto, empresa, por qué y qué falta.
3. Cierra proponiendo el paso que los deja listos: «Preparar contactos» para los que les falta correo o investigación, o una campaña pausada para los que ya tienen correo.

«¿A quién le escribo hoy?» sigue con su receta.

**Pruebas:**
- `src/lib/cowork/lead-recommend.test.ts`: términos, puntaje y motivos, contactados y bloqueados fuera, sin criterio.
- `src/lib/server/cowork/lead-recommend-read.test.ts`:
  - el pedido manda; sin pedido, «Perfil»;
  - los bloqueos se leen para los mejores;
  - la copia de «Por escribir» reemplaza al contacto guardado;
  - un envío al mismo correo cuenta como contacto;
  - lo investigado suma.
- **El caso `icp-a-quien-ofrezco`, con modelo guionado:**
  - un buen turno pide con los cargos de la oferta y nombra a quienes calzan;
  - recomendar sin leer, o nombrar a quien trabaja otro miembro, falla.

## Lo que sigue

- **PR-2c:** la tarjeta en «Perfil» y «Recomendados para ti» en Inicio.
