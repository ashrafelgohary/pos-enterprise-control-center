import { Alert, Badge, Button, Card, Grid, Group, ScrollArea, SimpleGrid, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCloudUpload, IconEdit } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePos, usePosHistory } from '@/api/hooks';
import { PERMS, useAuth } from '@/auth/AuthContext';
import PageHeader from '@/components/PageHeader';
import PosFormModal from '@/components/PosFormModal';
import ResultDrawer from '@/components/ResultDrawer';
import StatusBadge from '@/components/StatusBadge';
import TableFooter from '@/components/TableFooter';
import { EmptyState, ErrorState } from '@/components/States';
import { duration, fmtDate, fromNow } from '@/utils/format';

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '.05em' }}>{label}</Text>
      <Text size="sm" fw={500} mt={4} component="div">{children}</Text>
    </div>
  );
}

export default function PosDetailPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(false);
  const [resultId, setResultId] = useState<number | null>(null);
  const { data: pos, isLoading, isError, error, refetch } = usePos(id);
  const history = usePosHistory(id, page);

  if (isError) {
    const notFound = (error as { response?: { status?: number } })?.response?.status === 404;
    return <ErrorState title={notFound ? 'POS not found' : undefined} onRetry={notFound ? undefined : () => refetch()} />;
  }
  const latest = history.data?.items[0];

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'POS Management', to: '/pos' }, { label: pos?.hostname ?? '…' }]}
        title={<Group gap="sm">{pos?.hostname ?? <Skeleton h={28} w={160} />}{pos && <StatusBadge status={pos.status} size="md" />}</Group>}
        subtitle={pos ? `${pos.store_name}${pos.brand ? ' · ' + pos.brand : ''}` : undefined}
        actions={<>
          {can(PERMS.POS_WRITE) && <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEdit(true)} disabled={!pos}>Edit</Button>}
          {can(PERMS.XML_UPLOAD) && <Button leftSection={<IconCloudUpload size={16} />} onClick={() => nav('/deployments/new')}>Deploy XML</Button>}
        </>}
      />

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card h="100%">
            <Title order={5} mb="md">Device information</Title>
            {isLoading || !pos ? <Stack>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={34} />)}</Stack> : (
              <SimpleGrid cols={2} spacing="lg">
                <Info label="Hostname">{pos.hostname}</Info>
                <Info label="Status"><StatusBadge status={pos.status} /></Info>
                <Info label="IP address"><Text ff="monospace" size="sm">{pos.ip_address}</Text></Info>
                <Info label="MAC address"><Text ff="monospace" size="sm">{pos.mac_address ?? '—'}</Text></Info>
                <Info label="Store">{pos.store_name}</Info>
                <Info label="Brand">{pos.brand ?? '—'}</Info>
                <Info label="Last seen">{fromNow(pos.last_seen)}</Info>
                <Info label="Last deployment">{fmtDate(pos.last_deployment_at)}</Info>
                <Info label="Registered">{fmtDate(pos.created_at)}</Info>
                <Info label="Updated">{fmtDate(pos.updated_at)}</Info>
              </SimpleGrid>
            )}
            {pos?.notes && <Alert mt="lg" variant="light" color="gray" title="Notes"><Text size="sm">{pos.notes}</Text></Alert>}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card h="100%">
            <Group justify="space-between" mb="sm">
              <Title order={5}>Latest Ansible output</Title>
              {latest && <Group gap="xs"><Badge variant="outline" color="gray">Job #{latest.job_id}</Badge><StatusBadge status={latest.status} /></Group>}
            </Group>
            {!latest ? <EmptyState title="No deployments yet" message="This POS has not received any XML deployment." /> : (
              <Stack gap="sm">
                <Text size="xs" c="dimmed">{latest.xml_filename} · {fmtDate(latest.completed_at ?? latest.started_at)} · {duration(latest.started_at, latest.completed_at)}</Text>
                {latest.error_message && <Alert color="red" icon={<IconAlertTriangle size={16} />} p="xs">
                  <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>{latest.error_message}</Text></Alert>}
                <ScrollArea h={240} className="pcc-terminal" style={{ borderRadius: 10 }} p="sm">
                  <pre className="pcc-terminal" style={{ margin: 0 }}>{latest.output || 'No output captured.'}</pre>
                </ScrollArea>
              </Stack>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={12}>
          <Card p={0}>
            <Title order={5} p="md">Deployment history</Title>
            {history.data && history.data.total === 0 ? <EmptyState title="No deployment history" /> : (
              <Table.ScrollContainer minWidth={760}>
                <Table>
                  <Table.Thead><Table.Tr>
                    <Table.Th>Job</Table.Th><Table.Th>XML file</Table.Th><Table.Th>Status</Table.Th><Table.Th>Attempt</Table.Th>
                    <Table.Th>Started</Table.Th><Table.Th>Duration</Table.Th><Table.Th>Error</Table.Th>
                  </Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {history.data?.items.map((r) => (
                      <Table.Tr key={r.id} className="pcc-row-click" onClick={() => setResultId(r.id)}>
                        <Table.Td><Text component={Link} to={`/deployments/jobs/${r.job_id}`} size="sm" fw={600} c="brand" onClick={(e) => e.stopPropagation()}>#{r.job_id}</Text></Table.Td>
                        <Table.Td><Text size="sm">{r.xml_filename}</Text></Table.Td>
                        <Table.Td><StatusBadge status={r.status} /></Table.Td>
                        <Table.Td>{r.attempt}</Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{fmtDate(r.started_at)}</Text></Table.Td>
                        <Table.Td>{duration(r.started_at, r.completed_at)}</Table.Td>
                        <Table.Td><Text size="xs" c="red" truncate maw={260}>{r.error_message ?? ''}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            {history.data && history.data.total > 10 && <TableFooter page={page} pageSize={10} total={history.data.total} onPage={setPage} />}
          </Card>
        </Grid.Col>
      </Grid>

      <PosFormModal opened={edit} onClose={() => setEdit(false)} pos={pos} />
      <ResultDrawer resultId={resultId} onClose={() => setResultId(null)} />
    </>
  );
}
