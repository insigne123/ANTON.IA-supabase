# Claude: credencial de plataforma

La clave de Anthropic se guarda en Google Secret Manager, proyecto `leadflowai-3yjcy`, secreto `ANTHROPIC_API_KEY`. El usuario autorizó expresamente el almacenamiento persistente y la preparación del acceso/binding del servidor el13oct2026. Los miembros del workspace no ingresan ni reciben esta clave.

`apphosting.yaml` referencia el nombre del secreto, con disponibilidad exclusiva `RUNTIME`. No es una variable `NEXT_PUBLIC_*`, no se añade al bundle del navegador ni al build. El cliente existente `src/ai/anthropic-json.ts` lo consume en el servidor. La integración de esta referencia no cambia la selección de modelos, los flags de Oportunidades, las migraciones o el presupuesto por workspace.

## Instalación y verificación

1. Recibir la clave por entrada oculta y comprobar acceso a los modelos permitidos, sin inferencia pagada.
2. Crear el secreto/versionado en Secret Manager, sin guardar el valor en el repositorio, archivos de entorno o evidencia local.
3. Confirmar lectura de la versión y conceder únicamente los permisos de App Hosting sobre este secreto: accessor a las identidades de build/runtime, viewer a build y version manager al service agent de App Hosting. Conservar las políticas existentes y su etag al actualizar.
4. Registrar solo metadata: recurso, versión enabled, permisos comprobados y si el runtime desplegado tiene binding.
5. Publicar el binding mediante PR a main. El despliegue y comprobación del runtime son una operación posterior: tener una versión enabled no prueba que la revisión actual de Cloud Run ya la tenga conectada.

No declarar el secreto guardado antes del recibo y readback correctos. La sesión de Firebase puede requerir renovación legítima mediante `firebase login --reauth`; eso no significa que haya que compartir credenciales por chat. Para un piloto real autorizado se lee la versión en memoria, conservando su ledger y sus topes.

## Ciclo de vida

La clave es persistente, pero revocable/rotatable. Rotación: nueva clave del proveedor, nueva versión del mismo secreto, comprobación y rollout desde main limpio; comprobar el runtime antes de retirar la versión anterior/clave en uso. App Hosting fija la versión del secreto durante el rollout, de modo que cambiar `latest` no sustituye automáticamente lo que ya consume una revisión en ejecución. Conservar el punto de retorno y metadata del release. Ninguna clave se publica en PRs, logs o archivos descargables.

La facturación corresponde a la cuenta de plataforma de Anthropic. El módulo Oportunidades aplica el presupuesto acordado de US$20/mes/workspace; esa separación debe permanecer en el backend y no depender del navegador. Guardar la clave no activa por sí mismo la automatización ni habilita envíos/postulaciones.
