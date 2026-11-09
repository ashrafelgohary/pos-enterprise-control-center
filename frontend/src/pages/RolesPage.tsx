import { Badge, Card, Table, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconMinus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import PageHeader from '@/components/PageHeader';
import { ErrorState, LoadingRows } from '@/components/States';

interface RolesResp { roles: { name: string; permissions: string[] }[]; permissions: { key: string; label: string }[] }
const COLOR: Record<string, string> = { admin: 'red', operator: 'blue', viewer: 'gray' };

export default function RolesPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get<RolesResp>('/roles')).data });
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Roles are defined in code and versioned with the application. Assign roles on the Users page."
        crumbs={[{ label: 'Administration' }, { label: 'Roles' }]} />
      <Card p={0}>
        {isError ? <ErrorState onRetry={() => refetch()} /> : (
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Permission</Table.Th>
                {data?.roles.map((r) => <Table.Th key={r.name} ta="center"><Badge color={COLOR[r.name]} variant="light" tt="capitalize">{r.name}</Badge></Table.Th>)}
              </Table.Tr></Table.Thead>
              <Table.Tbody>
                {isLoading ? <LoadingRows cols={4} rows={8} /> : data?.permissions.map((p) => (
                  <Table.Tr key={p.key}>
                    <Table.Td><Text size="sm" fw={500}>{p.label}</Text><Text size="xs" c="dimmed" ff="monospace">{p.key}</Text></Table.Td>
                    {data.roles.map((r) => (
                      <Table.Td key={r.name} ta="center">
                        {r.permissions.includes(p.key)
                          ? <ThemeIcon size={22} radius="xl" color="teal" variant="light"><IconCheck size={14} /></ThemeIcon>
                          : <ThemeIcon size={22} radius="xl" color="gray" variant="subtle"><IconMinus size={14} /></ThemeIcon>}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </>
  );
}
