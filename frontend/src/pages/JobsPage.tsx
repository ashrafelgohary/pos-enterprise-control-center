import { ActionIcon, Button, Card, Group, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCloudUpload, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobs } from '@/api/hooks';
import { PERMS, useAuth } from '@/auth/AuthContext';
import { MiniProgress } from '@/components/JobProgress';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import TableFooter from '@/components/TableFooter';
import { EmptyState, ErrorState, LoadingRows } from '@/components/States';
import { duration, fmtDate, fromNow } from '@/utils/format';

const META = {
  all: { title: 'Deployment History', subtitle: 'Every XML deployment job and its outcome', empty: 'No deployments yet' },
  running: { title: 'Running Jobs', subtitle: 'Queued and in-progress deployments · auto-refreshing', empty: 'No active deployments' },
  failed: { title: 'Failed Jobs', subtitle: 'Jobs with one or more failed POS — open a job to inspect and retry', empty: 'No failed deployments' },
} as const;

export default function JobsPage({ view }: { view: 'all' | 'running' | 'failed' }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => setPage(1), [view, q, pageSize]);
  const { data, isLoading, isError, refetch } = useJobs({ view, q, page, page_size: pageSize });
  const m = META[view];

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} crumbs={[{ label: 'Deployments' }, { label: m.title }]}
        actions={can(PERMS.XML_UPLOAD) && <Button leftSection={<IconCloudUpload size={16} />} onClick={() => nav('/deployments/new')}>New deployment</Button>} />
      <Card p={0}>
        <Group p="md">
          <TextInput placeholder="Search job #, file or POS hostname…" leftSection={<IconSearch size={16} />} w={320}
            value={search} onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={search ? <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setSearch('')}><IconX size={14} /></ActionIcon> : null} />
        </Group>
        {isError ? <ErrorState onRetry={() => refetch()} /> : (
          <Table.ScrollContainer minWidth={1000}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Job ID</Table.Th><Table.Th>User</Table.Th><Table.Th>Date / time</Table.Th><Table.Th>XML files</Table.Th>
                  <Table.Th>POS</Table.Th><Table.Th>Successful</Table.Th><Table.Th>Failed</Table.Th><Table.Th>Progress</Table.Th>
                  <Table.Th>Duration</Table.Th><Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {isLoading ? <LoadingRows cols={10} /> : data?.items.map((j) => (
                  <Table.Tr key={j.id} className="pcc-row-click" onClick={() => nav(`/deployments/jobs/${j.id}`)}>
                    <Table.Td><Text fw={700} size="sm">#{j.id}</Text><Text size="xs" c="dimmed" truncate maw={180}>{j.filename}</Text></Table.Td>
                    <Table.Td><Text size="sm">{j.uploaded_by_username ?? '—'}</Text></Table.Td>
                    <Table.Td><Tooltip label={fromNow(j.created_at)}><Text size="sm">{fmtDate(j.created_at)}</Text></Tooltip></Table.Td>
                    <Table.Td>{j.file_count}</Table.Td>
                    <Table.Td>{j.total_devices}</Table.Td>
                    <Table.Td><Text size="sm" c="teal" fw={600}>{j.successful_devices}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={j.failed_devices ? 'red' : 'dimmed'} fw={600}>{j.failed_devices}</Text></Table.Td>
                    <Table.Td w={180}><MiniProgress total={j.total_devices} success={j.successful_devices} failed={j.failed_devices} running={j.running_devices} /></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{duration(j.started_at, j.completed_at)}</Text></Table.Td>
                    <Table.Td><StatusBadge status={j.status} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {!isLoading && data?.items.length === 0 && <EmptyState title={q ? 'No jobs match your search' : m.empty} />}
        {data && data.total > 0 && <TableFooter page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} />}
      </Card>
    </>
  );
}
