# Cowork · búsquedas que respetan el lugar pedido (Plan 14, 1)

Primera mejora de comportamiento del Plan 14. Parte de la revisión de chats y agentes de código abierto: HuggingChat advierte que un cambio de alcance hecho en silencio hace que el resultado sea «de otra cosa». En Cowork ese cambio era el lugar de una búsqueda.

## El problema, medido

En 1.019 respuestas guardadas de evaluaciones anteriores (con luna), las búsquedas propuestas a veces cambiaban el lugar:
- **Lugar pedido que se perdía.** En `axis-a2-mercado` el pedido decía «Busca empresas de Chile» y un intento propuso la búsqueda sin ubicación.
- **Sin lugar al azar.** Cuando el pedido no decía dónde, un intento salía con «Chile» y el siguiente sin nada. Una búsqueda sin lugar trae personas de cualquier país y gasta el cupo en ellas.

En la medición de este PR, `axis-a5-perfil` («el perfil que necesitamos es jefe de reclutamiento») salió sin ubicación en los dos intentos de `main`.

Importa más dentro de una tarea larga: ahí el plan aprueba su búsqueda solo y nadie revisa la tarjeta antes de que gaste el cupo.

## Qué cambia

1. **El lugar pedido se conserva.** Si el pedido nombra un lugar (una ciudad, región o país, por ejemplo «Santiago», «Antofagasta», «Chile» o «empresas chilenas») y la búsqueda no lo incluye, Cowork recibe una corrección una sola vez en ese turno.
   - Cuenta tanto ampliar («Santiago» → «Chile») como acotar («Chile» → «Santiago, Chile»).
   - Si cambiarlo es mejor, Cowork lo dice en una frase («Amplié a todo Chile porque en Calama hay pocos») y la búsqueda sigue.
   - En la última decisión del turno no hay corrección: la tarjeta muestra los criterios igual.
2. **Una búsqueda sin lugar usa el mercado de la persona**, sin gastar otra llamada al modelo:
   - primero, los lugares de «Tu cliente ideal» en Perfil (`targetLocations`), que ahora llegan a cada turno en `idealCustomer.locations`;
   - si no hay, `COWORK_DEFAULT_SEARCH_LOCATION`, que vale «Chile» si no está definida. Una variable vacía apaga el valor por defecto.
   - La explicación lo dice una vez: «Busco en Chile porque no dijiste dónde; si es en otro lugar, dímelo.».
3. **Dentro de una tarea larga**, el alcance que vale es el del plan aprobado (su objetivo y sus pasos), no el mensaje automático del turno.

No cambian:
- un perfil exacto de LinkedIn;
- una búsqueda con empresas dadas (`companyDomains`);
- un pedido «en cualquier país» o «global»;
- un pedido de Latinoamérica con sus países listados. Uno sin ningún país sí recibe la corrección.

Una búsqueda de empresas (`target: companies`) usa `companyLocations`; la de personas, `locations`.

## Cómo funciona

- `src/lib/cowork/search-scope.ts`: módulo puro, sin modelo.
  - Detecta los lugares que nombra el pedido, a partir de una lista de países de la región y de ciudades y regiones de Chile.
  - Ignora un lugar que se nombra para excluirlo («fuera de Santiago») y nunca toma «usa» como Estados Unidos.
  - Compara contra los criterios. Una ciudad queda cubierta por cualquier valor que la nombre; un país, solo por sí mismo.
  - Completa el valor por defecto.
- `agent-loop.ts`, en `prospecting.propose_search`: aplica el alcance antes de proponer, también en las búsquedas que una tarea aprueba sola.
- `worker.ts` y el runner de evaluación pasan `searchDefaults`. El worker pasa además `scopeRequest` dentro de una tarea.
- Las instrucciones piden conservar el lugar y, si no se dijo, dejar `locations` vacío para que la app lo complete.

## Medición

Luna, 9 casos que proponen búsquedas, 2 repeticiones, `main` contra este PR, con los flags de producción:

| | main | este PR |
|---|---|---|
| Búsquedas sin ubicación | 2 (las de `axis-a5-perfil`) | 0 |
| Correcciones por alcance | — | 0 (el modelo ya conservaba el lugar pedido) |
| Verificaciones en común | 160/204 | 160/204 |
| Verificaciones nuevas | — | 6/6 |

Los casos AXIS fallan igual en ambos lados, por verificaciones de contenido que no tienen relación con este cambio.

## Rollback

`git revert` del PR. Para apagar solo el valor por defecto, basta con `COWORK_DEFAULT_SEARCH_LOCATION=""`.
