# Cowork: una persona por su perfil exacto de LinkedIn

## Problema observado (2 oct 2026)

Al continuar un pedido de invitación con una URL personal de LinkedIn, Cowork usaba
esa URL como texto de `leads.search`. Palabras como «linkedin» y «com» coincidían
con los correos o cargos de otras personas. El resultado no permitía concluir que
el enlace era incorrecto: no se había consultado ese perfil en el proveedor.

## Flujo corregido

1. `leads.search` recibe una URL personal y consulta solo `linkedin_url` en los
   contactos propios guardados y de «Por escribir». No usa las palabras de la URL
   como nombres, correos ni empresas. Antes de devolver una fila se corrobora la
   coincidencia con `linkedinProfilesMatch`.
2. Si el perfil no está guardado y ambas fuentes se leyeron, ofrece una búsqueda
   externa con `linkedinUrl`, los tres filtros de texto vacíos y `limit: 1`.
   No necesita empresa, cargo ni ubicación. Un fallo al leer «Por escribir» se
   informa y no se interpreta como ausencia del contacto.
3. La tarjeta muestra el perfil exacto, el costo aproximado de 1 crédito del
   proveedor y una búsqueda de la cuota, y el botón «Consultar perfil».
4. Solo tras la aprobación, la cola consulta `/people/match`, sin revelar correo
   ni teléfono, y conserva las comprobaciones de identidad del proveedor.
5. El resultado contiene esa persona o ninguna. Un perfil distinto se rechaza;
   no se sustituye por personas parecidas ni se ofrece «Traer más».
6. Cowork conserva el encargo original: propone guardar el contacto y, después
   de confirmarlo, preparar la invitación o el mensaje. Cada efecto mantiene su
   aprobación. La extensión sigue ejecutando la invitación en el navegador.

Si el proveedor no conoce el perfil, se ofrece abrirlo y guardarlo desde la
extensión. No se inventan nombre, cargo ni empresa.

## Implementación y revisión

Se reutilizan la cola y RPC de búsquedas, la inserción idempotente de contactos y
las propuestas de LinkedIn. No requiere migración ni un flag nuevo.

Problema de flujo y componente. Referencias: las capturas del usuario y la tarjeta
de aprobación existente (`ReviewFields`, `ReviewField`, `ReviewActions`). El perfil
y el costo ocupan el lugar de filtros irrelevantes. El enlace abre en otra pestaña,
tiene foco visible y permite cortar una URL larga en móvil. Se mantienen los tokens
`cw-*` de los dos temas y los estados de aprobación y carga.

Pruebas aisladas, sin base de datos ni proveedores reales:

- `lead-tools.test.ts`: perfil exacto en las dos fuentes, exclusión de personas
  ajenas, permisos de usuario/organización y lectura incompleta.
- `search-proposal.test.ts`: un perfil, sin filtros adicionales ni ampliación de
  alcance, y propuesta que no consulta ni envía antes de aprobar.
- `apollo-search-client.test.ts`: solo `/people/match`, sin datos de contacto,
  negativa por identidad incorrecta y proveedor sin coincidencia.
- `test-cowork-external-search.mjs`: orden de aprobación, cuota y proveedor;
  resultado de una sola persona y continuación del encargo.
- `test-cowork-profile-search-ui.mjs`: enlace, costo, teclado, carga y una única
  aprobación en DOM con ambos temas. No certifica contraste renderizado.
