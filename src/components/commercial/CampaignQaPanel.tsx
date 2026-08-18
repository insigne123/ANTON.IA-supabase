'use client';

import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CampaignQaCheck, CampaignQaResult, CampaignQaSeverity } from '@/lib/campaign-qa';
import { cn } from '@/lib/utils';

type Props = {
  result: CampaignQaResult;
  compact?: boolean;
};

function statusClasses(status: CampaignQaSeverity) {
  if (status === 'pass') return 'border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100';
  if (status === 'review') return 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
  return 'border-rose-200 bg-rose-50/70 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100';
}

function CheckIcon({ severity }: { severity: CampaignQaSeverity }) {
  if (severity === 'pass') return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />;
  if (severity === 'review') return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />;
  return <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-300" />;
}

function severityLabel(severity: CampaignQaSeverity) {
  if (severity === 'pass') return 'OK';
  if (severity === 'review') return 'Revisar';
  return 'Bloquea';
}

function visibleChecks(checks: CampaignQaCheck[]) {
  const important = checks.filter((check) => check.severity !== 'pass');
  if (important.length > 0) return important;
  return checks.slice(0, 4);
}

export function CampaignQaPanel({ result, compact = false }: Props) {
  const checks = visibleChecks(result.checks);

  if (compact) {
    const isPass = result.status === 'pass';
    return (
      <div className={cn('rounded-xl border px-3 py-2.5', statusClasses(result.status))}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4" />
            {result.label}
          </div>
          <p className="text-xs text-current/75">{result.description}</p>
          {!isPass && (
            <div className="flex flex-wrap gap-1.5">
              {checks.map((check) => (
                <Badge key={check.id} variant="outline" className="border-current/20 bg-background/40 text-[11px] text-current">
                  {check.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn('overflow-hidden border', statusClasses(result.status))}>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-full bg-background/65 p-2 text-current">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Campaign QA</CardTitle>
              <CardDescription className="mt-1 text-current/75">{result.description}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-current/20 bg-background/50 text-current">{result.label}</Badge>
            {result.blockedCount > 0 && <Badge variant="outline" className="border-current/20 bg-background/50 text-current">{result.blockedCount} bloqueos</Badge>}
            {result.reviewCount > 0 && <Badge variant="outline" className="border-current/20 bg-background/50 text-current">{result.reviewCount} revisar</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {checks.map((check) => (
          <div key={check.id} className="rounded-xl border border-current/10 bg-background/55 p-3">
            <div className="flex gap-3">
              <CheckIcon severity={check.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{check.label}</p>
                  <Badge variant="outline" className="border-current/20 bg-background/50 text-[11px] text-current">
                    {severityLabel(check.severity)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.message}</p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
