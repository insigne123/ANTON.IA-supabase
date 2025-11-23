// Inicialización de Firebase (cliente)
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getAuth, signInAnonymously, type Auth, onAuthStateChanged } from 'firebase/auth';
// (Opcional si usas App Check) import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

let app: FirebaseApp | undefined;
let storage: FirebaseStorage | undefined;
let _authInstance: Auth | undefined;

function assertEnv(name: string, val: string | undefined) {
  if (!val) throw new Error(`[firebase] Falta variable: ${name}`);
}

export function getFirebaseApp(): FirebaseApp {
  if (!getApps().length) {
    assertEnv('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
    assertEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
    assertEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    assertEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    assertEnv('NEXT_PUBLIC_FIREBASE_APP_ID', process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
    app = initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    });
    // (Opcional App Check: si lo tienes en Enforced, descomenta e incluye tu key)
    // initializeAppCheck(app, { provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_V3_KEY!) });
  }
  app = getApps()[0];
  return app!;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(getFirebaseApp());
  }
  return storage;
}

export function getFirebaseAuth(): Auth {
  if (!_authInstance) _authInstance = getAuth(getFirebaseApp());
  return _authInstance!;
}

export async function ensureSignedInAnonymously(): Promise<string> {
  const a = getFirebaseAuth();
  const current = a.currentUser;
  if (current?.uid) return current.uid;
  await signInAnonymously(a);
  return new Promise<string>((resolve) => {
    const unsub = onAuthStateChanged(a, (u) => {
      if (u?.uid) { unsub(); resolve(u.uid); }
    });
  });
}

// Export for compatibility with existing code
export const auth = getFirebaseAuth();
