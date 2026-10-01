/**
 * Auth identities of one organization's members, read one by one. The panel used to call `listUsers`, which pages
 * through every account on the platform (and stopped at 1.000); this reads only the people the organization has.
 */
export async function loadMemberIdentities(
  supabase: any,
  userIds: string[],
): Promise<{ data: { users: any[] } | null; error: unknown }> {
  const ids = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const users: any[] = [];
  for (let index = 0; index < ids.length; index += 10) {
    const results = await Promise.all(ids.slice(index, index + 10).map((id) => supabase.auth.admin.getUserById(id)));
    for (const result of results) {
      // A membership whose account was deleted is not a failure: that person just has no identity to show.
      if (result?.error && Number(result.error.status) !== 404) return { data: null, error: result.error };
      if (result?.data?.user) users.push(result.data.user);
    }
  }
  return { data: { users }, error: null };
}
