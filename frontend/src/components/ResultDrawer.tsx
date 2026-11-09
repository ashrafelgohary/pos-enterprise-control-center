import {
  ActionIcon, Alert, Button, CopyButton, Divider, Drawer, Group, Loader, ScrollArea, SimpleGrid, Stack, Text, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconCopy, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, errorMessage } from '@/api/client';
import { useResult } from '@/api/hooks';
import { PERMS, useAuth } from '@/auth/AuthContext';
import { duration, fmtDateSec } from '@/utils/format';
import StatusBadge from './StatusBadge';
import { ErrorState } from './States';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text size="sm" fw={500} mt={2}>{value}</Text>
    </div>
  );
}

export default function ResultDrawer({ resultId, onClose }: { resultId: number | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useResult(resultId);
  const { can } = useAuth();
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => api.post(`/deployments/results/${resultId}/retry`),
    onSuccess: () => {
      notifications.show({ color: 'blue', title: 'Retry queued', message: `${data?.hostname} will be redeployed` });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['results'] });
      qc.invalidateQueries({ queryKey: ['pos'] });
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Retry failed', message: errorMessage(e) }),
  });

  return (
    <Drawer opened={resultId !== null} onClose={onClose} position="right" size="xl"
      title={<Group gap="sm"><Text fw={700}>{data?.hostname ?? 'Result'}</Text>{data && <StatusBadge status={data.status} />}</Group>}>
      {isLoading && <Loader />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {data && (
        <Stack>
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            <Field label="IP address" value={data.ip_address} />
            <Field label="XML file" value={data.xml_filename} />
            <Field label="Attempt" value={`#${data.attempt}`} />
            <Field label="Started" value={fmtDateSec(data.started_at)} />
            <Field label="Completed" value={fmtDateSec(data.completed_at)} />
            <Field label="Execution time" value={duration(data.started_at, data.completed_at)} />
          </SimpleGrid>
          {data.error_message && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="Error">
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mantine-font-family-monospace)' }}>{data.error_message}</Text>
            </Alert>
          )}
          {can(PERMS.JOBS_RUN) && (data.status === 'failed' || data.status === 'cancelled') && (
            <Group>
              <Button leftSection={<IconRefresh size={16} />} loading={retry.isPending} onClick={() => retry.mutate()}>
                Retry this POS
              </Button>
            </Group>
          )}
          <Divider label="Ansible output" labelPosition="left" />
          <div style={{ position: 'relative' }}>
            <CopyButton value={data.output ?? ''}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy output'}>
                  <ActionIcon variant="subtle" color="gray" onClick={copy}
                    style={{ position: 'absolute', right: 8, top: 8, zIndex: 2 }}>
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            <ScrollArea h={460} className="pcc-terminal" style={{ borderRadius: 10 }} p="md">
              <pre className="pcc-terminal" style={{ margin: 0 }}>
                {data.output || (data.status === 'pending' || data.status === 'running' ? 'Waiting for output…' : 'No output captured.')}
              </pre>
            </ScrollArea>
          </div>
        </Stack>
      )}
    </Drawer>
  );
}
