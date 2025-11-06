// Parseo robusto para respuestas no-JSON (HTML, texto, etc.)
// Evita SyntaxError: Unexpected token '<' al intentar res.json().

export type SafeJson = { ok: boolean; status: number; data?: any; text?: string };

export async function parseJsonResponse(r: Response): Promise<SafeJson> {
  try {
    const ct = r.headers.get('content-type')?.toLowerCase() || '';
    // Si no parece JSON, leer como texto directamente
    if (!ct.includes('application/json')) {
      const text = await r.text().catch(() => '');
      return { ok: r.ok, status: r.status, text: text.slice(0, 2000) };
    }
    const data = await r.clone().json();
    return { ok: r.ok, status: r.status, data };
  } catch {
    const text = await r.text().catch(() => '');
    return { ok: r.ok, status: r.status, text: text.slice(0, 2000) };
  }
}
