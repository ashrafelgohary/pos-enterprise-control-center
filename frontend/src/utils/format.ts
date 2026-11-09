import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const fmtDate = (d?: string | null) => (d ? dayjs(d).format('DD MMM YYYY, HH:mm') : '—');
export const fmtDateSec = (d?: string | null) => (d ? dayjs(d).format('DD MMM YYYY, HH:mm:ss') : '—');
export const fromNow = (d?: string | null) => (d ? dayjs(d).fromNow() : 'Never');

export function duration(start?: string | null, end?: string | null): string {
  if (!start) return '—';
  const ms = (end ? dayjs(end) : dayjs()).diff(dayjs(start));
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'signed in', 'auth.login_failed': 'failed sign-in', 'auth.logout': 'signed out',
  'auth.password_changed': 'changed password', 'user.created': 'created', 'user.updated': 'updated',
  'user.deactivated': 'deactivated', 'user.password_reset': 'reset password of', 'pos.created': 'added',
  'pos.updated': 'modified', 'pos.deleted': 'deleted', 'pos.imported': 'imported POS from',
  'pos.exported': 'exported', 'xml.uploaded': 'uploaded XML files to', 'deployment.started': 'started',
  'deployment.completed': 'completed', 'deployment.failed': 'failed', 'deployment.host_failed': 'failed on',
  'deployment.retried': 'retried', 'deployment.cancelled': 'cancelled',
};
export const describeAction = (a: string) => ACTION_LABELS[a] ?? a;
