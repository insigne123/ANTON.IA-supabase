# LinkedIn de punta a punta: estado y prueba guiada (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- **«Ninguno tiene LinkedIn»:** Cowork leía el LinkedIn solo del contacto guardado (`leads`), y los guardados desde Cowork no lo traían.
- **Nunca se usó:** en producción nunca se había ejecutado una invitación ni un mensaje (0 trabajos).

## Estado (lecturas de solo lectura en producción, 1 oct)

| Dato | Cifra |
|---|---|
| Contactos guardados | 9.047 |
| Con perfil personal de LinkedIn (`/in/`) | 7.657 |
| Trabajos de LinkedIn de Cowork (`cowork_linkedin_jobs`) | 0 |

- **Cowork:** desde el PR-1 (`docs/contactos-identidad.md`), al buscar el correo de un contacto se guarda también su LinkedIn, y los ya enriquecidos se corrigieron. Cowork lee ese LinkedIn guardado.
- **El código del flujo está completo:**
  1. **Propuesta:** Cowork propone `linkedin.invite`, `linkedin.message` o un lote, con tarjeta de aprobación.
  2. **Cola:** al aprobar, el trabajo queda en `cowork_linkedin_jobs` y vence en 7 días.
  3. **Extensión:** en el perfil de esa persona, la extensión lo muestra en «Consultar trabajos» y lo ejecuta con «Ejecutar». Antes reclama el trabajo y verifica que la pestaña es ese perfil.
  4. **Resultado:** queda registrado (confirmado, por comprobar o fallido). Lo incierto nunca se reintenta solo.
- **Nada se envía solo:** siempre lo ejecuta la persona desde su navegador.

## Qué cambia en este PR

**Pasos claros al aprobar.** Antes Cowork decía «Ejecútala desde la extensión ante ese perfil». Ahora da los pasos y el enlace al perfil:

> Dejé lista la invitación para Rafael D. Para enviar la invitación: abre su perfil (https://www.linkedin.com/in/…), abre la extensión de ANTON.IA, toca «Consultar trabajos» y luego «Ejecutar». Nada sale solo; vence en 7 días si no lo ejecutas.

- En lote se dice lo mismo para cada persona.
- El nombre oculto se muestra como «Rafael D.».

## Prueba guiada con tu cuenta (en tu navegador)

Solo se puede hacer con tu sesión de LinkedIn. Usa un contacto de confianza; puede ser alguien de tu equipo.

1. **Extensión:**
   - Instala o actualiza la extensión de ANTON.IA (`chrome-extension/`, ver `DEPLOY_EXTENSION.md`).
   - Abre su panel y toca «Conectar Anton.IA».
   - Confirma «Conectar mi cuenta» en la pestaña de la app.
2. **Cupo:** en Cowork escribe: «¿Cuál es mi cupo de invitaciones de LinkedIn esta semana?». Debe responder con el cupo real.
3. **Propuesta:** en Cowork escribe: «Invita por LinkedIn a <nombre del contacto>».
   - Si el contacto no tiene perfil guardado, Cowork lo dice y ofrece el correo.
   - Si lo tiene, propone la invitación con su tarjeta.
4. **Aprobación:** aprueba la tarjeta. La respuesta trae el enlace al perfil y los pasos.
5. **Envío:**
   - Abre el enlace del perfil y el panel de la extensión.
   - Toca «Consultar trabajos»: aparece la invitación.
   - Toca «Ejecutar».
6. **Resultado:**
   - La extensión dice «Trabajo confirmado en LinkedIn» o «Resultado por comprobar». En el segundo caso, revisa LinkedIn: no se reintenta solo.
   - En Cowork, «¿Cómo van mis trabajos de LinkedIn?» muestra el estado.
7. **Mensaje** (opcional, a una conexión ya aceptada): repite los pasos 3 a 6 con «Escríbele por LinkedIn a <nombre>».
8. **Lote** (cuando el mantenedor encienda `COWORK_LINKEDIN_BATCH_ENABLED`): «Invita por LinkedIn a estas 3 personas». La tarjeta permite quitar personas y los pasos se repiten por perfil.

## Pendiente

- **El lote** sigue detrás de `COWORK_LINKEDIN_BATCH_ENABLED`: lo enciende el mantenedor después de que la prueba guiada salga bien con un contacto.
- **El flujo del navegador** (extensión y página de LinkedIn) no se puede automatizar desde aquí, porque necesita tu sesión.
