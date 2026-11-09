import { AreaChart, DonutChart } from '@mantine/charts';
import { Badge, Button, Card, Grid, Group, Progress, SimpleGrid, Stack, Table, Text, Timeline, Title } from '@mantine/core';
import {
  IconAlertTriangle, IconCircleCheck, IconClockHour4, IconCloudUpload, IconDeviceDesktop, IconRefresh, IconWifi, IconWifiOff,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '@/api/hooks';
import { PERMS, useAuth } from '@/auth/AuthContext';
import PageHeader from '@/components/PageHeader';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import { EmptyState, ErrorState } from '@/components/States';
import { describeAction, fromNow } from '@/utils/format';

export default function DashboardPage() {
  const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useDashboard();
  const { user, can } = useAuth();
  const nav = useNavigate();

  if (isError) return <ErrorState onRetry={() => refetch()} />;
  const pos = data?.pos;
  const jobs = data?.jobs;
  const availability = pos && pos.total ? Math.round((pos.online / pos.total) * 1000) / 10 : 0;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.full_name || user?.username}`}
        subtitle={`Fleet overview · updated ${dataUpdatedAt ? dayjs(dataUpdatedAt).format('HH:mm:ss') : '—'}`}
        actions={<>
          <Button variant="default" leftSection={<IconRefresh size={16} />} loading={isFetching} onClick={() => refetch()}>Refresh</Button>
          {can(PERMS.XML_UPLOAD) && <Button leftSection={<IconCloudUpload size={16} />} onClick={() => nav('/deployments/new')}>New deployment</Button>}
        </>}
      />

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 6 }} spacing="md">
        <StatCard label="Total POS" value={pos?.total} loading={isLoading} color="brand" icon={<IconDeviceDesktop size={22} />}
          hint={`${pos?.unknown ?? 0} unknown · ${pos?.maintenance ?? 0} maintenance`} onClick={() => nav('/pos')} />
        <StatCard label="Online POS" value={pos?.online} loading={isLoading} color="teal" icon={<IconWifi size={22} />}
          hint={`${availability}% availability`} onClick={() => nav('/pos/online')} />
        <StatCard label="Offline POS" value={pos?.offline} loading={isLoading} color="red" icon={<IconWifiOff size={22} />}
          hint="Unreachable on last health check" onClick={() => nav('/pos/offline')} />
        <StatCard label="Pending jobs" value={jobs?.pending} loading={isLoading} color="blue" icon={<IconClockHour4 size={22} />}
          hint={`${jobs?.running ?? 0} running now`} onClick={() => nav('/deployments/running')} />
        <StatCard label="Successful jobs" value={jobs?.successful} loading={isLoading} color="teal" icon={<IconCircleCheck size={22} />}
          hint={`${jobs?.partial ?? 0} partially successful`} onClick={() => nav('/deployments/history')} />
        <StatCard label="Failed jobs" value={jobs?.failed} loading={isLoading} color="orange" icon={<IconAlertTriangle size={22} />}
          hint="Require attention" onClick={() => nav('/deployments/failed')} />
      </SimpleGrid>

      <Grid mt="md" gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card h="100%">
            <Group justify="space-between" mb="md">
              <div>
                <Title order={4}>Deployment results</Title>
                <Text size="xs" c="dimmed">Per-POS outcomes, last 14 days</Text>
              </div>
              <Group gap="xs"><Badge color="teal" variant="dot">Success</Badge><Badge color="red" variant="dot">Failed</Badge></Group>
            </Group>
            <AreaChart h={260} data={data?.trend ?? []} dataKey="date" curveType="monotone" withLegend={false}
              series={[{ name: 'success', label: 'Success', color: 'teal.6' }, { name: 'failed', label: 'Failed', color: 'red.6' }]}
              xAxisProps={{ tickFormatter: (d: string) => dayjs(d).format('DD MMM') }} gridAxis="y" fillOpacity={0.25} />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card h="100%">
            <Title order={4}>POS availability</Title>
            <Text size="xs" c="dimmed" mb="md">Current reachability status</Text>
            <Group justify="center">
              <DonutChart size={180} thickness={22} withTooltip chartLabel={`${availability}%`} data={[
                { name: 'Online', value: pos?.online ?? 0, color: 'teal.6' },
                { name: 'Offline', value: pos?.offline ?? 0, color: 'red.6' },
                { name: 'Unknown', value: pos?.unknown ?? 0, color: 'gray.5' },
                { name: 'Maintenance', value: pos?.maintenance ?? 0, color: 'yellow.5' },
              ]} />
            </Group>
            <Stack gap={6} mt="md">
              {(data?.stores ?? []).slice(0, 4).map((s) => (
                <div key={s.store}>
                  <Group justify="space-between"><Text size="xs" fw={500} truncate maw="70%">{s.store}</Text>
                    <Text size="xs" c={s.offline ? 'red' : 'dimmed'}>{s.total - s.offline}/{s.total} online</Text></Group>
                  <Progress value={s.total ? ((s.total - s.offline) / s.total) * 100 : 0} color={s.offline ? 'orange' : 'teal'} size="sm" />
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card p={0}>
            <Group justify="space-between" p="md">
              <Title order={4}>Recent deployments</Title>
              <Button variant="subtle" size="xs" onClick={() => nav('/deployments/history')}>View all</Button>
            </Group>
            {data && data.recent_jobs.length === 0 ? (
              <EmptyState title="No deployments yet" message="Start your first XML deployment to see it here." />
            ) : (
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead><Table.Tr><Table.Th>Job</Table.Th><Table.Th>Files</Table.Th><Table.Th>User</Table.Th>
                    <Table.Th>Result</Table.Th><Table.Th>Status</Table.Th><Table.Th>When</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {data?.recent_jobs.map((j) => (
                      <Table.Tr key={j.id} className="pcc-row-click" onClick={() => nav(`/deployments/jobs/${j.id}`)}>
                        <Table.Td fw={600}>#{j.id}</Table.Td>
                        <Table.Td><Text size="sm" truncate maw={200}>{j.filename}</Text></Table.Td>
                        <Table.Td>{j.user ?? '—'}</Table.Td>
                        <Table.Td><Text size="sm"><Text span c="teal" fw={600}>{j.successful}</Text> / <Text span c="red" fw={600}>{j.failed}</Text> of {j.total}</Text></Table.Td>
                        <Table.Td><StatusBadge status={j.status} /></Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{fromNow(j.created_at)}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card h="100%">
            <Group justify="space-between" mb="md">
              <Title order={4}>Recent activity</Title>
              {can(PERMS.AUDIT_READ) && <Button variant="subtle" size="xs" onClick={() => nav('/admin/audit')}>Audit log</Button>}
            </Group>
            {data && data.activity.length === 0 ? <Text size="sm" c="dimmed">No activity yet.</Text> : (
              <Timeline bulletSize={12} lineWidth={2}>
                {data?.activity.slice(0, 8).map((a) => (
                  <Timeline.Item key={a.id} color={a.action.includes('fail') ? 'red' : a.action.startsWith('deployment') ? 'blue' : 'gray'}>
                    <Text size="sm"><b>{a.username ?? 'system'}</b> {describeAction(a.action)} <Text span c="dimmed">{a.target}</Text></Text>
                    <Text size="xs" c="dimmed">{fromNow(a.timestamp)}</Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}
