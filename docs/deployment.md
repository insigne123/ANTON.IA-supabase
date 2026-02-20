# Guía de despliegue y pruebas

## Variables de entorno imprescindibles

### Firebase (cliente)
Configura las credenciales públicas que usa el SDK web:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_RECAPTCHA_V3_KEY` (opcional si se activa App Check)

### Firebase Admin
Para las funciones que consumen Firestore en el backend asegúrate de exportar una cuenta de servicio y apunta `GOOGLE_APPLICATION_CREDENTIALS` al archivo JSON correspondiente. Cuando ejecutes pruebas o desarrollo local con el emulador, define `FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"`.

### Integraciones adicionales
- `N8N_LEADS_WEBHOOK_URL`, `LEADS_N8N_TIMEOUT_MS`, `LEADS_N8N_MAX_RETRIES`
- `APIFY_TOKEN`, `APIFY_APOLLO_ACTOR_ID`, `APIFY_APOLLO_TASK_ID`, `APIFY_ACTOR_ID`, `APOLLO_API_KEY`
- `N8N_API_KEY`, `N8N_RESEARCH_WEBHOOK_URL`, `N8N_WEBHOOK_URL`
- `ANYMAIL_FINDER_API_KEY`, `QUOTA_FALLBACK_SECRET`
- `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`, `NEXT_PUBLIC_AZURE_AD_TENANT_ID`, `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_SEARCH_POLL_INTERVAL_MS`, `NEXT_PUBLIC_SEARCH_MAX_POLL_MINUTES`, `NEXT_PUBLIC_SEARCH_PAGE_SIZE`
- `INTERNAL_API_SECRET` (protege llamadas server-to-server con `x-user-id`; usar el mismo valor en Next y Firebase Functions)
- `OPENCLAW_ORG_ID`, `OPENCLAW_API_KEY` (o `OPENCLAW_API_KEYS`), `OPENCLAW_TOKEN_SECRET`, `OPENCLAW_TOKEN_TTL_SECONDS`, `OPENCLAW_SCOPES`

Consulta `.env.example` para un inventario completo con valores de referencia.

Para el onboarding de OpenClaw (single org), revisa `docs/openclaw-credentials-and-setup.md`.

## Pruebas manuales
Los siguientes escenarios se ejecutan tras cada despliegue mayor. Se documentan aquí los pasos y observaciones necesarias; si el entorno no está disponible (por ejemplo, en este contenedor) marca el resultado como bloqueado e indica la causa.

| Prueba | Pasos resumidos | Resultado | Observaciones |
| --- | --- | --- | --- |
| Registro | 1. Abrir la app en modo incógnito. 2. Completar formulario de alta y confirmar correo. 3. Validar creación en Firestore. | Bloqueada | Requiere credenciales de Firebase Auth y dominio configurado. |
| Login | 1. Abrir sesión en navegador primario. 2. Autenticarse con Azure AD/Google. 3. Confirmar acceso a panel principal. | Bloqueada | No se dispone de proveedores OAuth configurados en este entorno. |
| Migración de datos | 1. Ejecutar proceso de migración (n8n/apify). 2. Revisar logs de sincronización. 3. Validar métricas en Firestore. | Bloqueada | No hay conectividad a n8n/Apify desde el contenedor. |
| Sincronización multi-navegador | 1. Abrir sesión en dos navegadores. 2. Lanzar sincronización en uno. 3. Confirmar actualización en el otro. | Bloqueada | Requiere despliegue con hosting público para verificar websockets. |

> **Nota:** Actualiza la columna de resultado cuando ejecutes las pruebas en un entorno con credenciales válidas.
