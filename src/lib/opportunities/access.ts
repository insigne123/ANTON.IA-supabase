export function resolveOpportunitiesEnabled(configuredValue?: string) {
  return String(configuredValue || '').trim().toLowerCase() === 'true';
}

export function isOpportunitiesEnabled() {
  return resolveOpportunitiesEnabled(process.env.NEXT_PUBLIC_OPPORTUNITIES_ENABLED);
}
