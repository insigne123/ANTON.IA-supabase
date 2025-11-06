# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Búsqueda de Leads

La búsqueda de leads utiliza un webhook de n8n para orquestar la obtención de datos desde Apollo.io.

### Configuración (n8n - por defecto)

1.  Crea o usa un workflow de n8n que acepte un `POST` con los filtros de búsqueda.
2.  El workflow debe realizar la búsqueda en Apollo y devolver un JSON con la estructura `{ count: number, leads: Lead[] }`.
3.  Copia la URL del webhook de producción de n8n.
4.  Crea un archivo `.env` en la raíz del proyecto y añade la siguiente línea:

```
N8N_LEADS_WEBHOOK_URL="https://tu-workflow.n8n.cloud/webhook/..."
```

Opcionalmente, puedes configurar el timeout y los reintentos:
```
LEADS_N8N_TIMEOUT_MS=60000
LEADS_N8N_MAX_RETRIES=2
```

### Configuración (Apify - Legacy)

Para usar el flujo antiguo basado en Apify (no recomendado):

1.  Establece la variable de entorno `USE_APIFY="true"`.
2.  Ve a tu [Consola de Apify](https://console.apify.com/).
3.  Navega a `Settings` > `Integrations`.
  4.  Copia tu `Personal API token`.
5.  Añade la siguiente línea a tu archivo `.env`:

```
APIFY_TOKEN=tu_token_de_apify
```

**Importante**: El endpoint unificado `/api/leads/search` ahora redirige (307) a `/api/leads/apify` si `USE_APIFY` está activo. El flujo de Apify sigue siendo asíncrono y depende de polling.
