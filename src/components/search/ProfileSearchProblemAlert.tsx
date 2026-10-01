'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  PROFILE_SEARCH_ACTION_LABELS, type ProfileSearchAction, type ProfileSearchMessage,
} from '@/lib/search/profile-search-outcome';

/** One LinkedIn profile search problem: what happened in one sentence and the buttons that move the person forward. */
export function ProfileSearchProblemAlert({ message, busy, onAction, onDismiss }: {
  message: ProfileSearchMessage;
  busy?: boolean;
  onAction: (action: ProfileSearchAction) => void;
  onDismiss: () => void;
}) {
  return (
    <Alert role="alert" data-problem={message.problem}
      className="mb-4 rounded-2xl border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
      <AlertTitle>{message.title}</AlertTitle>
      <AlertDescription className="space-y-3 text-amber-800 dark:text-amber-100/80">
        <p>{message.description}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {message.actions.map((action, index) => (
            <Button key={action} size="sm" variant={index === 0 ? 'default' : 'outline'} disabled={busy}
              className={index === 0 ? undefined : 'border-amber-300 bg-background/80 text-foreground hover:bg-background dark:border-amber-500/40'}
              onClick={() => onAction(action)}>
              {PROFILE_SEARCH_ACTION_LABELS[action]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-500/10" onClick={onDismiss}>
            Ocultar aviso
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
