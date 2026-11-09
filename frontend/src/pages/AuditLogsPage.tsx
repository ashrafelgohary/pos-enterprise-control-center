import { ActionIcon, Badge, Button, Card, Code, Group, Popover, Select, Table, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconBraces, IconCalendar, IconDownload, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { api, downloadFile, errorMessage } from '@/api/client';
import { useAudit } from '@/api/hooks';
import PageHeader from '@/components/PageHeader';
import TableFooter from '@/components/TableFooter';
import { EmptyState, ErrorState, LoadingRows } from '@/components/States';
import { describeAction, fmtDateSec } from '@/utils/format';

const CAT_COLOR: Record<string, string> = { auth: 'gray', user: 'grape', pos: 'cyan', xml: 'indigo', deployment: 'blue' };
const actionColor = (a: string) => (a.includes('fail') ? 'red' : CAT_COLOR[a.split('.')[0]] ?? 'gray');

export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [action, setAction] = useState<string | null>(null);
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  useEffect(() => setPage(1), [q, action, range, pageSize]);

  const params = {
    q, action: action ?? undefined,
    date_from: range[0] ? dayjs(range[0]).startOf('day').toISOString() : undefined,
    date_to: range[1] ? dayjs(range[1]).endOf('day').toISOString() : undefined,
    page, page_size: pageSize,
  };
  const { data, isLoading, isError, refetch } = useAudit(params);
  const actions = useQuery({ queryKey: ['audit', 'actions'], queryFn: async () => (await api.get<string[]>('/audit-logs/actions')).data });

  const exportCsv = async () => {
    try { await downloadFile('/audit-logs/export', { ...params, page: undefined, page_size: undefined }, 'audit-log.csv'); }
    catch (e) { notifications.show({ color: 'red', title: 'Export failed', message: errorMessage(e) }); }
  };

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Immutable record of every security-relevant and operational action"
        crumbs={[{ label: 'Administration' }, { label: 'Audit Logs' }]}
        actions={<Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Export CSV</Button>} />
      <Card p={0}>
        <Group p="md" gap="sm" wrap="wrap">
          <TextInput placeholder="Search user, target, action…" leftSection={<IconSearch size={16} />} w={280} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select placeholder="All actions" clearable searchable w={230} value={action} onChange={setAction} data={actions.data ?? []} />
          <DatePickerInput type="range" placeholder="Date range" clearable w={260} value={range} onChange={setRange}
            leftSection={<IconCalendar size={16} />} maxDate={new Date()} />
        </Group>
        {isError ? <ErrorState onRetry={() => refetch()} /> : (
          <Table.ScrollContainer minWidth={960}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th w={190}>Timestamp</Table.Th><Table.Th>User</Table.Th><Table.Th>Action</Table.Th>
                <Table.Th>Target</Table.Th><Table.Th>IP</Table.Th><Table.Th w={70}>Details</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {isLoading ? <LoadingRows cols={6} /> : data?.items.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td><Text size="sm" ff="monospace">{fmtDateSec(a.timestamp)}</Text></Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{a.username ?? 'system'}</Text></Table.Td>
                    <Table.Td><Badge variant="light" color={actionColor(a.action)}>{a.action}</Badge>
                      <Text size="xs" c="dimmed" mt={2}>{describeAction(a.action)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{a.target ?? '—'}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed" ff="monospace">{a.ip_address ?? '—'}</Text></Table.Td>
                    <Table.Td>
                      {a.details && Object.keys(a.details).length > 0 ? (
                        <Popover width={440} position="left" shadow="md" withArrow>
                          <Popover.Target><ActionIcon variant="subtle" aria-label="Show details"><IconBraces size={16} /></ActionIcon></Popover.Target>
                          <Popover.Dropdown><Code block style={{ maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(a.details, null, 2)}</Code></Popover.Dropdown>
                        </Popover>
                      ) : <Text size="xs" c="dimmed">—</Text>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {!isLoading && data?.items.length === 0 && <EmptyState title="No audit entries match" />}
        {data && data.total > 0 && <TableFooter page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} sizes={[50, 100, 200]} />}
      </Card>
    </>
  );
}
