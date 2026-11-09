import {
  ActionIcon, Affix, Alert, Badge, Button, Card, Grid, Group, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text, Title, Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconEye, IconMail, IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useJob } from '@/api/hooks';
import { PERMS, useAuth } from '@/auth/AuthContext';
import { JobProgressBar, percentDone } from '@/components/JobProgress';
import PageHeader from '@/components/PageHeader';
import ResultDrawer from '@/components/ResultDrawer';
import StatusBadge from '@/components/StatusBadge';
import { ErrorState } from '@/components/States';
import { duration, fmtDateSec } from '@/utils/format';
import { EmailPreviewModal } from '@/features/deployment-email/EmailPreviewModal';
import { fetchJobEmailPreviews, type JobEmailPreview } from '@/features/deployment-email/jobEmail';

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text fz={26} fw={700} c={color}>{value}</Text>
    </div>
  );
}

export default function JobDetailPage() {
  const id = Number(useParams().id);
  const { data: job, isLoading, isError, refetch } = useJob(id);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [resultId, setResultId] = useState<number | null>(null);
  const [emailPreviews, setEmailPreviews] = useState<JobEmailPreview[]>([]);
  const [emailIdx, setEmailIdx] = useState<number | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const prevJobStatus = useRef<string | null>(null);
  const openJobEmail = async (posId?: number | null) => {
    setEmailLoading(true);
    try {
      const list = await fetchJobEmailPreviews(id);
      setEmailPreviews(list);
      const i = posId ? list.findIndex((p) => p.pos_ids.includes(posId)) : 0;
      setEmailIdx(list.length ? Math.max(0, i) : null);
      if (!posId && list.length > 1) {
        notifications.show({ color: 'blue', title: `${list.length} store emails prepared`,
          message: 'POS belong to different stores - use the store switcher at the top to review each email.' });
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Email preview unavailable', message: errorMessage(e) });
    } finally {
      setEmailLoading(false);
    }
  };
  useEffect(() => {
    if (!job) return;
    const before = prevJobStatus.current;
    prevJobStatus.current = job.status;
    // open once, when a job watched on this page finishes with at least one successful POS
    if (before && ['pending', 'running'].includes(before) && ['success', 'partial'].includes(job.status)) {
      const ok = job.results.filter((r) => r.status === 'success').length;
      notifications.show({ color: 'teal', title: 'Deployment completed',
        message: `${ok} POS terminal${ok === 1 ? '' : 's'} updated successfully.` });
      void openJobEmail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const retryAll = useMutation({
    mutationFn: () => api.post(`/deployments/jobs/${id}/retry`),
    onSuccess: () => { notifications.show({ color: 'blue', title: 'Retry queued', message: 'Failed POS will be redeployed' }); invalidate(); },
    onError: (e) => notifications.show({ color: 'red', title: 'Retry failed', message: errorMessage(e) }),
  });
  const retryOne = useMutation({
    mutationFn: (rid: number) => api.post(`/deployments/results/${rid}/retry`),
    onSuccess: () => { notifications.show({ color: 'blue', title: 'Retry queued', message: 'POS will be redeployed' }); invalidate(); },
    onError: (e) => notifications.show({ color: 'red', title: 'Retry failed', message: errorMessage(e) }),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/deployments/jobs/${id}/cancel`),
    onSuccess: () => { notifications.show({ color: 'gray', title: 'Cancellation requested', message: `Job #${id}` }); invalidate(); },
    onError: (e) => notifications.show({ color: 'red', title: 'Cancel failed', message: errorMessage(e) }),
  });

  const counts = useMemo(() => {
    const c = { success: 0, failed: 0, running: 0, pending: 0, cancelled: 0 };
    job?.results.forEach((r) => { c[r.status] += 1; });
    return c;
  }, [job]);
  const results = useMemo(() => (job?.results ?? []).filter((r) => filter === 'all' || r.status === filter), [job, filter]);

  if (isError) return <ErrorState title="Job not available" onRetry={() => refetch()} />;
  const active = job && ['pending', 'running'].includes(job.status);
  const pct = job ? percentDone(job.total_devices, counts.success, counts.failed, counts.cancelled) : 0;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Deployments', to: '/deployments/history' }, { label: `Job #${id}` }]}
        title={<Group gap="sm">Deployment #{id}{job && <StatusBadge status={job.status} size="lg" />}</Group>}
        subtitle={job ? `Started by ${job.uploaded_by_username ?? 'unknown'} · ${fmtDateSec(job.created_at)}` : undefined}
        actions={can(PERMS.JOBS_RUN) && job && <>
          {!active && counts.success > 0 && <Button variant="light" color="teal" leftSection={<IconMail size={16} />}
            loading={emailLoading} onClick={() => void openJobEmail()}>Prepare store email</Button>}
          {active && <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} loading={cancel.isPending}
            onClick={() => modals.openConfirmModal({
              title: 'Cancel deployment', labels: { confirm: 'Cancel job', cancel: 'Keep running' }, confirmProps: { color: 'red' },
              children: <Text size="sm">Pending POS will be skipped and the running Ansible process will be stopped. POS already updated are not rolled back.</Text>,
              onConfirm: () => cancel.mutate(),
            })}>Cancel job</Button>}
          {!active && (counts.failed + counts.cancelled) > 0 && <Button leftSection={<IconRefresh size={16} />} loading={retryAll.isPending}
            onClick={() => retryAll.mutate()}>Retry failed ({counts.failed + counts.cancelled})</Button>}
        </>}
      />

      {job?.error_message && <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="md" title="Job error">{job.error_message}</Alert>}

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card h="100%">
            {isLoading || !job ? <Skeleton h={120} /> : (
              <Stack>
                <Group justify="space-between">
                  <Title order={5}>Progress</Title>
                  <Text fw={700} fz="lg">{pct}%</Text>
                </Group>
                <JobProgressBar total={job.total_devices} success={counts.success} failed={counts.failed} running={counts.running} size="xl" />
                <SimpleGrid cols={{ base: 2, sm: 5 }}>
                  <Counter label="Successful" value={counts.success} color="teal" />
                  <Counter label="Running" value={counts.running} color="blue" />
                  <Counter label="Failed" value={counts.failed} color="red" />
                  <Counter label="Pending" value={counts.pending} color="gray" />
                  <Counter label="Cancelled" value={counts.cancelled} color="dark" />
                </SimpleGrid>
              </Stack>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card h="100%">
            <Title order={5} mb="sm">Details</Title>
            {job && (
              <SimpleGrid cols={2} spacing="sm">
                <div><Text size="xs" c="dimmed">XML files</Text><Text fw={600}>{job.file_count}</Text></div>
                <div><Text size="xs" c="dimmed">Target POS</Text><Text fw={600}>{job.total_devices}</Text></div>
                <div><Text size="xs" c="dimmed">Started</Text><Text size="sm">{fmtDateSec(job.started_at)}</Text></div>
                <div><Text size="xs" c="dimmed">Completed</Text><Text size="sm">{fmtDateSec(job.completed_at)}</Text></div>
                <div><Text size="xs" c="dimmed">Duration</Text><Text size="sm">{duration(job.started_at, job.completed_at)}</Text></div>
                <div><Text size="xs" c="dimmed">Live updates</Text>{active ? <Badge color="blue" variant="dot">every 2s</Badge> : <Text size="sm">—</Text>}</div>
              </SimpleGrid>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={12}>
          <Card p={0}>
            <Group justify="space-between" p="md" wrap="wrap">
              <Title order={5}>Per-POS results</Title>
              <SegmentedControl size="xs" value={filter} onChange={setFilter} data={[
                { value: 'all', label: `All (${job?.results.length ?? 0})` }, { value: 'running', label: `Running (${counts.running})` },
                { value: 'failed', label: `Failed (${counts.failed})` }, { value: 'success', label: `Success (${counts.success})` },
                { value: 'pending', label: `Pending (${counts.pending})` },
              ]} />
            </Group>
            <Table.ScrollContainer minWidth={900}>
              <Table>
                <Table.Thead><Table.Tr>
                  <Table.Th>POS</Table.Th><Table.Th>IP address</Table.Th><Table.Th>XML file</Table.Th><Table.Th>Status</Table.Th>
                  <Table.Th>Attempt</Table.Th><Table.Th>Execution time</Table.Th><Table.Th>Error</Table.Th><Table.Th ta="right">Actions</Table.Th>
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {results.map((r) => (
                    <Table.Tr key={r.id} className="pcc-row-click" onClick={() => setResultId(r.id)}>
                      <Table.Td>{r.pos_id ? <Text component={Link} to={`/pos/${r.pos_id}`} size="sm" fw={600} c="brand" onClick={(e) => e.stopPropagation()}>{r.hostname}</Text>
                        : <Text size="sm" fw={600}>{r.hostname}</Text>}</Table.Td>
                      <Table.Td><Text size="sm" ff="monospace">{r.ip_address}</Text></Table.Td>
                      <Table.Td><Text size="sm">{r.xml_filename}</Text></Table.Td>
                      <Table.Td><StatusBadge status={r.status} /></Table.Td>
                      <Table.Td>{r.attempt}</Table.Td>
                      <Table.Td>{duration(r.started_at, r.completed_at)}</Table.Td>
                      <Table.Td><Text size="xs" c="red" truncate maw={280}>{r.error_message ?? ''}</Text></Table.Td>
                      <Table.Td ta="right" onClick={(e) => e.stopPropagation()}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="View Ansible output"><ActionIcon variant="subtle" onClick={() => setResultId(r.id)}><IconEye size={16} /></ActionIcon></Tooltip>
                          {r.status === 'success' && (
                            <Tooltip label="Prepare store email"><ActionIcon variant="subtle" color="teal"
                              onClick={() => void openJobEmail(r.pos_id)}><IconMail size={16} /></ActionIcon></Tooltip>
                          )}
                          {can(PERMS.JOBS_RUN) && (r.status === 'failed' || r.status === 'cancelled') && !active && (
                            <Tooltip label="Retry this POS"><ActionIcon variant="subtle" color="orange" loading={retryOne.isPending && retryOne.variables === r.id}
                              onClick={() => retryOne.mutate(r.id)}><IconRefresh size={16} /></ActionIcon></Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {job && results.length === 0 && <Text c="dimmed" size="sm" ta="center" py="xl">No results in this category.</Text>}
          </Card>
        </Grid.Col>
      </Grid>
      <ResultDrawer resultId={resultId} onClose={() => setResultId(null)} />
      <EmailPreviewModal opened={emailIdx !== null} loading={emailLoading}
        preview={emailIdx !== null ? emailPreviews[emailIdx] ?? null : null} onClose={() => setEmailIdx(null)} />
      {emailIdx !== null && emailPreviews.length > 1 && (
        <Affix position={{ top: 12, left: '50%' }} zIndex={1000} style={{ transform: 'translateX(-50%)' }}>
          <Card shadow="lg" p={6} radius="md" withBorder>
            <SegmentedControl size="xs" value={String(emailIdx)} onChange={(v) => setEmailIdx(Number(v))}
              data={emailPreviews.map((p, i) => ({ value: String(i), label: `${p.store_name} (${p.pos_ids.length})` }))} />
          </Card>
        </Affix>
      )}
    </>
  );
}
