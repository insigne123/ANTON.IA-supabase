// src/lib/client-id.ts
// Identidad ligera para cuotas cuando no hay login real.
// Persiste en localStorage y se usa en headers "x-user-id" hacia el backend.

const KEY = "lf_client_id";

function genId(): string {
  // RFC4122 v4 si está disponible; fallback simple.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return "anon_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && saved.length > 0) return saved;
    const id = genId();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Si localStorage no está disponible, devolvemos un id efímero
    return genId();
  }
}
