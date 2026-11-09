import { Badge, Loader } from '@mantine/core';

const MAP: Record<string, { color: string; label: string }> = {
  online: { color: 'teal', label: 'Online' },
  offline: { color: 'red', label: 'Offline' },
  unknown: { color: 'gray', label: 'Unknown' },
  maintenance: { color: 'yellow', label: 'Maintenance' },
  pending: { color: 'gray', label: 'Pending' },
  running: { color: 'blue', label: 'Running' },
  success: { color: 'teal', label: 'Success' },
  partial: { color: 'orange', label: 'Partial' },
  failed: { color: 'red', label: 'Failed' },
  cancelled: { color: 'dark', label: 'Cancelled' },
};

export default function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const s = MAP[status] ?? { color: 'gray', label: status };
  return (
    <Badge size={size} color={s.color} variant="light"
      leftSection={status === 'running' ? <Loader size={9} color={s.color} /> : <span style={{
        display: 'inline-block', width: 6, height: 6, borderRadius: 6, background: `var(--mantine-color-${s.color}-6)`,
      }} />}>
      {s.label}
    </Badge>
  );
}
