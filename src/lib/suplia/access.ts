export function resolveSupliaEnabled({
  configuredValue,
  nodeEnv,
}: {
  configuredValue?: string;
  nodeEnv?: string;
}) {
  const configured = String(configuredValue || '').trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  return nodeEnv === 'development';
}

export function isSupliaEnabled() {
  return resolveSupliaEnabled({
    configuredValue: process.env.NEXT_PUBLIC_SUPLIA_ENABLED,
    nodeEnv: process.env.NODE_ENV,
  });
}
