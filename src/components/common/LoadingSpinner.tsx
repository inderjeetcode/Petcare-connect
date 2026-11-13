import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  label,
  message,
}) => {
  const iconSize =
    size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5';
  const text = label || message;

  return (
    <div className="flex flex-col items-center justify-center gap-2 text-slate-600">
      <Loader2 className={`${iconSize} animate-spin text-teal-700`} />
      {text && <span className="text-xs font-medium text-slate-500">{text}</span>}
    </div>
  );
};
