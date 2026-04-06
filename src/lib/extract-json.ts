// Extrae JSON desde un string que podría venir envuelto en un bloque con "tres backticks".
// Evitamos escribir la secuencia de backticks literal en el source.
export function extractJsonFromMaybeFenced(raw: any): any | null {
  if (raw == null) return null;
  try {
    let s = String(raw).trim();

    // Construimos el backtick en runtime para no tenerlo literal en el source.
    const BT = String.fromCharCode(96); // carácter `
    const fence = BT + BT + BT;         // tres backticks

    const first = s.indexOf(fence);
    if (first >= 0) {
      // saltamos opcionalmente el idioma (ej: json) hasta el salto de línea
      let after = s.slice(first + fence.length);
      const nl = after.indexOf('\n');
      if (nl >= 0) after = after.slice(nl + 1);
      const second = after.indexOf(fence);
      s = second >= 0 ? after.slice(0, second) : after;
    }

    s = s.trim();
    return JSON.parse(s);
  } catch {
    return null;
  }
}
