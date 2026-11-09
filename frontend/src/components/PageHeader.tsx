import { Anchor, Breadcrumbs, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function PageHeader({ title, subtitle, actions, crumbs }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[];
}) {
  return (
    <Stack gap={6} mb="lg">
      {crumbs && (
        <Breadcrumbs separatorMargin={6}>
          {crumbs.map((c) => c.to
            ? <Anchor key={c.label} component={Link} to={c.to} size="xs" c="dimmed">{c.label}</Anchor>
            : <Text key={c.label} size="xs" c="dimmed">{c.label}</Text>)}
        </Breadcrumbs>
      )}
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={2} fz={24}>{title}</Title>
          {subtitle && <Text c="dimmed" size="sm" mt={2}>{subtitle}</Text>}
        </div>
        {actions && <Group gap="sm">{actions}</Group>}
      </Group>
    </Stack>
  );
}
