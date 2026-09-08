import { z } from 'zod';

import {
  QualificationV2Schema,
  type EntityResolutionV2,
  type QualificationV2,
} from '@/lib/report-v2-contracts';

const normalizedText = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '');

const ProductIcpRuleV2Schema = z.object({
  jurisdictions: z.array(z.string().trim().min(1).max(20)).default([]),
  reasonOutOfJurisdiction: z.string().trim().min(1).max(1_000).optional(),
  headcount: z.object({
    min: z.number().int().nonnegative().nullable(),
    max: z.number().int().positive().nullable(),
  }).strict().optional(),
  titlesReject: z.array(z.string().trim().min(1).max(200)).default([]),
  departmentsRejectWhenPure: z.array(z.string().trim().min(1).max(200)).default([]),
  seniorityAccept: z.array(z.string().trim().min(1).max(100)).default([]),
  titlesPrefer: z.array(z.string().trim().min(1).max(300)).default([]),
}).strict();

export const IcpRulesV2Schema = z.object({
  products: z.record(ProductIcpRuleV2Schema),
}).strict();

export type IcpRulesV2 = z.infer<typeof IcpRulesV2Schema>;

function includesRule(value: string, patterns: string[]) {
  const normalized = normalizedText(value);
  return patterns.some((pattern) => normalized.includes(normalizedText(pattern)));
}

function equalsPureDepartment(value: string, patterns: string[]) {
  const normalized = normalizedText(value).replace(/\s+/g, ' ');
  return patterns.some((pattern) => normalized === normalizedText(pattern).replace(/\s+/g, ' '));
}

export function qualifyEntityV2(input: {
  entity: EntityResolutionV2;
  rules?: IcpRulesV2 | null;
  headcount?: number | null;
  productKeys?: string[];
}): QualificationV2 {
  if (!input.rules || Object.keys(input.rules.products || {}).length === 0) {
    return QualificationV2Schema.parse({
      verdict: 'qualified',
      reasons: ['icp_rules_missing'],
      redirectTo: [],
      allowedDepth: 'shallow',
    });
  }

  const parsedRules = IcpRulesV2Schema.parse(input.rules);
  const selectedKeys = input.productKeys?.length
    ? input.productKeys.filter((key) => parsedRules.products[key])
    : Object.keys(parsedRules.products);
  const entries = selectedKeys.map((key) => [key, parsedRules.products[key]] as const);
  if (entries.length === 0) {
    return QualificationV2Schema.parse({
      verdict: 'qualified',
      reasons: ['icp_rules_missing_for_selected_products'],
      redirectTo: [],
      allowedDepth: 'shallow',
    });
  }

  const country = input.entity.contactCountry;
  const jurisdictionMatches = entries.filter(([, rule]) => (
    rule.jurisdictions.length === 0 || rule.jurisdictions.includes(country)
  ));
  const sizeMatches = entries.filter(([, rule]) => {
    if (input.headcount == null || !rule.headcount) return true;
    return (rule.headcount.min == null || input.headcount >= rule.headcount.min)
      && (rule.headcount.max == null || input.headcount <= rule.headcount.max);
  });
  const accountMatches = entries.filter(([key]) => (
    jurisdictionMatches.some(([matchedKey]) => matchedKey === key)
    && sizeMatches.some(([matchedKey]) => matchedKey === key)
  ));
  const contactResults = entries.map(([key, rule]) => ({
    key,
    rule,
    titleRejected: includesRule(input.entity.contact.title, rule.titlesReject),
    departmentRejected: equalsPureDepartment(input.entity.contact.department, rule.departmentsRejectWhenPure),
    seniorityRejected: rule.seniorityAccept.length > 0 && !rule.seniorityAccept.includes(input.entity.contact.seniority),
  }));
  const contactRejected = contactResults.length > 0 && contactResults.every((result) => (
    result.titleRejected || result.departmentRejected || result.seniorityRejected
  ));
  const titleRejected = contactRejected && contactResults.every((result) => result.titleRejected);
  const departmentRejected = contactRejected && contactResults.every((result) => result.departmentRejected);
  const seniorityRejected = contactRejected && contactResults.every((result) => result.seniorityRejected);
  const reasons: string[] = [];

  if (jurisdictionMatches.length === 0) {
    reasons.push('disqualified_jurisdiction');
    entries.forEach(([key, rule]) => {
      reasons.push(rule.reasonOutOfJurisdiction || `${key}:jurisdiction_not_supported`);
    });
  }
  if (jurisdictionMatches.length > 0 && accountMatches.length === 0) reasons.push('disqualified_size');
  if (titleRejected) reasons.push('disqualified_role:title');
  if (departmentRejected) reasons.push('disqualified_role:department');
  if (seniorityRejected) reasons.push('disqualified_role:seniority');
  if (contactRejected && !titleRejected && !departmentRejected && !seniorityRejected) reasons.push('disqualified_role:product_rules');

  const redirectTo = entries.flatMap(([productKey, rule]) => rule.titlesPrefer.map((title, index) => ({
    title,
    seniority: rule.seniorityAccept[index] || rule.seniorityAccept[0] || 'unknown',
    rationale: `Preferred buying role for ${productKey}.`,
  })));
  const uniqueRedirects = [...new Map(redirectTo.map((item) => [`${normalizedText(item.title)}:${item.seniority}`, item])).values()];

  if (contactRejected) {
    return QualificationV2Schema.parse({
      verdict: uniqueRedirects.length > 0 ? 'account_qualified_contact_rejected' : 'disqualified_role',
      reasons,
      redirectTo: uniqueRedirects,
      allowedDepth: 'shallow',
    });
  }
  if (jurisdictionMatches.length === 0) {
    return QualificationV2Schema.parse({ verdict: 'disqualified_jurisdiction', reasons, redirectTo: uniqueRedirects, allowedDepth: 'shallow' });
  }
  if (accountMatches.length === 0) {
    return QualificationV2Schema.parse({ verdict: 'disqualified_size', reasons, redirectTo: uniqueRedirects, allowedDepth: 'shallow' });
  }
  return QualificationV2Schema.parse({ verdict: 'qualified', reasons, redirectTo: [], allowedDepth: 'deep' });
}
