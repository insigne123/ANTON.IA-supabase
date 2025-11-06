'use client';

import { useEffect, useState } from 'react';
import { googleAuthService } from '@/lib/google-auth-service';

export default function GmailConnectPage() {
  const [connected, setConnected] = useState<boolean>(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = googleAuthService.getSession();
    setConnected(!!s?.accessToken);
    setEmail(s?.email ?? null);
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await googleAuthService.login({ withReadScope: false });
      setConnected(true);
      setEmail(profile.email ?? null);
    } catch (e: any) {
      console.error('[gmail/connect] error', e);
      const dbg = googleAuthService.debugAuthConfig();
      setError(
        (e?.message || 'Fallo al conectar con Google') +
          ` · origin=${dbg.origin} · clientIdPresent=${dbg.clientIdPresent}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    googleAuthService.logout();
    setConnected(false);
    setEmail(null);
  };

  const handleUpgradeRead = async () => {
    setLoading(true);
    setError(null);
    try {
      await googleAuthService.upgradeToReadScope();
      alert('Permiso de lectura habilitado (gmail.readonly).');
    } catch (e: any) {
      console.error('[gmail/upgrade] error', e);
      setError(e?.message ?? 'No se pudo solicitar gmail.readonly');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Conectar con Gmail</h1>
      <div className="rounded-xl border p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Estado: {connected ? 'Conectado' : 'Desconectado'}
          {email ? ` — ${email}` : ''}
        </p>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex gap-2">
          {!connected ? (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="px-3 py-2 rounded-lg border hover:bg-accent"
              aria-busy={loading}
            >
              {loading ? 'Conectando…' : 'Conectar con Google'}
            </button>
          ) : (
            <>
              <button
                onClick={handleDisconnect}
                className="px-3 py-2 rounded-lg border hover:bg-accent"
              >
                Desconectar
              </button>
              <button
                onClick={handleUpgradeRead}
                className="px-3 py-2 rounded-lg border hover:bg-accent"
              >
                Activar seguimiento (leer respuestas)
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          La app no guarda tu contraseña. Usa OAuth 2.0 y tokens efímeros.
        </p>
      </div>
    </main>
  );
}
