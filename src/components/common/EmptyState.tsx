import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mt-1">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
