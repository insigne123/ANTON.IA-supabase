export function restoreProfileEdits(server: any, cached: any) {
  if (!cached?.dirty || !cached.profile) return { profile: server, conflict: false };
  if (server && cached.baseUpdatedAt !== server.updated_at) return { profile: server, conflict: true };
  return { profile: cached.profile, conflict: false, restored: true };
}
