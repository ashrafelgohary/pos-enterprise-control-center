import { Alert, Badge, Button, Card, Code, Group, PasswordInput, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, Title, useMantineColorScheme } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconLock, IconPalette, IconServerCog, IconUser } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { PERMS, useAuth } from '@/auth/AuthContext';
import PageHeader from '@/components/PageHeader';

function ChangePassword() {
  const form = useForm({
    initialValues: { current_password: '', new_password: '', confirm: '' },
    validate: {
      current_password: (v) => (v ? null : 'Required'),
      new_password: (v) => (v.length >= 10 ? null : 'At least 10 characters with upper, lower, digit and symbol'),
      confirm: (v, all) => (v === all.new_password ? null : 'Passwords do not match'),
    },
  });
  const [busy, setBusy] = useState(false);
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password });
      notifications.show({ color: 'teal', title: 'Password changed', message: 'Other sessions have been signed out.' });
      form.reset();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Change failed', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  });
  return (
    <form onSubmit={submit}>
      <Stack maw={420}>
        <PasswordInput label="Current password" autoComplete="current-password" {...form.getInputProps('current_password')} />
        <PasswordInput label="New password" autoComplete="new-password" description="Min 10 chars · upper, lower, digit, symbol" {...form.getInputProps('new_password')} />
        <PasswordInput label="Confirm new password" autoComplete="new-password" {...form.getInputProps('confirm')} />
        <Group><Button type="submit" loading={busy}>Update password</Button></Group>
      </Stack>
    </form>
  );
}

interface SysInfo {
  app_name: string; environment: string; workers: string[];
  ansible: Record<string, unknown>; uploads: Record<string, unknown>; health_check: Record<string, unknown>;
}

function SystemInfo() {
  const { data, isLoading } = useQuery({ queryKey: ['system'], queryFn: async () => (await api.get<SysInfo>('/system/info')).data, refetchInterval: 15_000 });
  if (isLoading || !data) return <Text c="dimmed">Loading…</Text>;
  const row = (k: string, v: unknown) => (
    <Table.Tr key={k}><Table.Td w={220}><Text size="sm" c="dimmed">{k}</Text></Table.Td>
      <Table.Td><Code>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Code></Table.Td></Table.Tr>
  );
  return (
    <Stack>
      {data.workers.length === 0 && <Alert color="red" title="No deployment workers online">Jobs will stay pending until a worker is running.</Alert>}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card><Title order={6} mb="xs">Runtime</Title><Table><Table.Tbody>
          {row('Environment', data.environment)}
          <Table.Tr><Table.Td><Text size="sm" c="dimmed">Workers online</Text></Table.Td><Table.Td>
            <Group gap={4}>{data.workers.length ? data.workers.map((w) => <Badge key={w} color="teal" variant="dot">{w}</Badge>) : <Badge color="red">none</Badge>}</Group></Table.Td></Table.Tr>
          {Object.entries(data.uploads).map(([k, v]) => row(k, v))}
          {Object.entries(data.health_check).map(([k, v]) => row(`health_check.${k}`, v))}
        </Table.Tbody></Table></Card>
        <Card><Title order={6} mb="xs">Ansible integration</Title><Table><Table.Tbody>
          {Object.entries(data.ansible).map(([k, v]) => row(k, v))}
        </Table.Tbody></Table>
          <Text size="xs" c="dimmed" mt="sm">Configured via environment variables. Credentials are never exposed to the browser.</Text></Card>
      </SimpleGrid>
    </Stack>
  );
}

export default function SettingsPage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const tab = params.get('tab') ?? 'profile';
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, security and platform configuration" />
      <Card>
        <Tabs value={tab} onChange={(t) => setParams({ tab: t ?? 'profile' })}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="profile" leftSection={<IconUser size={16} />}>Profile</Tabs.Tab>
            <Tabs.Tab value="security" leftSection={<IconLock size={16} />}>Security</Tabs.Tab>
            <Tabs.Tab value="appearance" leftSection={<IconPalette size={16} />}>Appearance</Tabs.Tab>
            {can(PERMS.SYSTEM_READ) && <Tabs.Tab value="system" leftSection={<IconServerCog size={16} />}>System</Tabs.Tab>}
          </Tabs.List>
          <Tabs.Panel value="profile">
            <SimpleGrid cols={{ base: 1, sm: 2 }} maw={640}>
              <div><Text size="xs" c="dimmed">Username</Text><Text fw={600}>{user?.username}</Text></div>
              <div><Text size="xs" c="dimmed">Full name</Text><Text fw={600}>{user?.full_name ?? '—'}</Text></div>
              <div><Text size="xs" c="dimmed">Email</Text><Text fw={600}>{user?.email}</Text></div>
              <div><Text size="xs" c="dimmed">Role</Text><Badge tt="capitalize">{user?.role}</Badge></div>
            </SimpleGrid>
            <Text size="xs" c="dimmed" mt="lg">Permissions: {user?.permissions.join(', ')}</Text>
          </Tabs.Panel>
          <Tabs.Panel value="security"><ChangePassword /></Tabs.Panel>
          <Tabs.Panel value="appearance">
            <Text size="sm" mb="xs">Color scheme</Text>
            <SegmentedControl value={colorScheme} onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
              data={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'System' }]} />
          </Tabs.Panel>
          {can(PERMS.SYSTEM_READ) && <Tabs.Panel value="system"><SystemInfo /></Tabs.Panel>}
        </Tabs>
      </Card>
    </>
  );
}
