import {
  ActionIcon, Avatar, Badge, Button, Card, Group, Menu, Modal, PasswordInput, Select, Stack, Switch, Table, Text, TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDots, IconEdit, IconKey, IconPlus, IconSearch, IconUserOff, IconUserCheck } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { useUsers } from '@/api/hooks';
import type { Role, User } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/components/PageHeader';
import TableFooter from '@/components/TableFooter';
import { ErrorState, LoadingRows } from '@/components/States';
import { fmtDate, fromNow } from '@/utils/format';

const ROLES = [
  { value: 'admin', label: 'Admin — full access' },
  { value: 'operator', label: 'Operator — manage POS & deploy' },
  { value: 'viewer', label: 'Viewer — read only' },
];
const ROLE_COLOR: Record<Role, string> = { admin: 'red', operator: 'blue', viewer: 'gray' };
const PW_HINT = 'Min 10 chars with upper, lower, digit and symbol';

function UserModal({ user, opened, onClose }: { user: User | null; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    initialValues: { username: '', email: '', full_name: '', role: 'viewer' as Role, password: '', is_active: true },
    validate: {
      username: (v) => (user || /^[A-Za-z0-9._-]{3,64}$/.test(v) ? null : '3–64 chars: letters, digits, . _ -'),
      email: (v) => (/^\S+@\S+$/.test(v) ? null : 'Invalid email'),
      password: (v) => (user || v.length >= 10 ? null : PW_HINT),
    },
  });
  useEffect(() => {
    if (!opened) return;
    form.setValues(user ? { username: user.username, email: user.email, full_name: user.full_name ?? '', role: user.role, password: '', is_active: user.is_active }
      : { username: '', email: '', full_name: '', role: 'viewer', password: '', is_active: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, user]);

  const save = useMutation({
    mutationFn: async (v: typeof form.values) => user
      ? api.patch(`/users/${user.id}`, { email: v.email, full_name: v.full_name || null, role: v.role, is_active: v.is_active })
      : api.post('/users', { username: v.username, email: v.email, full_name: v.full_name || null, role: v.role, password: v.password }),
    onSuccess: () => {
      notifications.show({ color: 'teal', title: user ? 'User updated' : 'User created', message: form.values.username });
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Save failed', message: errorMessage(e) }),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={user ? `Edit ${user.username}` : 'Create user'}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <TextInput label="Username" withAsterisk disabled={!!user} {...form.getInputProps('username')} />
          <TextInput label="Full name" {...form.getInputProps('full_name')} />
          <TextInput label="Email" withAsterisk {...form.getInputProps('email')} />
          <Select label="Role" data={ROLES} allowDeselect={false} {...form.getInputProps('role')} />
          {!user && <PasswordInput label="Initial password" description={PW_HINT} withAsterisk {...form.getInputProps('password')} />}
          {user && <Switch label="Account active" {...form.getInputProps('is_active', { type: 'checkbox' })} />}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{user ? 'Save' : 'Create user'}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${user!.id}/reset-password`, { new_password: pw }),
    onSuccess: () => { notifications.show({ color: 'teal', title: 'Password reset', message: `${user!.username} must sign in again` }); setPw(''); onClose(); },
    onError: (e) => notifications.show({ color: 'red', title: 'Reset failed', message: errorMessage(e) }),
  });
  return (
    <Modal opened={!!user} onClose={onClose} title={`Reset password · ${user?.username ?? ''}`}>
      <Stack>
        <PasswordInput label="New password" description={PW_HINT} value={pw} onChange={(e) => setPw(e.currentTarget.value)} data-autofocus />
        <Text size="xs" c="dimmed">All active sessions of this user will be signed out.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="orange" disabled={pw.length < 10} loading={reset.isPending} onClick={() => reset.mutate()}>Reset password</Button></Group>
      </Stack>
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const { data, isLoading, isError, refetch } = useUsers({ q, page, page_size: 25 });

  const toggleActive = (u: User) => modals.openConfirmModal({
    title: u.is_active ? 'Deactivate user' : 'Activate user',
    children: <Text size="sm">{u.is_active ? `${u.username} will be signed out and unable to log in.` : `${u.username} will be able to sign in again.`}</Text>,
    labels: { confirm: u.is_active ? 'Deactivate' : 'Activate', cancel: 'Cancel' },
    confirmProps: { color: u.is_active ? 'red' : 'teal' },
    onConfirm: async () => {
      try {
        await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
        qc.invalidateQueries({ queryKey: ['users'] });
        notifications.show({ color: 'teal', message: `${u.username} ${u.is_active ? 'deactivated' : 'activated'}` });
      } catch (e) { notifications.show({ color: 'red', title: 'Failed', message: errorMessage(e) }); }
    },
  });

  return (
    <>
      <PageHeader title="Users" subtitle="Manage platform accounts and role assignments" crumbs={[{ label: 'Administration' }, { label: 'Users' }]}
        actions={<Button leftSection={<IconPlus size={16} />} onClick={() => { setEditing(null); setOpen(true); }}>Create user</Button>} />
      <Card p={0}>
        <Group p="md"><TextInput placeholder="Search users…" leftSection={<IconSearch size={16} />} w={300} value={search} onChange={(e) => { setSearch(e.currentTarget.value); setPage(1); }} /></Group>
        {isError ? <ErrorState onRetry={() => refetch()} /> : (
          <Table.ScrollContainer minWidth={820}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>User</Table.Th><Table.Th>Role</Table.Th><Table.Th>Status</Table.Th>
                <Table.Th>Last login</Table.Th><Table.Th>Created</Table.Th><Table.Th ta="right">Actions</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {isLoading ? <LoadingRows cols={6} rows={5} /> : data?.items.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td><Group gap="sm" wrap="nowrap"><Avatar size={34} radius="xl" color={ROLE_COLOR[u.role]}>{u.username.slice(0, 2).toUpperCase()}</Avatar>
                      <div><Text size="sm" fw={600}>{u.full_name || u.username} {u.id === me?.id && <Badge size="xs" variant="outline">you</Badge>}</Text>
                        <Text size="xs" c="dimmed">{u.username} · {u.email}</Text></div></Group></Table.Td>
                    <Table.Td><Badge color={ROLE_COLOR[u.role]} variant="light" tt="capitalize">{u.role}</Badge></Table.Td>
                    <Table.Td>{u.is_active ? <Badge color="teal" variant="dot">Active</Badge> : <Badge color="gray" variant="dot">Disabled</Badge>}</Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{fromNow(u.last_login_at)}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{fmtDate(u.created_at)}</Text></Table.Td>
                    <Table.Td ta="right">
                      <Menu position="bottom-end" shadow="md">
                        <Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={18} /></ActionIcon></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => { setEditing(u); setOpen(true); }}>Edit</Menu.Item>
                          <Menu.Item leftSection={<IconKey size={16} />} onClick={() => setResetting(u)}>Reset password</Menu.Item>
                          {u.id !== me?.id && <Menu.Item color={u.is_active ? 'red' : 'teal'} leftSection={u.is_active ? <IconUserOff size={16} /> : <IconUserCheck size={16} />}
                            onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</Menu.Item>}
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data && data.total > 25 && <TableFooter page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <UserModal user={editing} opened={open} onClose={() => setOpen(false)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}
