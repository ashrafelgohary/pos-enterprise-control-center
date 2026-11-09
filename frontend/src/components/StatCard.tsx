import { Card, Group, Skeleton, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export default function StatCard({ label, value, icon, color, hint, loading, onClick }: {
  label: string; value: number | string | undefined; icon: ReactNode; color: string; hint?: ReactNode;
  loading?: boolean; onClick?: () => void;
}) {
  return (
    <Card p="lg" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '.06em' }}>{label}</Text>
          {loading ? <Skeleton h={32} w={70} mt={8} /> : <Text fz={30} fw={700} lh={1.2} mt={4}>{value ?? '—'}</Text>}
        </div>
        <div className="pcc-stat-icon" style={{ background: `var(--mantine-color-${color}-light)`, color: `var(--mantine-color-${color}-6)` }}>
          {icon}
        </div>
      </Group>
      {hint && <Text size="xs" c="dimmed" mt="sm">{hint}</Text>}
    </Card>
  );
}
