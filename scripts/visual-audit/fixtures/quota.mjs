// Credits and daily quotas: the same answer for every resource, well below the limit, so no page shows a «sin cupo» state
// unless a scenario asks for it with /__fault.
export default function quota(ctx) {
  const status = args => ({ allowed: true, count: 12, limit: 50, mode: 'user', binding: 'user', day_key: ctx.today, resource: args?.p_resource || args?.resource || null });
  return { tables: {}, rpc: { get_antonia_credit_status_v2: status } };
}
