# 🔐 Configurar Secretos de Firebase para ANTON.IA

## 📋 Secretos Necesarios

Necesitas configurar estos secretos en Firebase Secret Manager:

1. **ANTONIA_TICK_SECRET** = `78717871`
2. **TRACKING_WEBHOOK_SECRET** = `78717871`

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
# Crear ANTONIA_TICK_SECRET
echo "78717871" | firebase functions:secrets:set ANTONIA_TICK_SECRET

# Crear TRACKING_WEBHOOK_SECRET
echo "78717871" | firebase functions:secrets:set TRACKING_WEBHOOK_SECRET
```

## 🌐 Opción 2: Usando la Consola de Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Selecciona tu proyecto: **leadflowai-3yjcy**
3. Ve a **Build** → **Functions** → **Secrets** (o busca "Secret Manager" en la barra de búsqueda)
4. Haz clic en **Create Secret**
5. Crea cada secreto:
   - **Nombre:** `ANTONIA_TICK_SECRET`
   - **Valor:** `78717871`
   - Haz clic en **Create**
6. Repite para `TRACKING_WEBHOOK_SECRET`

## ✅ Verificar que los secretos están configurados

```powershell
firebase functions:secrets:access ANTONIA_TICK_SECRET
firebase functions:secrets:access TRACKING_WEBHOOK_SECRET
```

## 📝 Notas Importantes

- ⚠️ **El valor `78717871` es solo para desarrollo/testing**. En producción deberías usar un token más seguro.
- ✅ Los secretos en `apphosting.yaml` usan `secret:` para referenciar estos valores de Secret Manager
- ✅ Tu `.env.local` ya tiene estos valores configurados para desarrollo local
- 🔄 Después de crear los secretos, necesitarás redesplegar tu aplicación

## 🔄 Redesplegar la Aplicación

Después de configurar los secretos:

```powershell
firebase deploy --only hosting
```

O si usas Firebase App Hosting, el próximo deploy automáticamente usará los secretos configurados.
