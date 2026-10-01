# Nombre real y LinkedIn en cada contacto (1 oct)

**Problema:** la búsqueda de prospectos entrega el apellido oculto («Rafael Du\*\*\*n») y sin LinkedIn. Al buscar el correo, el proveedor devuelve el nombre real y el LinkedIn, pero no llegaban al contacto guardado.

**Lo que se midió en producción (solo lectura):**
- de 406 contactos guardados en 60 días, 399 tenían el apellido oculto y ninguno tenía LinkedIn;
- en toda la base, 787 contactos guardados tienen el apellido oculto.

**Consecuencias en la prueba del 1 oct (`Pruebas_de_app.docx`):**
- nombres «censurados» incluso después de buscar el correo;
- correos con «Hola,» sin nombre;
- las 3 investigaciones de ese día se pidieron con el nombre oculto. Por eso no encontraron nada de la persona (cobertura 0) y quedaron «parciales»;
- Cowork respondió «ninguno de tus contactos tiene LinkedIn»;
- una tabla mostró 5 personas cuando se trabajaba con 2: la búsqueda por texto con nombres ocultos trae a otros.

## Qué cambia

1. **Al buscar el correo**, el nombre real, el LinkedIn y el cargo vuelven al contacto guardado (`leads`) y al enriquecido (`enriched_leads`). Lo hace `applyEnrichedIdentity` (`src/lib/server/lead-identity.ts`), con estas reglas:
   - solo llena vacíos: un nombre oculto o vacío, un LinkedIn o un cargo vacío. Nunca pisa lo que alguien escribió;
   - toca solo filas de la misma persona y cuenta: mismo usuario y organización, y el mismo id de persona del proveedor si el contacto ya tenía uno;
   - cada cambio va protegido por el valor que reemplaza, así que una edición simultánea gana.

   Se usa en:
   - Cowork (`enrich-contact.ts`, y con eso también el lote);
   - «Buscar correo» de «Por completar» (`src/app/api/opportunities/enrich-apollo/route.ts`, que recibe el contacto guardado como `clientRef`).
2. **La investigación usa el nombre completo** cuando existe, aunque esté en otra fila:
   - `loadApolloResearchContext` trae la búsqueda de correo vinculada al contacto guardado;
   - un nombre oculto nunca reemplaza uno completo.
3. **Si el apellido sigue oculto,** la búsqueda de la persona usa el nombre de pila, la empresa y el cargo. Para aceptar un resultado, el apellido debe calzar por sus extremos visibles: «Durán» calza con «Du\*\*\*n», «Godoy» no (`textNamesPerson` en `src/lib/lead-name.ts`).
4. **En pantalla:**
   - un apellido oculto se lee «Rafael D.» con la nota «apellido al buscar el correo», en «Por completar», «Por escribir» y las tablas de Cowork;
   - los asteriscos ya no aparecen.
5. **Aviso de correo ajeno:** si el correo parece de otra persona («rgodoy@…» para «Rafael Du\*\*\*n»), «Por escribir» y Cowork lo dicen. Es un aviso, no un bloqueo: los buzones generales («contacto@», «rrhh@») no se juzgan.
6. **Corrección de lo guardado antes:** la migración `20261001200000_leads_identity_backfill.sql` copia el nombre y el LinkedIn de la búsqueda de correo ya hecha, con las mismas reglas.
   - Al 1 oct calzaban 15 contactos.
   - El resto nunca buscó su correo; se corrige al buscarlo.

## Pruebas

- `src/lib/lead-name.test.ts`:
  - nombre oculto;
  - nombre de pila;
  - nombre preferido;
  - calce por extremos;
  - correo vs nombre.
- `src/lib/server/lead-identity.test.ts`:
  - solo vacíos;
  - otra persona u otra cuenta no se tocan;
  - filtros por usuario, organización y valor anterior.
- `src/lib/server/native-person-research.test.ts`: búsqueda y calce con el apellido oculto.
- `src/lib/server/apollo-research-context.test.ts`: la investigación de un contacto guardado toma el nombre real de su búsqueda de correo.
- `supabase/tests/database/leads_identity_backfill.test.sql`: la regla de la migración sobre datos de prueba.
- `scripts/test-cowork-contact-names.mjs`: DOM de la tabla de Cowork; corre en `verify-cowork`.
