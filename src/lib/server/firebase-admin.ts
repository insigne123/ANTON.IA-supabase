// src/lib/server/firebase-admin.ts
import * as admin from 'firebase-admin';

let _app: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (_app) return _app;

  if (!admin.apps.length) {
    // Usa Application Default Credentials (ADC):
    // GOOGLE_APPLICATION_CREDENTIALS="/ruta/abs/service-account.json"
    _app = admin.initializeApp();
  } else {
    _app = admin.app();
  }
  return _app!;
}

export const adminDb = () => getAdminApp().firestore();