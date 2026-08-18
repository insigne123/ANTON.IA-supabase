const OPEN_MARK = '<<<CONTENIDO_EXTERNO';
const CLOSE_MARK = '<<<FIN_CONTENIDO_EXTERNO>>>';

const EXTERNAL_CONTENT_TOOLS = [
  /^gmail\./,
  /^research\./,
  /^replies\./,
  /^reply\./,
  /^thread\./,
];

export function isExternalContentGuardEnabled() {
  return String(process.env.SUPLIA_EXTERNAL_CONTENT_GUARD ?? 'true').toLowerCase() !== 'false';
}

export function isExternalContentTool(toolName: string) {
  return EXTERNAL_CONTENT_TOOLS.some((pattern) => pattern.test(toolName));
}

export function wrapExternalContent(text: string, source: string) {
  if (!isExternalContentGuardEnabled()) return text;

  const sanitized = String(text || '')
    .split(OPEN_MARK).join('<<CONTENIDO-EXTERNO')
    .split(CLOSE_MARK).join('<<FIN-CONTENIDO-EXTERNO>>');

  return [
    `${OPEN_MARK} fuente="${String(source || 'desconocida').replace(/"/g, '')}">>>`,
    sanitized,
    CLOSE_MARK,
  ].join('\n');
}
