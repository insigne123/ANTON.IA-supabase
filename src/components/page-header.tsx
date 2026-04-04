import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-8 rounded-[28px] border border-border/60 bg-card/80 px-6 py-6 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.18)] backdrop-blur-sm dark:bg-card/60 dark:shadow-[0_10px_30px_-24px_rgba(2,6,23,0.8)] md:px-7 md:py-7">
      <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-end">
        <div className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">Workspace</div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
          {title}
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-[15px]">{description}</p>
        </div>
        {children && <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-shrink-0 md:justify-end">{children}</div>}
      </div>
    </div>
  );
}
