import {
  ActionIcon, Affix, Button, Card, Checkbox, Group, Menu, Paper, SegmentedControl, Select, Table, Text, TextInput, Tooltip, Transition,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconCloudUpload, IconDots, IconDownload, IconEdit, IconEye, IconFileImport, IconPlus, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadFile, errorMessage } from '@/api/client';
import { useDeletePos, useFacets, usePosList, type PosQuery } from '@/api/hooks';
import type { Pos, PosStatus } from '@/api/types';
import { PERMS, useAuth } from '@/auth/AuthContext';
import ImportPosModal from '@/components/ImportPosModal';
import PageHeader from '@/components/PageHeader';
import PosFormModal from '@/components/PosFormModal';
import SortTh from '@/components/SortTh';
import StatusBadge from '@/components/StatusBadge';
import TableFooter from '@/components/TableFooter';
import { EmptyState, ErrorState, LoadingRows } from '@/components/States';
import { fmtDate, fromNow } from '@/utils/format';

const TITLES: Record<string, string> = { online: 'Online POS', offline: 'Offline POS' };

export default function PosListPage({ fixedStatus }: { fixedStatus?: PosStatus }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string>(fixedStatus ?? '');
  const [store, setStore] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [sort, setSort] = useState('hostname');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Pos | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { setStatus(fixedStatus ?? ''); setPage(1); setSelected(new Set()); }, [fixedStatus]);
  useEffect(() => { setPage(1); }, [q, status, store, brand, pageSize]);

  const params: PosQuery = { q, status: status || undefined, store: store ?? undefined, brand: brand ?? undefined, sort, order, page, page_size: pageSize };
  const { data, isLoading, isError, refetch, isFetching } = usePosList(params);
  const facets = useFacets();
  const del = useDeletePos();

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((p) => selected.has(p.id));
  const someOnPage = items.some((p) => selected.has(p.id));
  const filtersActive = !!(q || (!fixedStatus && status) || store || brand);

  const onSort = (f: string) => {
    if (sort === f) setOrder(order === 'asc' ? 'desc' : 'asc');
    else { setSort(f); setOrder('asc'); }
  };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected((s) => {
    const n = new Set(s);
    if (allOnPage) items.forEach((p) => n.delete(p.id)); else items.forEach((p) => n.add(p.id));
    return n;
  });

  const confirmDelete = (ids: number[], label: string) => modals.openConfirmModal({
    title: 'Delete POS device' + (ids.length > 1 ? 's' : ''),
    children: <Text size="sm">Permanently delete <b>{label}</b>? Deployment history is kept but will no longer be linked to the device.</Text>,
    labels: { confirm: 'Delete', cancel: 'Cancel' },
    confirmProps: { color: 'red' },
    onConfirm: async () => {
      try {
        await del.mutateAsync(ids);
        setSelected((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
        notifications.show({ color: 'teal', title: 'Deleted', message: label });
      } catch (e) {
        notifications.show({ color: 'red', title: 'Delete failed', message: errorMessage(e) });
      }
    },
  });

  const exportCsv = async () => {
    try {
      await downloadFile('/pos/export', { q, status: status || undefined, store: store ?? undefined, brand: brand ?? undefined }, 'pos-devices.csv');
    } catch (e) {
      notifications.show({ color: 'red', title: 'Export failed', message: errorMessage(e) });
    }
  };

  const storeOptions = useMemo(() => facets.data?.stores ?? [], [facets.data]);

  return (
    <>
      <PageHeader
        title={fixedStatus ? TITLES[fixedStatus] : 'POS Management'}
        subtitle={`${data?.total ?? '…'} devices${filtersActive ? ' matching filters' : ''}`}
        crumbs={[{ label: 'POS Management', to: '/pos' }, ...(fixedStatus ? [{ label: TITLES[fixedStatus] }] : [])]}
        actions={<>
          {can(PERMS.POS_IMPORT) && <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={() => setImportOpen(true)}>Import</Button>}
          {can(PERMS.POS_IMPORT) && <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>Export</Button>}
          {can(PERMS.POS_WRITE) && <Button leftSection={<IconPlus size={16} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add POS</Button>}
        </>}
      />

      <Card p={0}>
        <Group p="md" gap="sm" wrap="wrap">
          <TextInput placeholder="Search hostname, IP, MAC, store…" leftSection={<IconSearch size={16} />} w={300}
            value={search} onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={search ? <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setSearch('')}><IconX size={14} /></ActionIcon> : null} />
          {!fixedStatus && (
            <SegmentedControl size="sm" value={status} onChange={setStatus} data={[
              { value: '', label: 'All' }, { value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' },
              { value: 'unknown', label: 'Unknown' }, { value: 'maintenance', label: 'Maint.' },
            ]} />
          )}
          <Select placeholder="All stores" data={storeOptions} value={store} onChange={setStore} clearable searchable w={210} />
          <Select placeholder="All brands" data={facets.data?.brands ?? []} value={brand} onChange={setBrand} clearable w={160} />
          {filtersActive && <Button variant="subtle" color="gray" onClick={() => { setSearch(''); if (!fixedStatus) setStatus(''); setStore(null); setBrand(null); }}>Clear filters</Button>}
        </Group>

        {isError ? <ErrorState onRetry={() => refetch()} /> : (
          <Table.ScrollContainer minWidth={900}>
            <Table style={{ opacity: isFetching && !isLoading ? 0.7 : 1 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}><Checkbox aria-label="Select page" checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={togglePage} /></Table.Th>
                  <SortTh field="hostname" sort={sort} order={order} onSort={onSort}>Hostname</SortTh>
                  <SortTh field="ip_address" sort={sort} order={order} onSort={onSort}>IP Address</SortTh>
                  <SortTh field="store_name" sort={sort} order={order} onSort={onSort}>Store</SortTh>
                  <SortTh field="brand" sort={sort} order={order} onSort={onSort}>Brand</SortTh>
                  <SortTh field="status" sort={sort} order={order} onSort={onSort}>Status</SortTh>
                  <SortTh field="last_seen" sort={sort} order={order} onSort={onSort}>Last Seen</SortTh>
                  <Table.Th w={70} ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {isLoading ? <LoadingRows cols={8} /> : items.map((p) => (
                  <Table.Tr key={p.id} className="pcc-row-click" bg={selected.has(p.id) ? 'var(--mantine-color-brand-light)' : undefined}
                    onClick={() => nav(`/pos/${p.id}`)}>
                    <Table.Td onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Select ${p.hostname}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></Table.Td>
                    <Table.Td><Text fw={600} size="sm">{p.hostname}</Text>{p.mac_address && <Text size="xs" c="dimmed" ff="monospace">{p.mac_address}</Text>}</Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{p.ip_address}</Text></Table.Td>
                    <Table.Td><Text size="sm">{p.store_name}</Text></Table.Td>
                    <Table.Td><Text size="sm" c={p.brand ? undefined : 'dimmed'}>{p.brand ?? '—'}</Text></Table.Td>
                    <Table.Td><StatusBadge status={p.status} /></Table.Td>
                    <Table.Td><Tooltip label={fmtDate(p.last_seen)}><Text size="sm" c="dimmed">{fromNow(p.last_seen)}</Text></Tooltip></Table.Td>
                    <Table.Td ta="right" onClick={(e) => e.stopPropagation()}>
                      <Menu position="bottom-end" withinPortal shadow="md">
                        <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="Actions"><IconDots size={18} /></ActionIcon></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconEye size={16} />} onClick={() => nav(`/pos/${p.id}`)}>View details</Menu.Item>
                          {can(PERMS.XML_UPLOAD) && <Menu.Item leftSection={<IconCloudUpload size={16} />} onClick={() => nav('/deployments/new')}>Deploy XML</Menu.Item>}
                          {can(PERMS.POS_WRITE) && <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => { setEditing(p); setFormOpen(true); }}>Edit</Menu.Item>}
                          {can(PERMS.POS_DELETE) && <><Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete([p.id], p.hostname)}>Delete</Menu.Item></>}
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <EmptyState title={filtersActive ? 'No POS match your filters' : 'No POS devices yet'}
            message={filtersActive ? 'Try adjusting the search or filters.' : 'Add devices one by one or import a CSV.'}
            action={!filtersActive && can(PERMS.POS_WRITE) ? <Button leftSection={<IconPlus size={16} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add POS</Button> : undefined} />
        )}
        {data && data.total > 0 && (
          <TableFooter page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} />
        )}
      </Card>

      <Affix position={{ bottom: 24, left: '50%' }} style={{ transform: 'translateX(-50%)' }}>
        <Transition mounted={selected.size > 0} transition="slide-up">
          {(styles) => (
            <Paper style={styles} shadow="xl" p="sm" px="md" withBorder>
              <Group gap="md">
                <Text size="sm" fw={600}>{selected.size} selected</Text>
                {can(PERMS.POS_DELETE) && <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />}
                  onClick={() => confirmDelete([...selected], `${selected.size} POS devices`)}>Delete</Button>}
                <Button size="xs" variant="subtle" color="gray" onClick={() => setSelected(new Set())}>Clear</Button>
              </Group>
            </Paper>
          )}
        </Transition>
      </Affix>

      <PosFormModal opened={formOpen} onClose={() => setFormOpen(false)} pos={editing} stores={storeOptions} />
      <ImportPosModal opened={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
