import { Group, Progress, Text, Tooltip } from '@mantine/core';

export function JobProgressBar({ total, success, failed, running, size = 'md' }: {
  total: number; success: number; failed: number; running: number; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <Progress.Root size={size} radius="xl">
      <Tooltip label={`Successful: ${success}`}><Progress.Section value={pct(success)} color="teal" /></Tooltip>
      <Tooltip label={`Failed: ${failed}`}><Progress.Section value={pct(failed)} color="red" /></Tooltip>
      <Tooltip label={`Running: ${running}`}><Progress.Section value={pct(running)} color="blue" striped animated /></Tooltip>
    </Progress.Root>
  );
}

export function percentDone(total: number, success: number, failed: number, cancelled = 0) {
  return total ? Math.round(((success + failed + cancelled) / total) * 100) : 0;
}

export function MiniProgress({ total, success, failed, running }: { total: number; success: number; failed: number; running: number }) {
  return (
    <Group gap={8} wrap="nowrap" miw={140}>
      <div style={{ flex: 1 }}><JobProgressBar total={total} success={success} failed={failed} running={running} size="sm" /></div>
      <Text size="xs" c="dimmed" w={34} ta="right">{percentDone(total, success, failed)}%</Text>
    </Group>
  );
}
