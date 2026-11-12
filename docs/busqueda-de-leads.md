# Búsqueda de leads: perfil de LinkedIn, filtros y errores claros

**Fecha:** 1 de octubre de 2026.

**Por qué:** varios usuarios reportan que la búsqueda por perfil de LinkedIn «falla o no trae resultados» y que, cuando falla, no queda claro qué pasó ni qué hacer.

## Línea base en producción

Fuente: `apollo_enrichment_callbacks`, búsquedas por perfil de los últimos 60 días. Solo lectura, cifras agregadas, sin datos de personas.

| Resultado | Cantidad aprox. | Qué veía el usuario |
|---|---|---|
| Con datos | 105 (56 %) | El perfil |
| Sin datos (`no_data`, `apollo_person_not_found`) | 41 (22 %) | «Perfil no disponible», sin botón |
| Otra persona (`APOLLO_PERSON_IDENTITY_MISMATCH`) | 16 | Un párrafo largo |
| Proveedor caído (`APOLLO_GATEWAY_HTTP_503/500`) | 11 | «Revisa los filtros», aunque esta búsqueda no tiene filtros. O peor: se reintentaba sin datos de contacto y terminaba en «No se encontraron datos para esta URL», que es falso |
| Teléfono sin respuesta del proveedor (`apollo_request_id_unknown`) | 15 | Una espera de unos 5 minutos sin saber cuánto falta |

## Qué cambia

1. **Coincidencia de identidad sin falsos rechazos** (`src/lib/linkedin-url.ts` y `src/lib/server/apollo-provider/apollo.ts`):
   - el perfil devuelto se compara con el pedido sin distinguir mayúsculas ni tildes, porque LinkedIn y el proveedor escriben el mismo perfil como `laura-sofía-…`, `laura-sof%C3%ADa-…` o `laura-sofia-…`;
   - si el proveedor no devuelve la dirección, se acepta solo cuando la dirección pedida deletrea el nombre devuelto: dos o más palabras, todas presentes en el nombre;
   - una dirección personalizada (`jperez87`) no avala a nadie;
   - nunca se muestran datos de otra persona.
2. **Un problema, una frase, un botón** (`src/lib/search/profile-search-outcome.ts` y `src/components/search/ProfileSearchProblemAlert.tsx`):

   | Problema | Qué se dice | Botones |
   |---|---|---|
   | Dirección que no es un perfil | «Copia la dirección que empieza con linkedin.com/in/» | Corregir la dirección |
   | Sales Navigator | Cómo llegar al perfil público | Corregir la dirección |
   | Página de empresa | Que se busque por «Empresa» | Buscar en «Empresa» |
   | El proveedor no tiene el perfil | «Busca a *Nombre* por su empresa y cargo» (el nombre sale de la dirección) | Buscar en «Empresa», Corregir |
   | Otra persona | Que suele pasar cuando la persona cambió su dirección de LinkedIn | Buscar en «Empresa», Corregir |
   | Proveedor caído | Que es temporal y no depende de la dirección | Reintentar (sin reintento automático) |
   | Sin créditos / límite diario / sesión vencida | Quién lo resuelve | Traer solo datos profesionales / — / Volver a entrar |

   «Buscar en «Empresa»» cambia de modo y deja el aviso «Buscando a *Nombre*: escribe su empresa y su cargo».
3. **Costo antes de gastar:** el interruptor de teléfono dice «Cuesta 10 créditos por persona y llega en 1 a 3 minutos».
4. **Guardar ya no es un callejón:** el aviso dice dónde quedó cada contacto y trae el botón para seguir («Escribirles» o «Completar correos»).
5. **Filtros:**
   - **Puntos de partida por organización** (`src/lib/search/search-guidance.ts`):
     - GrupoExpro: servicios transitorios, outsourcing/BPO, selección y ExproPay.
     - PSOL: evaluaciones psicolaborales, selección masiva y equipos comerciales.
     - El resto: Recursos Humanos, Operaciones, Comercial y Finanzas.
     
     Rellenan el formulario y todo sigue editable. Son un borrador para que cada organización los valide.
   - **Cero resultados:** se listan los filtros activos, cada uno con su botón «Quitar».
   - Se corrigen las tildes y el aviso del filtro antiguo deja de nombrar al proveedor.
6. **Medición:** una búsqueda fallida guarda su código de error en el registro (`search.failed`, columna `error_code`), para separar caídas del proveedor de filtros sin resultados.

## Cómo medir el efecto (una semana después del despliegue)

La misma consulta de la línea base: proporción de callbacks de perfil por `terminal_state` y `last_error_code`. Lo esperable:
- menos `APOLLO_PERSON_IDENTITY_MISMATCH` por tildes o por dirección vacía;
- los demás problemas siguen ocurriendo (el proveedor no tiene a todos), pero cada uno con su salida.

## Pruebas

- `src/lib/linkedin-url.test.ts`: comparación, nombre y tipo de dirección.
- `src/lib/search/profile-search-outcome.test.ts`: cada problema y su mapeo.
- `src/lib/search/search-guidance.test.ts`: puntos de partida válidos, aviso al guardar y filtros a quitar.
- `src/lib/leads-client.test.ts`: no encontrado, caída sin reintento, Sales Navigator sin llamada y tildes.
- `src/lib/server/apollo-provider/apollo.test.ts`: tildes y dirección vacía.
- `scripts/test-search-guidance-ui.mjs`: DOM; corre dentro de `test:unit` mediante `__tests__/search-guidance-ui.test.mjs`.

## 12 de noviembre de 2026: cargos por lo que significan y «0 = todos»

**Por qué:** un cliente buscó «coordinador de gestión de riesgo en incendio» en una empresa de energía y no apareció nadie. Sí apareció cuando escribió el cargo tal como lo tenía la persona en LinkedIn: «Coordinador Gestión Riesgo Incendios».

**Cómo busca Apollo un cargo** (probado con su búsqueda gratuita):
- encuentra a la persona si su título tiene las palabras pedidas seguidas y escritas igual;
- las tildes y el plural cuentan;
- sus «cargos similares» son sinónimos de cargos comunes y no cubren otra forma de escribir un cargo poco común.

| Pedido a Apollo en esa empresa | Personas |
|---|---|
| «coordinador gestion riesgo incendio» | 0 |
| «coordinador incendios» | 0 |
| «gestion riesgo» (sin tilde) | 0 |
| «incendios» | 1 (la persona buscada) |
| «riesgo incendios» | 1 (la persona buscada) |
| «riesgo» o «riesgos» | 13, la persona buscada primero |

**Qué cambia** (`src/lib/server/search/title-ai.ts`, `src/lib/server/search/company-people-ai.ts` y `src/app/api/leads/search/route.ts`):
1. **Búsqueda en una empresa** (contactos de una empresa marcada en «Filtros», o la pestaña «Empresa»):
   - si la empresa tiene hasta 300 personas en Apollo, se leen todas (de 1 a 3 llamadas);
   - si tiene más, se buscan dos cosas:
     - el cargo escrito de las formas que usa la gente (1 llamada);
     - las palabras de su área, como «riesgo», «riesgos» o «incendios» (hasta 3 llamadas). En Codelco, «seguridad», «salud», «medio ambiente», «incendios» y «riesgos» suman 214 personas;
   - son a lo más 5 llamadas por empresa. La búsqueda de personas de Apollo no cobra créditos, pero la cuenta completa tiene 200 llamadas por minuto.
2. **Búsqueda por filtros:** al cargo pedido se suman las formas en que la gente lo escribe, con un máximo de 20 cargos por búsqueda, que es el límite que acepta el gateway.
3. **Clasificación:** la IA (Claude Haiku) clasifica cada título encontrado:
   - «Cargo exacto»: el mismo cargo, aunque esté escrito distinto;
   - «Cargo similar»: la misma función con un nivel parecido;
   - «Cargo relacionado»: un área vecina que decide o influye en la misma compra;
   - sin relación: no se muestra.

   Primero aparecen los exactos, después los similares y al final los relacionados. Cada fila lleva su etiqueta.
4. **Si la IA falla:**
   - una regla local reconoce el cargo pedido aunque esté escrito sin preposiciones, sin tildes, en plural o en femenino;
   - esa regla solo puede subir lo que dijo el modelo, nunca bajarlo;
   - las formas de escribir el cargo y las clasificaciones se guardan un día, para no preguntar dos veces.
5. **«0 = todos»:** en «Máximo de resultados» y en «Contactos por empresa», 0 trae a todos, hasta 1.000 personas (10 páginas de la búsqueda gratuita). Cada página pedida a Apollo es de 100 personas, para que ninguna se repita entre páginas.

**Pruebas:** `title-ai.test.ts`, `company-people-ai.test.ts` y las páginas de Apollo en `apollo.test.ts`.

## 12 de noviembre de 2026: «¿Es la misma persona?»

**Por qué:** en 30 días, 14 búsquedas por perfil terminaron en «El proveedor devolvió a otra persona» porque Apollo respondió con otra dirección de LinkedIn (`url_differs`), casi siempre con certeza alta. Muchas veces era la misma persona, que había cambiado su dirección. El crédito ya estaba cobrado y la pantalla no mostraba nada.

**Qué cambia** (`src/lib/server/identity-reviews.ts`, `src/app/api/leads/identity-reviews/[id]/route.ts` y `src/components/search/IdentityReviewCard.tsx`):
1. **Se guarda a quién encontró Apollo.** Cuando responde con otra dirección, la app guarda por 7 días su nombre, cargo, empresa, foto y dirección de LinkedIn en `apollo_identity_reviews` (solo el servidor la lee, y solo para quien buscó). El correo queda cifrado y no llega a la pantalla.
2. **La pantalla pregunta «¿Es la misma persona?».** Muestra a la persona encontrada y dos enlaces: el perfil que pegó el usuario y el que encontró Apollo.
3. **La IA aconseja** (Claude Haiku). Compara:
   - los nombres que se leen en las dos direcciones y el nombre devuelto;
   - el cargo y la empresa devueltos con lo que la web muestra del perfil pegado (una búsqueda `site:linkedin.com/in/<dirección>`);
   - la certeza que informó Apollo.

   Responde «misma», «probable», «dudosa» u «otra», con hasta cinco señales. El correo nunca va al modelo. Si la IA falla, una regla local compara los nombres.
4. **La persona decide.**
   - «Es la misma persona»: se muestra el contacto que ya estaba pagado, sin otro crédito, y la dirección pegada queda asociada a esa persona de Apollo. La próxima búsqueda de esa dirección ya no pregunta.
   - «No es»: el contacto guardado se borra.

**Pruebas:** `identity-reviews.test.ts`, el caso nuevo de `apollo.test.ts` y el recorrido `scripts/visual-audit/journeys/perfil-linkedin.mjs`.
