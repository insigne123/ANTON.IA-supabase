// src/lib/server/firebase-admin.ts
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

let _app: admin.app.App | null = null;
let overrideDb: Firestore | null = null;

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

function getFirestore(): Firestore {
  return overrideDb ?? getAdminApp().firestore();
}

export function setAdminDbForTests(db: Firestore | null) {
  overrideDb = db;
}

export const adminDb = () => getFirestore();

export const db = new Proxy({} as Firestore, {
  get(_target, prop, receiver) {
    const target = getFirestore() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
}) as Firestore;

