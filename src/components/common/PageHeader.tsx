import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  breadcrumbs,
  action,
}) => {
  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5" aria-label="Breadcrumb">
            {breadcrumbs.map((b, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span>/</span>}
                <span className={idx === breadcrumbs.length - 1 ? 'text-slate-800 font-semibold' : ''}>
                  {b.label}
                </span>
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
      </div>

      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
};
