import React from 'react';
import { ConsultationStatus } from '../../types';
import { AppointmentStatus } from '../../types/client';

interface StatusBadgeProps {
  status:
    | ConsultationStatus
    | AppointmentStatus
    | 'available'
    | 'unavailable'
    | 'active_doc'
    | 'inactive_doc'
    | 'issued'
    | 'void'
    | 'failed'
    | 'refunded';
  customLabel?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  customLabel,
  className = '',
}) => {
  switch (status) {
    case 'active':
    case 'active_doc':
    case 'available':
    case 'confirmed':
    case 'checked_in':
    case 'issued':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {customLabel ||
            (status === 'available'
              ? 'Available'
              : status === 'confirmed'
              ? 'Confirmed'
              : status === 'checked_in'
              ? 'Checked In'
              : status === 'issued'
              ? 'Issued'
              : 'Active')}
        </span>
      );

    case 'pending':
    case 'requested':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {customLabel ||
            (status === 'requested' ? 'Pending Confirmation' : 'Pending Approval')}
        </span>
      );

    case 'completed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          {customLabel || 'Completed'}
        </span>
      );

    case 'expired':
    case 'cancelled':
    case 'no_show':
    case 'refunded':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          {customLabel ||
            (status === 'cancelled'
              ? 'Cancelled'
              : status === 'no_show'
              ? 'No Show'
              : status === 'refunded'
              ? 'Refunded'
              : 'Expired (7-Day Limit)')}
        </span>
      );

    case 'rejected':
    case 'declined':
    case 'void':
    case 'failed':
    case 'inactive_doc':
    case 'unavailable':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 ${className}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {customLabel ||
            (status === 'unavailable'
              ? 'Unavailable'
              : status === 'void'
              ? 'Voided'
              : status === 'failed'
              ? 'Failed'
              : 'Declined')}
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 ${className}`}
        >
          {customLabel || status}
        </span>
      );
  }
};
