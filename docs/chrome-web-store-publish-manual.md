# Manual para publicar Anton.IA en Chrome Web Store

> **Actualización 4.0.5 (13 septiembre 2026):** las afirmaciones sobre envío de 4.0.4 en este manual son históricas y quedan sustituidas por `chrome-extension/STORE_JUSTIFICATIONS.md` y `docs/linkedin-extension-release-4.0.5.md`. El nuevo flujo requiere migración y backend antes de enviar. El máximo es 1200 caracteres, el botón es «Revisar y enviar», SEND_DM histórico se rechaza y los resultados se guardan en historial. No publicar un ZIP sin completar la validación autenticada descrita en el documento del candidato.

Guía para entregar a una IA y ejecutar con su ayuda.

**Objetivo:** distribuir la extensión de Anton.IA mediante un enlace de Chrome Web Store, con instalación sencilla y actualizaciones automáticas.

**Decisión registrada:** publicación **pública**, con **publicación automática** al aprobarse. La extensión incluye **envío automático de mensajes LinkedIn solo tras confirmación explícita** en el panel (destinatario verificado, máximo 500 caracteres, registro como enviado solo si LinkedIn muestra el mensaje saliente).

> Este manual describe la preparación y publicación. La extensión está disponible como ZIP, pero eso no significa que esté aprobada o publicada en Chrome Web Store. La IA debe comprobar el estado actual antes de actuar.

---

## 1. Contexto del proyecto

### Aplicación

| Dato | Valor |
|---|---|
| Producto | Anton.IA |
| Plataforma | Aplicación web y extensión Chrome Manifest V3 |
| Repositorio local | `C:\Users\nicol\Desktop\ANTON.IA` |
| Rama canónica | `main` |
| Node requerido | Node 22 |
| Hosting web | Firebase App Hosting |
| Proyecto Firebase | `leadflowai-3yjcy` |
| Backend App Hosting | `studio` |
| Supabase de producción | `yfdelflsheurzaicwayi` |

**URL principal de la app:**

```text
https://studio--leadflowai-3yjcy.us-central1.hosted.app
```

**Descarga actual del ZIP:**

```text
https://studio--leadflowai-3yjcy.us-central1.hosted.app/downloads/antonia-linkedin-extension.zip
```

**Versión de tienda al preparar este manual:** `4.0.4` (incluye envío automático con confirmación explícita desde el panel).

La IA debe revisar el manifest para confirmar la versión vigente.

### Qué hace la extensión

- Detecta un perfil de LinkedIn o acepta su URL.
- Consulta y enriquece datos profesionales mediante los servicios de Anton.IA.
- Guarda el lead en la organización del usuario.
- Solicita investigación y muestra resultados y fuentes.
- Genera mensajes personalizados.
- Permite editar y copiar mensajes.
- Prepara un mensaje en LinkedIn para que el usuario haga el envío final.
- Envía el mensaje automáticamente **solo** tras una confirmación explícita en el panel que muestra destinatario y texto (máximo 500 caracteres), con destinatario verificado y registro como enviado únicamente si LinkedIn muestra el mensaje saliente.
- Integra borradores y secuencias de email de la app.
- Permite añadir contactos a campañas compatibles, sujeto a permisos y disponibilidad.

### Autenticación actual

La extensión conecta con una pestaña de la app:

```text
/extension/connect
```

El usuario confirma **Conectar mi cuenta**. La pestaña autorizada utiliza su sesión web para realizar operaciones contra:

```text
/api/extension/workspace
```

Actualmente, esa pestaña debe permanecer abierta durante el uso de la extensión.

**No confundir:**

- Cuenta de Google del publicador: administra la ficha de Chrome Web Store.
- Cuenta de Anton.IA: permite utilizar las funciones de la extensión.
- Sesión de LinkedIn: permite abrir perfiles y conversaciones.

---

## 2. Archivos que debe revisar la IA

```text
chrome-extension/
├── manifest.json
├── manifest.release.json
├── background.js
├── content.js
├── prospecting-background.js
├── prospecting-bridge.js
├── prospecting-content.js
├── web_injector.js
├── panel.html
├── icon.png
├── ui/
│   ├── panel.tsx
│   └── panel.css
├── tests/
├── dist/
├── DEPLOY_EXTENSION.md
├── STORE_JUSTIFICATIONS.md
└── store-assets/
```

Otros archivos relevantes:

```text
scripts/build-linkedin-extension.mjs
scripts/test-linkedin-extension-browser.mjs

src/app/(app)/extension/connect/page.tsx
src/app/api/extension/workspace/route.ts

src/lib/extension-contracts.ts
src/lib/server/extension-leads.ts
src/lib/server/extension-campaigns.ts

public/downloads/antonia-linkedin-extension.zip
```

### Regla importante sobre cambios visuales

Las fuentes son:

```text
chrome-extension/ui/panel.tsx
chrome-extension/ui/panel.css
```

**No editar únicamente `dist/` o una carpeta descomprimida de Downloads.** Esos cambios pueden desaparecer en la siguiente compilación.

Los documentos existentes de publicación pueden contener información histórica. Se deben contrastar con el código y la versión que se subirá.

---

## 3. Precaución con los despliegues del proyecto

Hubo un incidente previo: varias sesiones de IA publicaron versiones parciales sobre el mismo backend `studio`. Cada publicación reemplazó a la anterior y algunas eliminaron temporalmente las rutas de la extensión.

Para evitar repetirlo:

1. Trabajar desde `main`.
2. Revisar `git status` y los cambios existentes.
3. Preservar el trabajo del usuario y de otros módulos.
4. Utilizar una única fuente de despliegue.
5. No desplegar desde copias históricas o worktrees detached.
6. No publicar una copia parcial antigua para “arreglar solo la extensión”.

**Publicar la extensión en la tienda y desplegar la app son operaciones distintas.** Si la app ya tiene las API necesarias, no hace falta redesplegarla solo para subir un ZIP a Chrome Web Store.

---

## 4. Lo que debe aportar el propietario

Antes de comenzar, reunir:

- Cuenta de Google controlada por la empresa.
- Acceso al correo de esa cuenta.
- Verificación en dos pasos habilitada.
- Medio de pago para la tarifa de registro que indique Google.
- Nombre público del publicador.
- Nombre legal o empresarial cuando Google lo solicite.
- Correo real de soporte.
- Sitio web oficial.
- URL pública de política de privacidad.
- Logo e imágenes con derechos de uso.
- Decisión de visibilidad: pública, no listada o privada.
- Cuenta de demostración de Anton.IA para revisión, si resulta necesaria.

### Seguridad de las credenciales

El propietario debe completar directamente:

- Contraseña de Google.
- Códigos de verificación.
- Pagos.
- Verificación de identidad.
- Recuperación de cuenta.

No guardar contraseñas, cookies, tokens de Google, claves de proveedores ni credenciales de revisión en el repositorio o en documentos públicos.

---

## 5. Crear la cuenta de desarrollador

### Procedimiento

1. Abrir:

   **https://chrome.google.com/webstore/devconsole/**

2. Iniciar sesión con la cuenta empresarial elegida.
3. Completar el registro como desarrollador.
4. Aceptar los términos aplicables.
5. Pagar la tarifa que muestre el panel.
6. Completar y verificar los datos del publicador.
7. Configurar correo de contacto y notificaciones.
8. Resolver cualquier requisito de identidad, dirección o condición comercial que aparezca para los mercados seleccionados.

**No asumir un importe fijo de registro:** comprobar el valor vigente en el panel.

### Propiedad empresarial

Evitar que la extensión dependa exclusivamente de una cuenta personal de alguien que pueda dejar la empresa.

Si varias personas administrarán la publicación, revisar las opciones oficiales de propiedad compartida y permisos. No compartir una misma contraseña.

---

## 6. Auditoría obligatoria antes de subir el ZIP

### 6.1. Estado del flujo de envío automático (resuelto en 4.0.4)

El panel nuevo ofrecía solo preparación manual, mientras el paquete incluía el flujo histórico de envío automático (`SEND_DM` / `EXECUTE_DM_FLOW`) sin una pantalla que lo invocara. Decisión registrada: **la versión final incluye envío automático como función declarada**.

Implementación en `4.0.4`:

- Vista Contactar del panel: botón «Enviar automáticamente» que abre una confirmación con destinatario y texto (máximo 500 caracteres). Cualquier edición del mensaje cierra la confirmación.
- Solo se envía con el perfil del lead abierto en LinkedIn y el destinatario verificado; si no puede confirmarse, se ofrece copiar el texto.
- `background.js` acepta `SEND_DM` únicamente del panel lateral o de una pestaña de Anton.IA autorizada. El puente web→extensión (`web_injector.js`) se conserva, pero actualmente ninguna pantalla de la app lo invoca: el envío se inicia desde el panel.
- `content.js` escribe el texto, pulsa Enviar y espera la confirmación visible del mensaje saliente; si LinkedIn no lo muestra, informa el error y no lo registra como enviado. Nunca convierte un mensaje directo en solicitud de conexión.

La ficha, la política de privacidad, las justificaciones y las instrucciones de revisión deben describir este comportamiento con precisión. No presentarlo como una extensión exclusivamente manual.

### 6.2. Revisar permisos

El manifest de distribución actualmente contempla:

```json
"permissions": [
  "tabs",
  "sidePanel",
  "storage"
]
```

Y acceso a:

```text
https://www.linkedin.com/*
https://app.antonia.ai/*
https://studio--leadflowai-3yjcy.us-central1.hosted.app/*
```

La IA debe comprobar si todos son necesarios.

| Permiso | Uso previsto |
|---|---|
| `sidePanel` | Mostrar el espacio de trabajo lateral. |
| `storage` | Conservar conexión y borradores temporales, según el almacenamiento implementado. |
| `tabs` | Identificar perfiles abiertos y gestionar la pestaña de conexión con la app. |
| LinkedIn | Leer contexto del perfil y preparar el mensaje solicitado. |
| Dominios Anton.IA | Conectar con la sesión de la app y ejecutar operaciones autorizadas. |

**Importante:** parte de la funcionalidad de pestañas puede estar cubierta por permisos de host. La IA debe evaluar si `tabs` realmente es imprescindible; no conservarlo solo porque ya existe.

El ZIP de tienda no debe pedir acceso a:

- `localhost`.
- Dominios de desarrollo innecesarios.
- Todos los sitios con `<all_urls>`.
- Historial, cookies u otros permisos no utilizados.

### 6.3. Revisar código remoto

Comprobar que:

- React, CSS y JavaScript ejecutable estén dentro del paquete.
- No se descarguen scripts de un CDN para ejecutarlos.
- No se use `eval` o ejecución de código recibido desde el servidor.
- Las respuestas de IA se traten como texto o datos, no como código.
- No haya instrucciones remotas que alteren la funcionalidad de forma contraria a las políticas.

**Consultar una API o un modelo de IA no equivale por sí mismo a cargar código remoto.** La distinción depende de qué se descarga y cómo se utiliza.

### 6.4. Revisar datos personales

Inventariar lo que realmente se:

- Lee desde LinkedIn.
- Envía a Anton.IA.
- Envía a proveedores de enriquecimiento o IA.
- Almacena en el navegador.
- Guarda en el servidor.
- Incluye en logs.

No declarar “no recogemos datos” si se transmiten perfiles, emails, mensajes o identificadores de cuenta.

### 6.5. Revisar marcas y afirmaciones

- No usar logos de Apollo ni insinuar afiliación.
- No afirmar que Anton.IA es una extensión oficial de LinkedIn.
- No prometer datos siempre disponibles o verificados.
- No prometer envíos o secuencias que no estén habilitados realmente.
- Revisar las condiciones de LinkedIn aplicables al acceso y automatización utilizados.

La aprobación de Chrome Web Store no equivale a una autorización de LinkedIn.

---

## 7. Compilar el paquete

Desde la raíz del repositorio, con Node 22:

```powershell
npm ci
npm run extension:build
npm run extension:test
npm run typecheck
npm run extension:release
```

Si ya existen dependencias instaladas y correctas, la IA puede evitar reinstalarlas innecesariamente.

### Resultados esperados

Carpeta de distribución:

```text
chrome-extension/dist/
```

ZIP de descarga:

```text
public/downloads/antonia-linkedin-extension.zip
```

El script actual genera ese ZIP en Windows. Si se ejecuta en otro sistema, revisar el script y preparar el ZIP equivalente.

### Estructura correcta del ZIP

```text
manifest.json
background.js
content.js
prospecting-background.js
prospecting-bridge.js
prospecting-content.js
web_injector.js
panel.html
panel.js
panel.css
icon.png
```

La lista final puede cambiar si se retira el flujo histórico.

**`manifest.json` debe estar en la raíz del ZIP.**

Incorrecto:

```text
mi-carpeta/
└── manifest.json
```

No incluir:

- `.env`.
- Claves privadas o archivos `.pem`.
- Credenciales.
- `node_modules`.
- Copias de respaldo.
- Capturas con datos privados.
- Archivos `.bak`.
- Carpetas de trabajo de otras herramientas.

### Comprobar versión

Revisar ambos manifests:

```text
chrome-extension/manifest.json
chrome-extension/manifest.release.json
```

Para una actualización de tienda, la versión debe ser superior a la publicada. Por ejemplo:

```text
4.0.3 → 4.0.4
```

No usar etiquetas como `4.0.4-beta` en el campo numérico `version`.

---

## 8. Pruebas antes de la publicación

Las pruebas automáticas existentes usan respuestas simuladas en partes del flujo. **No sustituyen la prueba autenticada de la extensión real.**

### Instalación limpia

1. Usar un perfil de Chrome de prueba.
2. Abrir `chrome://extensions`.
3. Activar modo desarrollador.
4. Cargar `chrome-extension/dist`.
5. Confirmar la versión.
6. Revisar errores de la extensión y del service worker.

### Flujo funcional mínimo

| Prueba | Resultado esperado |
|---|---|
| Abrir el panel sin conexión | Bienvenida y botón de conexión. |
| Conectar desde la extensión | Se abre la app y permite confirmar la cuenta. |
| Conectar sin sesión web | Permite iniciar sesión y retomar o reiniciar claramente la conexión. |
| Abrir un perfil LinkedIn | URL y contexto correctos. |
| Enriquecer | Estado de carga, resultado o error accionable. |
| Perfil sin coincidencia | No inventa datos; ofrece continuación útil. |
| Guardar | El lead aparece en la organización correcta. |
| Guardar otra vez | No crea duplicados por el mismo reintento. |
| Investigar | Trabajo iniciado y recuperable en el servidor. |
| Generar mensaje | Borrador editable, sin envío. |
| Preparar en LinkedIn | Inserta únicamente en el destinatario confirmado. |
| Conversación con borrador | No sobrescribe el texto existente. |
| Cambiar de perfil | No mezcla destinatario, datos y mensaje. |
| Crear secuencia | Respeta requisitos, permisos y aprobación. |
| Desconectar | Revoca el vínculo de la extensión. |
| Cerrar pestaña de conexión | Explica que es necesario reconectar. |

### Casos especialmente importantes

- Dos conversaciones de LinkedIn abiertas.
- Perfil sin botón de mensaje directo.
- Perfil con restricciones o diálogo de InMail.
- Cambio de organización en Anton.IA.
- Sesión expirada.
- Falta de créditos.
- Pérdida de red.
- Cierre y reapertura del panel.
- Reinicio del service worker.
- Navegación de LinkedIn sin recargar la página.

### Visual y accesibilidad

Revisar:

- Claro y oscuro.
- Anchos 320, 380 y 520 px.
- Zoom del navegador.
- Navegación por teclado.
- Foco visible.
- Cuenta conectada identificable.
- Estados de carga y error.
- Avisos que no tapen controles.

---

## 9. Preparar la ficha de Chrome Web Store

### Nombre sugerido

```text
Anton.IA — LinkedIn Workspace
```

### Descripción breve sugerida

```text
Guarda e investiga leads y prepara mensajes personalizados desde LinkedIn con Anton.IA.
```

### Descripción larga propuesta

Adaptar después de verificar qué funciones contiene el paquete:

> Trabaja sobre perfiles de LinkedIn con el contexto comercial de Anton.IA.
>
> Desde un panel lateral puedes consultar y enriquecer datos profesionales, guardar contactos en tu organización, solicitar investigación y preparar mensajes personalizados.
>
> Funciones:
>
> • Detectar el perfil abierto o introducir una URL de LinkedIn.
> • Enriquecer datos profesionales mediante los servicios disponibles en tu cuenta.
> • Guardar contactos en Anton.IA.
> • Investigar personas y empresas y consultar fuentes.
> • Generar, editar y copiar borradores de mensajes.
> • Preparar un mensaje en LinkedIn para revisarlo y enviarlo manualmente.
> • Enviar el mensaje automáticamente tras una confirmación explícita que muestra destinatario y texto (máximo 500 caracteres). El envío solo se registra si LinkedIn muestra el mensaje saliente.
> • Acceder a funciones compatibles de seguimiento por email.
>
> Requiere una cuenta de Anton.IA y tu sesión de LinkedIn. Algunas funciones dependen de los permisos, créditos y servicios habilitados en tu organización. El uso de funciones automatizadas en LinkedIn está sujeto a los términos de LinkedIn.
>
> Para comenzar, instala la extensión, abre el panel y conecta tu cuenta de Anton.IA.
>
> Anton.IA es un producto independiente y no está afiliado ni respaldado por LinkedIn.

### Otros campos

- Categoría: elegir la opción vigente que corresponda a productividad o herramientas de trabajo.
- Idioma principal: español.
- Web oficial: URL real y operativa.
- Soporte: correo o página real.
- Privacidad: página pública específica y actualizada.

### No inventar

No rellenar con:

- Correos de soporte ficticios.
- Números de usuarios inexistentes.
- Testimonios fabricados.
- Garantías de resultados.
- Afirmaciones de precisión no demostradas.

---

## 10. Imágenes y materiales

Preparar:

1. Icono de tienda con calidad suficiente.
2. Captura del perfil antes de enriquecer.
3. Captura de datos obtenidos.
4. Captura de investigación con fuentes.
5. Captura del editor de mensaje.
6. Material promocional que solicite el panel.

Como referencia habitual, Google ha utilizado:

- Icono de 128 × 128 px.
- Capturas de 1280 × 800 o 640 × 400 px.
- Imagen promocional pequeña de 440 × 280 px.

**La IA debe verificar tamaños, formatos y obligatoriedad en las instrucciones oficiales vigentes antes de producirlos.**

### Reglas para las capturas

- Mostrar la interfaz real de la versión subida.
- Usar datos de demostración claramente controlados.
- No mostrar emails privados, conversaciones reales ni información confidencial.
- No simular funcionalidades que no existen.
- No presentar “preparado” como “enviado”.
- Mantener textos legibles.

Revisar primero lo que ya existe en:

```text
chrome-extension/store-assets/
```

---

## 11. Política de privacidad

Hay una ruta prevista en la app:

```text
https://studio--leadflowai-3yjcy.us-central1.hosted.app/privacy/extension
```

**Comprobar que exista, sea pública y describa la versión actual.** No reutilizar automáticamente un texto antiguo.

### Debe explicar

1. Quién opera Anton.IA y cómo contactarlo.
2. Qué datos trata la extensión.
3. Qué acciones provocan su recopilación o transmisión.
4. Para qué se utilizan.
5. Qué información permanece temporalmente en el navegador.
6. Qué información se guarda en la cuenta y organización de Anton.IA.
7. Qué proveedores intervienen y para qué.
8. Plazos o criterios reales de conservación.
9. Cómo solicitar eliminación o ejercer derechos.
10. Cómo desconectar la extensión.
11. Qué ocurre al desinstalarla.
12. Fecha de actualización.

### Distinción importante

**Desinstalar la extensión no necesariamente elimina los leads ya guardados en Anton.IA.**

La política debe explicar el mecanismo real de eliminación. No prometer una eliminación automática que no esté implementada.

### IA y enriquecimiento

Revisar específicamente qué contexto se envía a:

- Proveedor de enriquecimiento.
- Proveedor de generación de texto.
- Servicios de investigación.

No afirmar que los proveedores “nunca entrenan con los datos” sin verificar las condiciones contractuales y configuraciones aplicables.

---

## 12. Completar los campos de privacidad de Google

Los nombres de los campos pueden cambiar. La IA debe leer las definiciones del formulario vigente.

### Propósito único propuesto

> Facilitar la prospección comercial contextual desde perfiles de LinkedIn, conectando la consulta de datos, investigación, guardado y preparación de mensajes con la cuenta del usuario en Anton.IA.

### Justificaciones de permisos

**`sidePanel`**

> Permite mostrar el espacio de trabajo de Anton.IA junto al perfil de LinkedIn, para revisar datos y preparar acciones sin abandonar la página.

**`storage`**

> Permite conservar temporalmente el vínculo autorizado con la app y los borradores del panel, separados por usuario, organización y perfil, según el almacenamiento de sesión implementado.

**`tabs` — solo si la auditoría confirma que debe mantenerse**

> Se utiliza para identificar la pestaña del perfil seleccionado y gestionar la pestaña de conexión autorizada con Anton.IA.

**Acceso a LinkedIn**

> Permite consultar la URL y el contexto del perfil abierto y preparar el texto de un mensaje solicitado explícitamente por el usuario en una conversación cuyo destinatario se comprueba.

**Acceso a los dominios de Anton.IA**

> Permite conectar la extensión con la sesión existente de la app y ejecutar las operaciones autorizadas de guardado, enriquecimiento, investigación y preparación de contenido.

### Categorías de datos

Evaluar conforme a las definiciones de Google:

- Información identificable: nombres, emails y datos profesionales.
- Contenido del sitio: datos visibles de perfiles.
- Comunicaciones personales: borradores o mensajes, según el tratamiento real.
- Actividad web: evaluar el uso de URLs de pestañas; no equiparar automáticamente una URL contextual con historial de navegación.
- Información de autenticación: comprobar el diseño real y la definición del formulario.

**No marcar todas las categorías por precaución ni desmarcarlas para facilitar la aprobación.** Declarar lo que corresponda al paquete y al servicio.

Las certificaciones de uso limitado y tratamiento de datos solo deben aceptarse si se cumplen realmente.

---

## 13. Instrucciones para el equipo revisor

Chrome Web Store tiene una sección específica para instrucciones de prueba y, cuando corresponde, credenciales.

### Preparación de la cuenta de revisión

- Cuenta dedicada de Anton.IA.
- Organización de demostración.
- Sin datos privados de clientes.
- Permisos suficientes.
- Créditos o capacidades necesarios para demostrar las funciones anunciadas.
- Disponibilidad durante toda la revisión.
- No depender exclusivamente de un SSO corporativo inaccesible para Google.

Las credenciales se introducen únicamente en el campo privado correspondiente del panel.

### Texto base en inglés

```text
Anton.IA is a contextual prospecting workspace for LinkedIn.

Account requirements:
An Anton.IA account is required to use the connected features.
Review credentials, if required, are provided separately in the private
credentials field.

Steps:
1. Install the extension and open its side panel.
2. Click "Conectar Anton.IA".
3. Sign in to the Anton.IA web application.
4. On the connection page, click "Conectar mi cuenta".
5. Keep this application tab open.
6. Open a supported LinkedIn profile at https://www.linkedin.com/in/...
   or enter a profile URL in the extension.
7. Click "Enriquecer perfil" to request professional data.
8. Review the result and click "Guardar lead".
9. Open "Investigación" to request research and inspect its sources.
10. Open "Contactar" to generate and edit a LinkedIn message.
11. "Copiar mensaje" copies the draft.
12. "Preparar en LinkedIn" attempts to place the draft in the matching
    conversation. The user reviews and sends it manually.
13. "Enviar automáticamente" opens a confirmation showing recipient and
    text (maximum 500 characters). After confirmation, the extension
    writes the message and sends it, and reports success only when
    LinkedIn displays the outgoing message. If the recipient cannot be
    confirmed, use the copy fallback instead.

LinkedIn messaging availability depends on the user's LinkedIn session
and the selected profile. If the extension cannot confirm the recipient
or access the composer, it offers a copy fallback.

The extension does not grant access to an Anton.IA account merely by
being installed.
```

Añadir instrucciones reales para campañas si se anuncian en la ficha.

**No facilitar cuentas de LinkedIn compartidas ni credenciales de terceros sin autorización.** Explicar la dependencia de una sesión de LinkedIn y las alternativas de prueba disponibles.

---

## 14. Subir y enviar a revisión

1. Entrar al Developer Dashboard.
2. Comprobar si ya existe una ficha de Anton.IA.
3. Si no existe, pulsar **Añadir nuevo elemento**.
4. Subir el ZIP validado.
5. Revisar que el nombre, versión y permisos sean correctos.
6. Completar:
   - Ficha de tienda.
   - Privacidad.
   - Distribución.
   - Instrucciones de prueba.
7. Elegir **Pública** para el lanzamiento (decisión registrada).
8. Seleccionar países o regiones donde se ofrecerá realmente el servicio.
9. Declarar correctamente si hay funciones que requieren un servicio de pago.
10. Resolver los avisos del panel.
11. Pedir al propietario que confirme el envío.
12. Pulsar **Enviar a revisión**.

### Instalación gratuita y servicio de pago

La extensión puede instalarse gratuitamente y requerir una cuenta o suscripción de Anton.IA. Hay que explicar esa condición y completar los campos comerciales conforme a lo que solicite Google.

### Publicación automática o diferida

Decisión registrada: **publicación automática** al aprobarse. Antes de enviar a revisión, comprobar que la app en producción ya incluye las API necesarias (`/api/extension/workspace`, `/extension/connect`, `/privacy/extension`), porque la versión quedará disponible de inmediato.

La documentación oficial consultada indica que una versión aprobada y retenida tiene un plazo de **30 días** para publicarse antes de volver a borrador. Verificar esa condición al ejecutar el proceso.

---

## 15. Si Google rechaza la extensión

1. Leer el motivo exacto y el identificador de la política.
2. Guardar el texto del rechazo sin publicar datos privados.
3. Relacionarlo con archivos y comportamientos concretos.
4. Corregir la causa.
5. Actualizar descripción, privacidad o instrucciones si están desalineadas.
6. Incrementar la versión si se modifica el paquete.
7. Repetir las pruebas afectadas.
8. Enviar nuevamente con una explicación breve y verificable.

### Ejemplos de causas a revisar

| Motivo | Qué comprobar |
|---|---|
| Permisos excesivos | Eliminar permisos y dominios no necesarios. |
| Propósito poco claro | Alinear funciones, ficha y uso real. |
| Datos no declarados | Corregir inventario y política de privacidad. |
| Revisor no puede entrar | Credenciales, SSO, permisos, créditos e instrucciones. |
| Código remoto | Dependencias, evaluación dinámica y respuestas del servidor. |
| Funcionalidad engañosa | Diferencias entre lo anunciado y lo que el usuario puede hacer. |
| Extensión rota | Errores del worker, DOM de LinkedIn, endpoints o autenticación. |

No crear fichas duplicadas para eludir un rechazo.

---

## 16. Después de la aprobación

### Verificación desde la tienda

1. Publicar la versión aprobada.
2. Instalarla desde la ficha en un perfil limpio de Chrome.
3. Repetir conexión y operaciones esenciales.
4. Verificar el ID definitivo de la extensión.
5. Guardar la URL de la ficha.
6. Añadir el enlace en Anton.IA.
7. Compartirlo primero con un grupo pequeño de usuarios.
8. Recoger errores y comprobar soporte.

### Migración de usuarios del ZIP

La extensión cargada manualmente puede tener un ID distinto al de tienda. La instalación de tienda no debe suponerse una actualización de la copia descomprimida.

Instrucciones recomendadas:

1. Copiar cualquier borrador local importante.
2. Desactivar o retirar la copia manual.
3. Instalar desde la tienda.
4. Conectar de nuevo la cuenta.
5. Comprobar que solo haya una copia activa.

Los leads guardados en el servidor deben seguir disponibles con la misma cuenta y organización. Los borradores temporales del navegador pueden no migrar.

---

## 17. Actualizaciones futuras

Para cada versión:

1. Modificar las fuentes.
2. Incrementar `version` en los manifests.
3. Compilar.
4. Ejecutar pruebas proporcionales al cambio.
5. Verificar compatibilidad con la app publicada.
6. Subir el ZIP a **la misma ficha**.
7. Actualizar permisos, privacidad y capturas si corresponde.
8. Enviar a revisión.
9. Publicar cuando esté aprobada.
10. Comprobar la instalación actualizada.

**No crear una ficha nueva por cada versión:** se perderían la continuidad del ID, las reseñas y el canal de actualización.

Las actualizaciones de tienda son automáticas normalmente, pero:

- No llegan necesariamente al mismo tiempo a todos los equipos.
- Nuevos permisos pueden exigir aceptación.
- Debe mantenerse compatibilidad temporal con versiones anteriores.

### Regla de compatibilidad

Si la nueva extensión requiere cambios de backend:

> Publicar primero un backend compatible con la versión anterior y la nueva; después distribuir la extensión.

---

## 18. Publicación automática y distribución empresarial

### Automatización

Después de estabilizar la publicación manual, se puede usar la API oficial de Chrome Web Store.

Requiere revisar:

- API vigente, actualmente con documentación V2.
- Identidad y permisos del publicador.
- Autenticación admitida.
- Secretos de CI.
- Separación entre subir, enviar a revisión y publicar.
- Consulta del estado.

No guardar tokens de publicación en el repositorio ni saltarse la revisión de Google.

### GrupoExpro u otras empresas

Con Chrome administrado, TI puede distribuir la extensión mediante políticas corporativas.

Necesitará:

- ID de la extensión.
- Ficha publicada.
- Unidades organizativas o grupos de destino.
- Decidir instalación opcional, permitida o forzada.
- Piloto y soporte.

La publicación pública permite además que cualquier usuario la encuentre e instale desde la tienda.

### Microsoft Edge

La distribución por Microsoft Edge Add-ons es un proceso separado. Aunque Edge puede permitir instalaciones desde Chrome Web Store, no se debe anunciar compatibilidad completa sin comprobar el panel lateral, los permisos y el flujo real en Edge.

---

## 19. Criterios de finalización

La IA debe entregar:

- [ ] Propietario/publicador identificado.
- [ ] Versión e ID de extensión registrados.
- [ ] ZIP inspeccionado y probado.
- [ ] Decisión documentada sobre el flujo histórico de envío.
- [ ] Permisos mínimos justificados.
- [ ] Política de privacidad pública y coherente.
- [ ] Ficha y capturas completas.
- [ ] Instrucciones de revisión funcionales.
- [ ] Estado exacto: borrador, en revisión, aprobado o publicado.
- [ ] URL de Chrome Web Store, cuando exista.
- [ ] Prueba de instalación desde la tienda.
- [ ] Instrucciones de migración desde ZIP.
- [ ] Procedimiento de actualización futura.

**No dar por terminado con “ZIP subido”.** Subido, enviado a revisión, aprobado y publicado son estados distintos.

---

## 20. Prompt para entregar a otra IA

Copia lo siguiente junto con este manual:

```text
Necesito que me ayudes a publicar la extensión de Anton.IA en Chrome
Web Store como PÚBLICA, con publicación automática al aprobarse.

Repositorio:
C:\Users\nicol\Desktop\ANTON.IA

Fuentes de la extensión:
chrome-extension/ui/panel.tsx
chrome-extension/ui/panel.css

Manifest de distribución:
chrome-extension/manifest.release.json

Versión de tienda preparada: 4.0.4.

App:
https://studio--leadflowai-3yjcy.us-central1.hosted.app

Decisiones ya registradas:
- La versión final INCLUYE envío automático de mensajes LinkedIn,
  solo tras confirmación explícita en el panel (destinatario
  verificado, máximo 500 caracteres, registro como enviado solo si
  LinkedIn muestra el mensaje). Implementado en 4.0.4.
- Visibilidad: pública. Publicación: automática al aprobarse.

Lee el manual adjunto, AGENTS.md y la documentación del repositorio.
Consulta también la documentación oficial vigente de Chrome Web Store.

Tu tarea:
1. Revisar el estado actual sin sobrescribir cambios del usuario.
2. Confirmar versión, paquete, permisos, autenticación y funcionalidades.
3. Verificar que la ficha, la política de privacidad
   (/privacy/extension), las justificaciones
   (chrome-extension/STORE_JUSTIFICATIONS.md) y las instrucciones de
   revisión describen con precisión el envío automático con
   confirmación. No describas el paquete de forma falsa.
4. Inventariar los datos transmitidos y almacenados, incluidos los enviados
   a proveedores de enriquecimiento, investigación e IA.
5. Preparar un ZIP de distribución limpio y probarlo.
6. Preparar ficha, propósito único, justificaciones de permisos,
   declaraciones de privacidad, capturas e instrucciones para revisión.
7. Guiarme en la creación/configuración de la cuenta de desarrollador.
8. Ayudarme a subir el paquete y completar los formularios.
9. Pedir mi confirmación antes de enviar a revisión o publicar.
10. Verificar el estado real y entregarme la URL de tienda cuando exista.
11. Explicar cómo migrar a los usuarios que instalaron el ZIP y cómo
    publicar futuras actualizaciones en la misma ficha.

Restricciones:
- Usa Node 22.
- No guardes credenciales ni tokens en el repositorio.
- Yo completaré personalmente login de Google, 2FA, pagos e identidad.
- No inventes datos legales, correos de soporte o declaraciones de privacidad.
- No prometas aprobación ni plazos.
- No uses branding de Apollo ni afirmes afiliación con LinkedIn.
- No hagas commits, pushes, migraciones o despliegues sin autorización.
- Si necesitas desplegar la app, revisa primero el alcance completo:
  hubo incidentes de despliegues parciales que eliminaron funciones.
- No ejecutes envíos reales ni consumas créditos durante pruebas sin
  autorización explícita.
- No confundas un ZIP disponible con una publicación aprobada en la tienda.
- Conserva el diseño del usuario en las fuentes, no solo en dist.

Comienza entregando:
A. Qué está listo.
B. Qué falta.
C. Qué decisiones o datos necesitas de mí.
D. Los pasos que puedes completar sin mi intervención.
```

---

## 21. Fuentes oficiales

La IA debe volver a consultarlas al ejecutar el manual:

- [Publicar en Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Registrar la cuenta de desarrollador](https://developer.chrome.com/docs/webstore/register)
- [Configurar la cuenta](https://developer.chrome.com/docs/webstore/set-up-account)
- [Preparar la extensión](https://developer.chrome.com/docs/webstore/prepare)
- [Completar la ficha](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Completar privacidad](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Distribución y visibilidad](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Instrucciones de prueba](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
- [Requisitos de imágenes](https://developer.chrome.com/docs/webstore/images)
- [Políticas del programa](https://developer.chrome.com/docs/webstore/program-policies)
- [Proceso de revisión](https://developer.chrome.com/docs/webstore/review-process)
- [Actualizar una extensión](https://developer.chrome.com/docs/webstore/update)
- [Propiedad compartida](https://developer.chrome.com/docs/webstore/share-ownership)
- [Publicación mediante API](https://developer.chrome.com/docs/webstore/using-api)
- [Opciones empresariales](https://developer.chrome.com/docs/webstore/cws-enterprise)
