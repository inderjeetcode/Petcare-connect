import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from './PageHeader';
import { Pagination } from './Pagination';
import {
  isWithinDateRange,
  paginateItems,
  resolveNotificationUrl,
} from '../../utils/listManagementHelpers';
import {
  Bell,
  Calendar,
  Check,
  CheckCheck,
  ExternalLink,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
} from 'lucide-react';

interface NotificationsCenterProps {
  portal: 'client' | 'doctor' | 'admin' | 'platform' | 'global';
  title?: string;
  subtitle?: string;
}

export const NotificationsCenter: React.FC<NotificationsCenterProps> = ({
  portal,
  title = 'Notifications Center',
  subtitle,
}) => {
  const {
    notifications,
    toggleNotificationRead,
    markNotificationRead,
    markAllNotificationsRead,
    reloadFromDatabase,
    isDataLoading,
  } = useApp();
  const { activeWorkspace } = useAuth();
  const navigate = useNavigate();

  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);

  const notificationTypes = useMemo(() => {
    const types = Array.from(
      new Set(notifications.map((n) => (n.notification_type || 'system').toLowerCase()))
    ).sort();
    return types;
  }, [notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.is_read) return false;
      if (readFilter === 'read' && !n.is_read) return false;
      const nType = (n.notification_type || 'system').toLowerCase();
      if (typeFilter !== 'all' && nType !== typeFilter) return false;
      if (!isWithinDateRange(n.created_at, fromDate, toDate)) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.message.toLowerCase().includes(q) ||
        nType.includes(q)
      );
    });
  }, [notifications, readFilter, typeFilter, fromDate, toDate, search]);

  const paginated = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const resolvedSubtitle =
    subtitle ||
    (portal === 'platform'
      ? 'Platform governance alerts, organization onboarding notices, and security events.'
      : activeWorkspace?.organization_name
      ? `Real-time operational & clinical alerts scoped to ${activeWorkspace.organization_name}.`
      : 'Account notifications across your veterinary workspaces.');

  const handleOpenNotification = async (id: string, linkUrl?: string | null) => {
    const target = resolveNotificationUrl(linkUrl, activeWorkspace, portal);
    await markNotificationRead(id).catch(() => {});
    if (target) {
      navigate(target);
    }
  };

  const handleToggleRead = async (
    e: React.MouseEvent,
    id: string,
    nextRead: boolean
  ) => {
    e.stopPropagation();
    setBusyId(id);
    try {
      await toggleNotificationRead(id, nextRead);
    } catch {
      // Error toast and rollback are handled inside AppContext
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={title}
        subtitle={resolvedSubtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void reloadFromDatabase()}
              disabled={isDataLoading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isDataLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-4 h-4" />
                Mark All Read ({unreadCount})
              </button>
            )}
          </div>
        }
      />

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit overflow-x-auto">
            {(
              [
                ['all', `All (${notifications.length})`],
                ['unread', `Unread (${unreadCount})`],
                ['read', `Read (${notifications.length - unreadCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setReadFilter(key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  readFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search title, message, type..."
                aria-label="Search notifications"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by notification category"
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">All Categories</option>
              {notificationTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              aria-label="From date"
              title="From date"
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white tabular-nums"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              aria-label="To date"
              title="To date"
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white tabular-nums"
            />
            {(fromDate || toDate || search || typeFilter !== 'all' || readFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setReadFilter('all');
                  setTypeFilter('all');
                  setSearch('');
                  setFromDate('');
                  setToDate('');
                  setPage(1);
                }}
                className="px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 rounded-lg"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notification List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {paginated.items.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 space-y-2">
            <Bell className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-800">No Matching Notifications</div>
            <p className="max-w-md mx-auto">
              {notifications.length === 0
                ? 'You are completely caught up. Real-time updates for appointments, clinical records, and platform events will appear here automatically.'
                : 'Try adjusting your read filter, date range, or search keyword.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {paginated.items.map((n) => {
              const resolvedTarget = resolveNotificationUrl(n.link_url, activeWorkspace, portal);
              const isBusy = busyId === n.id;

              return (
                <div
                  key={n.id}
                  onClick={() => void handleOpenNotification(n.id, n.link_url)}
                  role={resolvedTarget ? 'button' : undefined}
                  tabIndex={resolvedTarget ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (resolvedTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      void handleOpenNotification(n.id, n.link_url);
                    }
                  }}
                  className={`p-4 transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                    resolvedTarget ? 'cursor-pointer hover:bg-slate-50' : ''
                  } ${!n.is_read ? 'bg-teal-50/45' : 'bg-white'}`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.is_read && (
                        <span
                          className="w-2 h-2 rounded-full bg-teal-600 shrink-0"
                          aria-label="Unread"
                        />
                      )}
                      <h3 className="text-xs font-bold text-slate-900">{n.title}</h3>
                      <span className="text-[10px] uppercase font-bold text-teal-800 bg-teal-100/80 px-1.5 py-0.5 rounded">
                        {(n.notification_type || 'system').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono tabular-nums">
                      <Calendar className="w-3 h-3" />
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={(e) => void handleToggleRead(e, n.id, !n.is_read)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      {n.is_read ? (
                        <>
                          <Mail className="w-3.5 h-3.5 text-slate-500" />
                          Mark Unread
                        </>
                      ) : (
                        <>
                          <MailOpen className="w-3.5 h-3.5 text-teal-700" />
                          Mark Read
                        </>
                      )}
                    </button>

                    {resolvedTarget && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenNotification(n.id, n.link_url);
                        }}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <Check className="w-3 h-3 hidden" />
                        Open
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Pagination
          currentPage={paginated.currentPage}
          totalPages={paginated.totalPages}
          totalItems={paginated.totalItems}
          startIndex={paginated.startIndex}
          endIndex={paginated.endIndex}
          pageSize={paginated.pageSize}
          onPageChange={setPage}
          onPageSizeChange={(nextSize) => {
            setPageSize(nextSize);
            setPage(1);
          }}
          itemLabel="notifications"
        />
      </div>
    </div>
  );
};
