# Auditoría Cowork · 23 de septiembre de 2026

## Estado comprobado

El código y las migraciones de las partes 1–9 existen y están conectados al catálogo de Cowork. `node scripts/verify-cowork.mjs` pasó: 210 pruebas de contrato y el recorrido aislado de efectos. Esto **no** equivale a aceptación real de las 51 funciones. En producción, las cinco ejecuciones Cowork registradas para el usuario habilitado son del **17 de septiembre**, anteriores a las etapas 6–9. No existe evidencia de ejecución autenticada de las nuevas lecturas desde el chat.

Verificaciones de esta auditoría: `npm run typecheck` OK, `npm run build` OK (único aviso preexistente por `<img>` en `ArtifactPreview.tsx`), 28 pruebas focalizadas iniciales y `verify-cowork` completo (210 pruebas más scripts aislados) OK. Pruebas unitarias no cargaron `.env.local` ni escribieron en producción.

El snapshot corregido se desplegó con Firebase App Hosting: `studio--96196-GlBYZi983cyv-.zip`, rollout `studio` completo. `/login` responde. La consulta inmediata de logs mostró un error de refresco de sesión en middleware de la **revisión anterior** `studio-build-2026-09-23-006`, no una ejecución autenticada de Cowork en el snapshot nuevo; no se interpreta como aprobación del recorrido.

La matriz de aceptación operativa continúa en `docs/cowork-authenticated-acceptance-checklist.md`. Sus casillas no se marcan con unit tests. Un único envío de prueba controlado tampoco puede certificar la ejecución real de siete toques durante 38 días.

## Defectos detectados y corregidos en esta auditoría

- El barrido del buzón adelantaba el cursor y marcaba completa una ventana aunque hubiera más de cinco contactos candidatos, fallara un hilo o fallara la persistencia del cursor. Ahora deja la cobertura incompleta y un error explícito; no salta esos contactos. Una página con más de cinco candidatos continúa bloqueada hasta implementar una cola durable por página.
- Los errores del proveedor de identidad podían quedar persistidos completos en `last_error`; ahora se reduce a códigos sin detalles del OAuth.
- El DNS etiquetaba una caída del resolver como ausencia de SPF/DMARC y guardaba el falso fallo durante 24 h; el temporizador además se cancelaba antes de que terminara la consulta. Se repararon ambos casos. DKIM exige un registro con clave pública, no cualquier TXT en el selector.
- Las métricas podían tratar 2.000 contactos, 500 compromisos o 500 bajas truncados como población completa, y una lectura fallida de interesados sin seguimiento como cero casos. Ahora fallan explícitamente ante cobertura incompleta.
- `compliance.check` buscaba colisiones empresa-día solo entre correos enviados a **esa misma persona**, ignorando a colegas de la cuenta. Ahora revisa los envíos del día de toda la organización; si el conjunto se trunca, no autoriza contacto.
- Cowork individual y la secuencia V2 automática no comprobaban empresa-día justo antes del proveedor. Se añadió el mismo control utilizado por lotes. El verificador aislado de Cowork no tenía fixtures para los nuevos guardas de etapa 9; quedó actualizado y verificado.

## Límites de cobertura y pasos de aceptación reales

- Parte 1: criterios de audiencia con modelo y Apollo verificados en pruebas; falta validación con la audiencia aprobada del equipo en el chat desplegado.
- Parte 2: la revisión de lista y deduplicación están cableadas; falta corroborar correo/perfil y exclusiones de contactos controlados reales. `lists.review_contact` no autoriza envíos.
- Parte 3: sin ejemplos de voz, oferta y afirmaciones aprobados en `organization_messaging_context` no se puede certificar el lenguaje comercial; ese material debe venir del equipo.
- Parte 4: programación, frenos y cadencia existen; falta ejecutar un lote de prueba controlado y verificar registro, estado incierto y frenos. La cadencia completa exige observación a lo largo del tiempo.
- Parte 5: extensión y jobs verificados en pruebas simuladas, sin resultados reales de LinkedIn registrados para el usuario habilitado; no se ha confirmado DOM de invitación ni bandeja real.
- Parte 6: solo se barra una ventana de 30 días por buzón, **no todo el historial**. Si hay más de cinco candidatos en una página, la cobertura queda incompleta; Outlook del usuario habilitado informa `invalid_grant` y requiere reconectar Microsoft. Gmail solo reporta ventanas de los buzones donde existe actividad y no demuestra cobertura global de todo el equipo.
- Parte 7: tasas de ventanas 7/30 días requieren población completa; la atribución de reuniones a LinkedIn sigue sin evidencia. Una tasa de respuestas en el período dividida por envíos del período no es una tasa de cohortes maduras; úsese como indicador operativo, no de conversión causal.
- Parte 8: DNS y remitente se consultan desde Cowork; sin mensaje controlado entregado al buzón destino con cabeceras observadas no se certifica autenticación de **entrega**. La cabecera de un mensaje en Enviados puede no contener Authentication-Results del destinatario.
- Parte 9: topes 1/día, 3/7d, 8/40d son defaults técnicos pendientes de ratificación comercial. La política transversal de email no prueba límites de invitación/mensaje de LinkedIn; ese canal tiene su propio cupo y enfriamiento.

No se crearon prospectos ni se enviaron mensajes para esta auditoría. Consultas a producción: lectura únicamente de estado de ejecuciones y barrido.
