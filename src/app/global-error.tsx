'use client';

import { useEffect } from 'react';

/** Last resort, when even the root layout fails: plain HTML, no providers, the same message in Spanish. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16, textAlign: 'center' }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20 }}>La aplicación no se pudo cargar</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>Vuelve a intentarlo en unos segundos. Si se repite, escríbenos con la hora en que pasó.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', cursor: 'pointer', font: 'inherit' }}>Reintentar</button>
        </div>
      </body>
    </html>
  );
}
