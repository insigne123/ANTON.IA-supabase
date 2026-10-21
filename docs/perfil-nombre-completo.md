# Pedir el nombre completo al abrir la app

**Fecha:** 21 de octubre de 2026.

## Por qué

- **Quien no tiene nombre no se encuentra.** «Asignar equipo» de Oportunidades, el informe semanal y las metas listan al equipo por nombre. Una cuenta con el campo `profiles.full_name` vacío aparecía como «Integrante» (o «Sin nombre»), y nadie podía reconocerla ni asignarle nada.
- **Caso real (21 de octubre, producción):** `vespinoza@grupoexpro.com` tenía cuenta y era miembro de GrupoExpro, pero sin nombre en el perfil; el administrador no la encontraba al asignar. Otras tres cuentas estaban igual (`cortega@`, `lgordo@` y `mifarias@`).

## Qué cambia

1. **Aviso al abrir la app** (`FullNamePrompt.tsx`, montado en `AppShell`). Si el perfil de la persona existe y no tiene nombre (vacío o solo espacios), se abre «¿Cómo te llamas?» con un solo campo, «Nombre completo», y un solo botón, «Guardar y continuar».
2. **No se puede cerrar sin responder.** No tiene «Cerrar»; Escape y el clic fuera no hacen nada (`DialogContent` recibe `hideClose`, una opción nueva y opcional del diálogo). La única salida es guardar el nombre. Debajo del botón dice que se puede cambiar cuando quiera en Perfil.
3. **Qué se acepta** (`src/lib/profile/full-name.ts`, `checkFullName`): nombre y apellido (al menos dos palabras), solo letras de cualquier alfabeto más apóstrofe, punto y guion (`D'Angelo`, `J. Pérez`, `Pérez-Cotapos`), hasta 120 caracteres. Se guarda con un solo espacio entre palabras. Un correo, números o símbolos no se aceptan, y el mensaje dice por qué. Un nombre ya guardado de una sola palabra no se vuelve a pedir: el aviso es solo para quien no tiene ninguno.
4. **Se guarda en el mismo campo que Perfil** (`profiles.full_name`, vía `profileService.updateProfile`, la fila propia con su regla RLS de siempre). No hay migración ni cambio de base de datos.
5. **Si algo falla, no bloquea la app.** Si el perfil no se puede leer, la app sigue sin avisar. Si el guardado falla, el aviso lo dice («No pudimos guardar tu nombre…»), conserva lo escrito y deja reintentar.
6. **El recorrido de bienvenida espera.** Las cuentas nuevas suelen no tener nombre; para que no se abran dos diálogos a la vez, el recorrido y las guías de pantalla empiezan recién cuando el nombre ya está (o no hacía falta).
7. **Mientras alguien no tiene nombre, se muestra su correo.** En la lista de equipo de Oportunidades (`workspaceMembers`) el nombre vacío cae al correo del perfil y solo en último caso a «Integrante». Así el administrador reconoce a la persona aunque todavía no haya abierto la app.

## Qué no cambia

- Nadie con nombre ve nada nuevo.
- No se tocan los datos de producción: las cuatro cuentas sin nombre lo escribirán ellas mismas la próxima vez que abran la app.

## Cómo se probó

- `full-name.test.ts`: cuándo falta el nombre, qué se acepta y qué se rechaza.
- `FullNamePrompt.test.ts`: sin salida más que su botón, validación antes de guardar, guardado una sola vez con el nombre normalizado, error y reintento, y que el perfil ilegible no bloquea.
- Navegador (banco `visual-audit`, perfil sin nombre): foco en el campo al abrir, Escape y clic fuera no lo cierran, vacío / una palabra / correo muestran su mensaje y no guardan, un nombre válido guarda una vez y al recargar ya no pregunta. Escritorio claro y oscuro, y teléfono oscuro.
