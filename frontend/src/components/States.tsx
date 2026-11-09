import { Button, Center, Skeleton, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconAlertCircle, IconInbox, IconRefresh } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Center py={56}>
      <Stack align="center" gap={8} maw={420}>
        <ThemeIcon size={56} radius="xl" variant="light" color="gray">{icon ?? <IconInbox size={28} />}</ThemeIcon>
        <Text fw={600}>{title}</Text>
        {message && <Text size="sm" c="dimmed" ta="center">{message}</Text>}
        {action}
      </Stack>
    </Center>
  );
}

export function ErrorState({ title = 'Unable to load data', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <Center py={56}>
      <Stack align="center" gap={8} maw={460}>
        <ThemeIcon size={56} radius="xl" variant="light" color="red"><IconAlertCircle size={28} /></ThemeIcon>
        <Text fw={600}>{title}</Text>
        {message && <Text size="sm" c="dimmed" ta="center">{message}</Text>}
        {onRetry && <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={onRetry}>Retry</Button>}
      </Stack>
    </Center>
  );
}

export function LoadingRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <Table.Tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <Table.Td key={c}><Skeleton h={14} radius="sm" /></Table.Td>
          ))}
        </Table.Tr>
      ))}
    </>
  );
}
