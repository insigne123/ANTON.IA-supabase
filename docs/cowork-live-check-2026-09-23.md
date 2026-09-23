# Cowork · comprobación tras reconexión y material público

Fecha de consulta: 23 de septiembre de 2026. Consultas a producción de solo lectura, sin envíos ni trabajos creados.

## Accesos observados

| Control | Evidencia | Estado |
|---|---|---|
| Outlook del usuario habilitado | `provider_tokens` renovado el 23 sep 14:57:51 UTC; barrido `outlook` con `last_completed_at` 14:59:14 UTC y `last_error=null` para uno de los buzones observados | Reconexión funcional para una ventana de 30 días; no equivale a envío probado |
| Cowork | Grant `enabled=true`; última ejecución productiva del usuario en `cowork_runs` sigue siendo del 17 sep | Página abierta por el usuario; aún no hay un nuevo trabajo que permita verificar nuevas lecturas del agente |
| Extensión/LinkedIn | `cowork_linkedin_jobs=0`, `cowork_linkedin_threads=0`, `cowork_linkedin_sweep_state=0`, `extension_profile_captures=0` para el usuario habilitado | Extensión abierta no acredita barrido ni ejecución; faltan señales emitidas. El panel actual solo ofrece «Sincronizar historial de LinkedIn» para resultados de envío, no controles de barrido de red o bandeja |
| Contexto de redacción | `organization_messaging_context` sin fila para la organización | No hay voz/oferta/aprobaciones guardadas; la propuesta pública sigue sin aprobación |

## Investigación comercial

El borrador `docs/cowork-grupoexpro-public-commercial-proposal.md` cita cuatro servicios publicados por GrupoExpro y un artículo sectorial. Los ejemplos están escritos como propuestas de tono, no atribuciones de voz real ni promesas de resultados. El contenido solo puede pasar a `organization_messaging_context` tras la revisión humana a través de la propuesta `message_context.update` de Cowork; un insert directo eludiría la revisión y la regla de cierre.

## Para reproducir aceptación de solo lectura en el chat

En la sesión abierta del usuario habilitado, iniciar **un trabajo nuevo** con: «Consulta `profile.get`, `message.context` y `deliverability.check` para `grupoexpro.com`. Responde solo con las observaciones y la cobertura; no propongas ni ejecutes envíos». Registrar ID del trabajo, observaciones devueltas y hora. Si una lectura falla, conservar el error sin reiniciar el mismo trabajo a ciegas. Después revisar la propuesta comercial y usar `message_context.update` para presentar la tarjeta de aprobación, sin activarla automáticamente.

Las pruebas con email a `nicogun123@gmail.com` y LinkedIn solo deben continuar después de revisar destinatario, remitente y acción que se ejecutará. Las tareas A–D permanecen abiertas en `docs/cowork-authenticated-acceptance-checklist.md` hasta conservar el resultado confirmado.
