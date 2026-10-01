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
