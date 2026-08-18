# 🔧 Solución: Configurar Permisos de antoniaTickHttp

## ❌ Problema

Tu organización tiene una política que impide hacer funciones públicas con `allUsers`. El error fue:

```
ERROR: One or more users named in the policy do not belong to a permitted customer, 
perhaps due to an organization policy.
```

## ✅ Solución

La función `antoniaTickHttp` **ya tiene autenticación implementada** con `ANTONIA_TICK_SECRET`, así que no necesita ser pública. Solo necesita permitir invocaciones autenticadas.

### Opción 1: Permitir invocaciones de tu cuenta de servicio

Ejecuta este comando en tu terminal de Firebase:

```bash
gcloud functions add-invoker-policy-binding antoniaTickHttp \
  --region=us-central1 \
  --member=serviceAccount:1083965020353-compute@developer.gserviceaccount.com
```

### Opción 2: Permitir invocaciones de cualquier usuario autenticado

```bash
gcloud functions add-invoker-policy-binding antoniaTickHttp \
  --region=us-central1 \
  --member=allAuthenticatedUsers
```

### Opción 3: Usar la Consola de Google Cloud (Más fácil)

1. Ve a: https://console.cloud.google.com/functions/details/us-central1/antoniaTickHttp?project=leadflowai-3yjcy

2. Ve a la pestaña **PERMISSIONS**

3. Haz clic en **+ GRANT ACCESS**

4. Configura:
   - **New principals:** `1083965020353-compute@developer.gserviceaccount.com`
   - **Role:** `Cloud Run Invoker`
   - Haz clic en **SAVE**

## 🔐 Cómo funciona la autenticación

La función ya valida el secreto en el código (líneas 2561-2569 de `functions/index.ts`):

```typescript
const secret = process.env.ANTONIA_TICK_SECRET;
const authHeader = req.get('authorization') || '';
const bearer = authHeader.replace(/^Bearer\s+/i, '');
const headerSecret = req.get('x-cron-secret') || '';

if (!secret || (bearer !== secret && headerSecret !== secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
}
```

Acepta el secreto de dos formas:
1. **Header `Authorization: Bearer $ANTONIA_TICK_SECRET`**
2. **Header `x-cron-secret: $ANTONIA_TICK_SECRET`**

## ✅ Verificar que funcionó

Después de configurar los permisos, prueba la función:

```bash
curl -H "x-cron-secret: $ANTONIA_TICK_SECRET" \
  https://us-central1-leadflowai-3yjcy.cloudfunctions.net/antoniaTickHttp
```

Deberías recibir: `{"ok":true}`

## 📝 Nota

Mientras `antoniaTickHttp` use `invoker: 'public'`, el secreto es una defensa adicional, no una política IAM. Migra el invocador a una cuenta de servicio/OIDC antes de tratar este endpoint como privado.
