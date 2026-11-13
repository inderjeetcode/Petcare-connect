import React from 'react';
import { Lock } from 'lucide-react';

interface PlatformPrivacyBannerProps {
  compact?: boolean;
}

export const PlatformPrivacyBanner: React.FC<PlatformPrivacyBannerProps> = ({
  compact = false,
}) => {
  return (
    <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 flex items-start gap-3 text-xs text-teal-900">
      <Lock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
      <div>
        <span className="font-bold">Strict Privilege & Clinical Data Boundary: </span>
        {compact ? (
          <span>
            Platform Owner access is isolated from private medical records, prescriptions, vaccinations, consultation notes, and patient chat transcripts under database RLS.
          </span>
        ) : (
          <span>
            Platform Owner governance is separated from organization administration. Private medical records, prescriptions, vaccinations, private consultation notes, and active or expired chat messages remain strictly inaccessible under database RLS. Exceptional support diagnostics require explicit time-limited Organization Owner approval and are fully audited.
          </span>
        )}
      </div>
    </div>
  );
};
