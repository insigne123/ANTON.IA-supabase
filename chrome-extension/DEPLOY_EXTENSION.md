# Guía de Publicación de Extensión Anton.IA

Esta carpeta contiene todo lo necesario para publicar la extensión en la Chrome Web Store.

## 1. Preparar el Paquete
1. Asegúrate de que el archivo `icon.png` está en esta carpeta.
2. Selecciona **todos los archivos** dentro de la carpeta `chrome-extension` (manifest.json, background.js, content.js, web_injector.js, popup.html, icon.png).
3. Haz clic derecho -> **Enviar a** -> **Carpeta comprimida (en zip)**.
4. Nombra al archivo `antonia-extension-v1.zip`.

> **IMPORTANTE**: No comprimas la carpeta `chrome-extension` desde fuera. Debes entrar, seleccionar los archivos y comprimirlos, para que el `manifest.json` quede en la raíz del ZIP.

## 2. Configurar Cuenta de Desarrollador
Si aún no tienes cuenta:
1. Ve a [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
2. Regístrate con tu cuenta de Google.
3. Paga la tarifa única de registro ($5 USD).

## 3. Subir la Extensión
1. En el Dashboard, haz clic en **"Nuevo elemento"** (New Item).
2. Sube el archivo `antonia-extension-v1.zip` que creaste.
3. Se abrirá el formulario de la ficha de la tienda.

## 4. Rellenar Información
*   **Nombre**: Anton.IA Automation (Ya vendrá del manifest)
*   **Descripción**: Automatización segura de LinkedIn para Anton.IA.
*   **Categoría**: Productividad / Flujo de trabajo.
*   **Icono**: Sube el mismo `icon.png` (debe ser 128x128 para la tienda, Chrome te avisará si necesita ajustes, pero usualmente acepta escalado automático o te pedirá otro tamaño).
*   **Capturas de pantalla**: Sube al menos una captura (puedes tomar un screenshot de LinkedIn abriéndose con el modal de Anton.IA).

## 5. Privacidad y Visibilidad (Clave)
*   **Visibilidad**:
    *   **Público**: Cualquiera la encuentra.
    *   **No listado (Unlisted)**: *RECOMENDADO PARA INICIO*. Solo usuarios con el link pueden instalarla. No aparece en busquedas.
    *   **Privado**: Solo para emails de tu dominio (requiere configuración extra). 
    
    *Te sugiero "No listado" para compartir el link con tus usuarios fácilmente sin esperar revisiones largas.*

*   **Política de Privacidad**: Debes poner un link a tu política de privacidad si recolectas datos. Como la extensión usa `storage` y `tabs`, Google podría pedir justificación.
    *   *Justificación*: "La extensión solo almacena temporalmente el estado de la automatización y no recolecta datos personales del usuario fuera de lo necesario para la función de mensaje directo solicitada explícitamente."

## 6. Publicar
1. Dale a "Enviar a revisión".
2. La revisión para "No listado" suele ser rápida (horas o pocos días).
3. Una vez aprobada, copia el **Link de la tienda** y envíaselo a tus usuarios.
