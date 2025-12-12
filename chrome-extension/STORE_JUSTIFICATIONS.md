# Respuestas para la Ficha de la Chrome Web Store

Copia y pega estas justificaciones en la pestaña "Prácticas de privacidad" (Privacy Practices).

## 1. Justificación de Permisos (Permissions)

### **activeTab**
Permite que la extensión interactúe con la página actual (LinkedIn) solo cuando la automatización es activada explícitamente por el usuario desde la aplicación principal, garantizando que no se monitoree la actividad general de navegación.

### **scripting**
Es necesario para inyectar el script de contenido (`content.js`) que realiza la tarea de automatización solicitada por el usuario: escribir el borrador del mensaje en el chat de LinkedIn.

### **storage**
Se utiliza estrictamente para almacenar configuraciones locales del usuario y el estado temporal de los mensajes en cola. No se suben datos personales a servidores externos a través de este permiso.

### **tabs**
Necesario para gestionar la navegación: detectar si ya existe una pestaña de LinkedIn abierta para reusarla (activarla) en lugar de abrir múltiples pestañas, mejorando la experiencia del usuario.

### **Host Permissions (Permisos de Host)**
Necesario para `https://www.linkedin.com/*` donde se ejecuta la acción de mensajería, y para comunicarse con la aplicación web de origen (`localhost` o dominio de Anton.IA) mediante `externally_connectable` para recibir las instrucciones de envío.

---

## 2. Uso de Datos (Data Usage)

Debes marcar las casillas correspondientes. Generalmente:
*   **¿La extensión recolecta datos del usuario?**: NO (si solo es local y no tienes analítica propia en la extensión).
*   Si te obliga a marcar algo por usar `storage`, marca que se usa para "Funcionalidad de la aplicación" (App Functionality).

## 3. Código Remoto (Remote Code)
La extensión **NO** utiliza código remoto (todo está empaquetado en el ZIP). Debes certificar que no usas código remoto (fetch de JS externo).

## 4. Captura de Pantalla
*   Toma un "pantallazo" (screenshot) de tu navegador con la extensión instalada o simplemente una captura de LinkedIn donde se vea funcionando.
*   Súbela en el apartado de "Imágenes".
