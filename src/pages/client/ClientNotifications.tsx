import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useClientWorkspace } from '../../hooks/useClientWorkspace';
import { clientPortalService } from '../../services/clientPortalService';
import { ClientNotification } from '../../types/client';
import { PageHeader } from '../../components/common/PageHeader';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import {
  Bell,
  Check,
  ExternalLink,
  Calendar,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export const ClientNotifications: React.FC = () => {
  const { showToast, reloadFromDatabase } = useApp();
  const navigate = useNavigate();
  const { workspace, clientBasePath } = useClientWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);

  const loadNotifications = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await clientPortalService.getNotifications(
        workspace.organizationId,
        workspace.userId
      );
      setNotifications(list);
    } catch (err: any) {
      setError(err.message || 'Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const resolveLinkUrl = (rawLink: string | null): string | null => {
    if (!rawLink || !workspace) return null;
    if (rawLink.startsWith('/client/')) {
      return `${clientBasePath}/${rawLink.slice('/client/'.length)}`;
    }
    if (
      rawLink.startsWith(`/${workspace.organizationSlug}/`) ||
      rawLink === '/workspaces'
    ) {
      return rawLink;
    }
    return null;
  };

  const handleNotificationClick = async (n: ClientNotification) => {
    if (!n.is_read && workspace) {
      try {
        await clientPortalService.markNotificationRead(n.id, workspace.userId);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
        );
        void reloadFromDatabase();
      } catch {
        // Non-fatal UI sync failure
      }
    }
    const target = resolveLinkUrl(n.link_url);
    if (target) {
      navigate(target);
    }
  };

  const handleMarkAllRead = async () => {
    if (!workspace) return;
    try {
      await clientPortalService.markAllNotificationsRead(
        workspace.organizationId,
        workspace.userId
      );
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      void reloadFromDatabase();
      showToast('All notifications marked as read.', 'info');
    } catch (err: any) {
      showToast(err.message || 'Unable to mark notifications read.', 'error');
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!workspace || loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading clinical notifications..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-xs text-rose-800 space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          Unable to load notifications
        </div>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void loadNotifications()}
          className="px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications & Alerts"
        subtitle={`Appointment confirmations, prescription notices, and 7-day chat updates for ${workspace.organizationName}.`}
        action={
          unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              Mark All Read ({unreadCount})
            </button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
        {notifications.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            No notifications recorded for this clinic workspace yet.
          </div>
        ) : (
          notifications.map((n) => {
            const target = resolveLinkUrl(n.link_url);
            return (
              <div
                key={n.id}
                onClick={() => void handleNotificationClick(n)}
                className={`p-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-start justify-between gap-4 ${
                  !n.is_read ? 'bg-teal-50/40' : ''
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900">{n.title}</h3>
                    {!n.is_read && (
                      <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0" />
                    )}
                    <span className="text-[10px] uppercase font-bold text-teal-800 bg-teal-100/70 px-1.5 py-0.5 rounded">
                      {n.notification_type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>

                {target && (
                  <span className="text-xs font-semibold text-teal-700 shrink-0 flex items-center gap-1">
                    Open <ExternalLink className="w-3 h-3" />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
