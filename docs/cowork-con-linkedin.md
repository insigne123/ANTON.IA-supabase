# Cowork: «con LinkedIn» busca en toda la cuenta (8 oct 2026)

## Problema

Ante «¿a quién de mis contactos con perfil de LinkedIn invito esta semana?», Cowork leía `leads.search` con query vacía. Eso trae los
20 contactos más recientes, y en el banco solo 4 de una cuenta de 256. Sacaba la conclusión de esa muestra y la presentaba como el
total: «Revisé tus cuatro contactos guardados…», «ninguno muestra un perfil de LinkedIn guardado».

Para el correo ya existía el filtro «con correo» (Plan 15), que busca en toda la cuenta. Para LinkedIn no había uno.

## Cambio

- **`src/lib/server/cowork/lead-tools.ts`**: `leads.search` reconoce «con LinkedIn» («con perfil de LinkedIn», «con un perfil en
  LinkedIn»).
  - Deja solo a quienes tienen `linkedin_url`, en guardados y en «Por escribir», hasta 25, y marca `withLinkedinOnly`.
  - Se puede combinar con otras palabras («gerentes con LinkedIn») y con «con correo».
  - Una URL de perfil sigue siendo una búsqueda exacta.
- **`read-capabilities.ts`**: la descripción de `leads.search` explica los dos filtros.
- **`agent-instructions.ts`**:
  - La receta «¿A quién invito por LinkedIn?» usa `leads.search` con «con LinkedIn».
  - Los seguimientos por LinkedIn (`linkedin.followups`) se consultan junto con `linkedin.network`, para decir si falta sincronizar
    cuando la lista viene vacía. Sin esa lectura, la explicación de cómo sincronizar salía en 1 de 6 corridas; con ella, en 4 de 4.
- **Bancos** (`cowork-conversation-corpus.ts`, `cowork-marketing-corpus.ts`): responden «con LinkedIn» como el servidor.
- **Prueba unitaria nueva** en `lead-tools.test.ts`.

## Medición

5 casos de LinkedIn (a quién invitar, invitar a una persona, seguimientos), 2 veces cada uno, con `gpt-6-luna`. Otra sesión de
Claude leyó a ciegas las 20 respuestas mezcladas:

| | Antes | Ahora |
|---|---|---|
| Buenas / mejorables / malas | 5 / 1 / 4 | 6 / 3 / 1 |
| Elección (1 a 5) | 3,70 | 4,20 |
| Veracidad | 3,80 | 4,90 |
| Claridad | 4,10 | 4,40 |
| Utilidad | 3,90 | 3,80 |
| Posición media (1 = mejor de 4) | 2,80 | 2,20 |
| Checks automáticos | 82 de 82 | 82 de 82 |

Queda pendiente, según el evaluador: cuando no hay nada que hacer (ningún perfil, ningún seguimiento), proponer una acción que
Cowork pueda hacer, como buscar el correo, que también trae el perfil.

Sin migraciones ni flags.
