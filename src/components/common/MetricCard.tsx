import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: string;
  trendPositive?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  icon: Icon,
  description,
  trend,
  trendPositive,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
        {value}
      </div>
      {(description || trend) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          {trend && (
            <span
              className={`font-semibold ${
                trendPositive ? 'text-emerald-600' : 'text-slate-600'
              }`}
            >
              {trend}
            </span>
          )}
          {description && <span>{description}</span>}
        </div>
      )}
    </div>
  );
};
