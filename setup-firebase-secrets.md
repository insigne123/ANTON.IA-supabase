# 🔐 Configurar Secretos de Firebase para ANTON.IA

## 📋 Secretos Necesarios

Necesitas configurar estos secretos en Firebase Secret Manager:

1. **ANTONIA_TICK_SECRET**: valor aleatorio unico de al menos 32 bytes.
2. **TRACKING_WEBHOOK_SECRET**: valor aleatorio distinto de `ANTONIA_TICK_SECRET`.
3. **TRACKING_TOKEN_SECRET**: valor aleatorio distinto para firmar pixels y enlaces de correo.

## 🚀 Opción 1: Usando Firebase CLI (Recomendado)

### Paso 1: Instalar Firebase CLI (si no lo tienes)

```powershell
npm install -g firebase-tools
```

### Paso 2: Login a Firebase

```powershell
firebase login
```

### Paso 3: Seleccionar tu proyecto

```powershell
firebase use leadflowai-3yjcy
```

### Paso 4: Crear los secretos

```powershell
# Genera cada valor una sola vez, guárdalo en un gestor de secretos y no lo imprimas.
openssl rand -hex 32 | firebase functions:secrets:set ANTONIA_TICK_SECRET
openssl rand -hex 32 | firebase functions:secrets:set TRACKING_WEBHOOK_SECRET
openssl rand -hex 32 | firebase functions:secrets:set TRACKING_TOKEN_SECRET
```

## 🌐 Opción 2: Usando la Consola de Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Selecciona tu proyecto: **leadflowai-3yjcy**
3. Ve a **Build** → **Functions** → **Secrets** (o busca "Secret Manager" en la barra de búsqueda)
4. Haz clic en **Create Secret**
5. Crea cada secreto:
   - **Nombre:** `ANTONIA_TICK_SECRET`
    - **Valor:** genera un valor aleatorio de al menos 32 bytes.
   - Haz clic en **Create**
6. Repite para `TRACKING_WEBHOOK_SECRET`

## ✅ Verificar que los secretos están configurados

```powershell
firebase functions:secrets:access ANTONIA_TICK_SECRET
firebase functions:secrets:access TRACKING_WEBHOOK_SECRET
firebase functions:secrets:access TRACKING_TOKEN_SECRET
```

## 📝 Notas Importantes

- Si un secreto fue incluido previamente en documentación, trátalo como comprometido y rótalo antes de desplegar.
- ✅ Los secretos en `apphosting.yaml` usan `secret:` para referenciar estos valores de Secret Manager
- ✅ Tu `.env.local` ya tiene estos valores configurados para desarrollo local
- 🔄 Después de crear los secretos, necesitarás redesplegar tu aplicación

## 🔄 Redesplegar la Aplicación

Después de configurar los secretos:

```powershell
firebase deploy --only apphosting -P leadflowai-3yjcy
```

O si usas Firebase App Hosting, el próximo deploy automáticamente usará los secretos configurados.
