import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-end">
      <div className="space-y-2">
        <div className="relative">
          <h1 className="text-3xl font-bold font-headline tracking-tight text-foreground">
            {title}
          </h1>
          <div className="mt-1 h-1 w-24 rounded-full bg-gradient-to-r from-primary to-primary/40" />
        </div>
        <p className="max-w-2xl text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex flex-shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
