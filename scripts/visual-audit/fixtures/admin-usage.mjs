// «Uso, resultados y créditos» (Administración): the report the server builds from admin_usage_report_v1 and the names it reads
// with admin_usage_member_names_v1. Without them the fake answers `null` and the page can only show «No pudimos abrir el
// informe», so the screen was never looked at. Two people with a plausible fortnight: visits, work, credits, replies, pending.
const day = iso => iso.slice(0, 10);

export default function adminUsage(ctx) {
  const fact = (userId, daysAgo, module, kind, count, extra = {}) => {
    const at = ctx.daysAgo(daysAgo);
    return { organizationId: ctx.ORG, userId, groupId: null, day: day(at), module, kind, status: 'recorded', actor: 'user', count, firstAt: at, lastAt: at, ...extra };
  };
  const facts = [
    fact(ctx.OWNER, 1, 'home', 'module_opened', 4, { status: 'observed' }),
    fact(ctx.OWNER, 1, 'search', 'module_opened', 3, { status: 'observed' }),
    fact(ctx.OWNER, 1, 'contacts', 'contact_saved', 6),
    fact(ctx.OWNER, 2, 'research', 'research_completed', 4),
    fact(ctx.OWNER, 2, 'email', 'draft_prepared', 4),
    fact(ctx.OWNER, 2, 'email', 'contact_sent', 3, { actor: 'system' }),
    fact(ctx.OWNER, 1, 'email', 'human_reply', 1, { actor: 'system' }),
    fact(ctx.OWNER, 1, 'email', 'interest', 1, { actor: 'system' }),
    fact(ctx.OWNER, 3, 'opportunities', 'module_opened', 2, { status: 'observed' }),
    fact(ctx.MEMBER, 2, 'home', 'module_opened', 2, { status: 'observed' }),
    fact(ctx.MEMBER, 2, 'contacts', 'contact_saved', 3),
    fact(ctx.MEMBER, 3, 'email', 'draft_prepared', 2),
    fact(ctx.MEMBER, 3, 'email', 'contact_sent', 2, { actor: 'system' }),
    fact(ctx.MEMBER, 4, 'cowork', 'module_opened', 1, { status: 'observed' }),
  ];
  const credit = (userId, daysAgo, resource, net) => ({ organizationId: ctx.ORG, userId, groupId: null, day: day(ctx.daysAgo(daysAgo)), resource, net, debits: net, refunds: 0, source: 'journal' });
  const sent = (userId, key, daysAgo, reply) => ({ organizationId: ctx.ORG, userId, recipientKey: key, sentAt: ctx.daysAgo(daysAgo), replyAt: reply ? ctx.daysAgo(daysAgo - 1) : null,
    intent: reply || null, reliable: true, interestedAt: reply === 'positive' ? ctx.daysAgo(daysAgo - 1) : null, interestReliable: true });
  const report = {
    facts,
    credits: [credit(ctx.OWNER, 1, 'enrich', 6), credit(ctx.OWNER, 2, 'investigate', 4), credit(ctx.MEMBER, 2, 'enrich', 3)],
    cohort: [sent(ctx.OWNER, 'audit-a', 20, 'positive'), sent(ctx.OWNER, 'audit-b', 20, null), sent(ctx.OWNER, 'audit-c', 18, null), sent(ctx.MEMBER, 'audit-d', 19, null), sent(ctx.MEMBER, 'audit-e', 17, 'neutral')],
    pending: [{ organizationId: ctx.ORG, userId: ctx.OWNER, kind: 'positive_pending', count: 1 }, { organizationId: ctx.ORG, userId: ctx.MEMBER, kind: 'prepared_not_contacted', count: 2 }],
    captureFrom: ctx.daysAgo(60), journalFrom: ctx.daysAgo(60), legacyReplies: 0,
  };
  return {
    tables: {},
    rpc: {
      // A person or team filter narrows the same rows the real function would; the scope is always this one organization.
      admin_usage_report_v1: args => {
        const mine = row => !args.p_user || row.userId === args.p_user;
        return { ...report, facts: report.facts.filter(mine), credits: report.credits.filter(mine), cohort: report.cohort.filter(mine), pending: report.pending.filter(mine) };
      },
      admin_usage_member_names_v1: () => [
        { id: ctx.OWNER, email: ctx.ownerEmail, name: 'Camila Torres' },
        { id: ctx.MEMBER, email: ctx.memberEmail, name: 'Diego Fuentes' },
      ],
    },
  };
}
