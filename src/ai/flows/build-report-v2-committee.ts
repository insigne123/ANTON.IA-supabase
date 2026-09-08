import {
  CommitteeMemberV2Schema,
  type ClaimV2,
  type CommitteeMemberV2,
  type EntityResolutionV2,
  type QualificationV2,
} from '@/lib/report-v2-contracts';

export type PersistedApolloPersonV2 = {
  fullName?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
  emailStatus?: string | null;
  claimIds?: string[];
};

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function rankForTitle(title: string, targets: QualificationV2['redirectTo']): CommitteeMemberV2['rank'] {
  const position = targets.findIndex((target) => (
    normalized(title).includes(normalized(target.title)) || normalized(target.title).includes(normalized(title))
  ));
  if (position === 0) return 'primary';
  if (position === 1) return 'alternative';
  if (position >= 2) return 'third';
  return 'alternative';
}

function peopleFromClaims(claims: ClaimV2[], companyName: string) {
  const escapedCompany = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return claims.flatMap((claim) => {
    if (claim.dimension !== 'buying_committee' || claim.type !== 'fact') return [];
    const match = claim.statement.match(new RegExp(`^(.+?)\\s+es\\s+(.+?)\\s+de\\s+${escapedCompany}[.]?$`, 'iu'));
    if (!match) return [];
    return [{ name: match[1].trim(), title: match[2].trim(), claimId: claim.id }];
  });
}

export function buildReportV2Committee(input: {
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  claims: ClaimV2[];
  persistedApolloPeople?: PersistedApolloPersonV2[] | null;
}): CommitteeMemberV2[] {
  const candidates: CommitteeMemberV2[] = [];
  for (const person of input.persistedApolloPeople || []) {
    if (normalized(person.emailStatus) !== 'verified') continue;
    const name = String(person.fullName || '').trim();
    const title = String(person.title || '').trim();
    if (!name || !title) continue;
    candidates.push(CommitteeMemberV2Schema.parse({
      name,
      title,
      rank: rankForTitle(title, input.qualification.redirectTo),
      rationale: 'Persisted provider context identifies a verified contact for this account.',
      emailStatus: 'verified',
      linkedinUrl: person.linkedinUrl || null,
      claimIds: (person.claimIds || []).filter((id) => input.claims.some((claim) => claim.id === id)),
    }));
  }
  peopleFromClaims(input.claims, input.entity.companyName).forEach((person) => {
    candidates.push(CommitteeMemberV2Schema.parse({
      name: person.name,
      title: person.title,
      rank: rankForTitle(person.title, input.qualification.redirectTo),
      rationale: 'A public source names this person and role; contact details were not searched.',
      emailStatus: 'not_searched',
      linkedinUrl: null,
      claimIds: [person.claimId],
    }));
  });
  input.qualification.redirectTo.forEach((target, index) => {
    candidates.push(CommitteeMemberV2Schema.parse({
      name: null,
      title: target.title,
      rank: index === 0 ? 'primary' : index === 1 ? 'alternative' : 'third',
      rationale: target.rationale,
      emailStatus: 'not_searched',
      linkedinUrl: null,
      claimIds: [],
    }));
  });
  candidates.push(CommitteeMemberV2Schema.parse({
    name: input.entity.contact.fullName,
    title: input.entity.contact.title,
    rank: input.qualification.verdict === 'account_qualified_contact_rejected' || input.qualification.verdict === 'disqualified_role'
      ? 'rejected'
      : 'alternative',
    rationale: input.qualification.verdict === 'account_qualified_contact_rejected'
      ? 'The ICP gate rejected this contact while preserving the account.'
      : 'Imported entry contact; purchasing authority remains to be validated.',
    emailStatus: 'not_searched',
    linkedinUrl: input.entity.contact.linkedinUrl,
    claimIds: [],
  }));

  return [...new Map(candidates.map((member) => [
    `${normalized(member.name || '')}:${normalized(member.title)}`,
    member,
  ])).values()];
}
