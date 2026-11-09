import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconDeviceDesktop,
  IconEdit,
  IconMail,
  IconPlus,
} from '@tabler/icons-react';

import { storeApi, type StoreDetails, type StoreListItem, type StorePOS, type StorePayload } from '../features/stores/storeApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyForm = { name: '', code: '', brand: '', email: '', additionalRecipients: '', isActive: true };
type StoreForm = typeof emptyForm;

function splitEmails(value: string): string[] {
  return value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

export default function StoreManagementPage() {
  const [stores, setStores] = useState<StoreListItem[]>([]);
  const [posTerminals, setPosTerminals] = useState<StorePOS[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpened, setFormOpened] = useState(false);
  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [details, setDetails] = useState<StoreDetails | null>(null);
  const [selectedPos, setSelectedPos] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [defaultCc, setDefaultCc] = useState('northafrica.support@alshaya.com');

  const load = async () => {
    setLoading(true);
    try {
      const [storeRows, posRows, settings] = await Promise.all([
        storeApi.list(search),
        storeApi.listPos(),
        storeApi.getSettings(),
      ]);
      setStores(storeRows);
      setPosTerminals(posRows);
      setDefaultCc(settings.default_cc.join('; '));
    } catch (error) {
      notifications.show({ color: 'red', title: 'Unable to load store management', message: error instanceof Error ? error.message : 'Unexpected error.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const posOptions = useMemo(() => posTerminals.map((pos) => ({ value: String(pos.id), label: `${pos.hostname}${pos.ip_address ? ` · ${pos.ip_address}` : ''}` })), [posTerminals]);
  const storeOptions = useMemo(() => [{ value: 'none', label: 'Unassigned' }, ...stores.map((store) => ({ value: String(store.id), label: `${store.name} · ${store.brand}` }))], [stores]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpened(true);
  };

  const openEdit = (store: StoreListItem) => {
    setEditingId(store.id);
    setForm({
      name: store.name,
      code: store.code ?? '',
      brand: store.brand,
      email: store.email ?? '',
      additionalRecipients: store.additional_recipients.join('; '),
      isActive: store.is_active,
    });
    setFormOpened(true);
  };

  const validate = (): string | null => {
    if (form.name.trim().length < 2) return 'Store name is required.';
    if (!form.brand.trim()) return 'Brand is required.';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) return 'Enter a valid store email address.';
    const invalidAdditional = splitEmails(form.additionalRecipients).find((email) => !EMAIL_RE.test(email));
    return invalidAdditional ? `Invalid additional recipient: ${invalidAdditional}` : null;
  };

  const saveStore = async () => {
    const validationError = validate();
    if (validationError) {
      notifications.show({ color: 'yellow', title: 'Check store details', message: validationError });
      return;
    }
    const payload: StorePayload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      brand: form.brand.trim(),
      email: form.email.trim() || null,
      additional_recipients: splitEmails(form.additionalRecipients),
      is_active: form.isActive,
    };
    setSaving(true);
    try {
      if (editingId) await storeApi.update(editingId, payload);
      else await storeApi.create(payload);
      notifications.show({ color: 'teal', message: editingId ? 'Store updated.' : 'Store created.' });
      setFormOpened(false);
      await load();
    } catch (error) {
      notifications.show({ color: 'red', title: 'Store was not saved', message: error instanceof Error ? error.message : 'Unexpected error.' });
    } finally {
      setSaving(false);
    }
  };

  const viewStore = async (id: number) => {
    try { setDetails(await storeApi.get(id)); }
    catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Unable to load store.' }); }
  };

  const assignPos = async () => {
    if (!selectedPos || !selectedStore) {
      notifications.show({ color: 'yellow', message: 'Select a POS terminal and a store.' });
      return;
    }
    setSaving(true);
    try {
      await storeApi.assignPos(Number(selectedPos), selectedStore === 'none' ? null : Number(selectedStore));
      notifications.show({ color: 'teal', message: 'POS store association updated.' });
      setSelectedPos(null);
      setSelectedStore(null);
      await load();
    } catch (error) {
      notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Unable to assign POS.' });
    } finally { setSaving(false); }
  };

  const saveCc = async () => {
    const values = splitEmails(defaultCc);
    const invalid = values.find((email) => !EMAIL_RE.test(email));
    if (invalid || values.length === 0) {
      notifications.show({ color: 'yellow', message: invalid ? `Invalid CC address: ${invalid}` : 'At least one CC address is required.' });
      return;
    }
    try {
      const saved = await storeApi.updateSettings(values);
      setDefaultCc(saved.default_cc.join('; '));
      notifications.show({ color: 'teal', message: 'Default notification CC updated.' });
    } catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Unable to update setting.' }); }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Store Management</Title>
          <Text c="dimmed" size="sm">Manage store notification addresses and POS relationships.</Text>
        </div>
        <Button leftSection={<IconPlus size={17} />} onClick={openCreate}>Add store</Button>
      </Group>

      <Card withBorder radius="md">
        <Group grow align="end">
          <Select searchable label="POS terminal" placeholder="Select terminal" data={posOptions} value={selectedPos} onChange={setSelectedPos} leftSection={<IconDeviceDesktop size={16} />} />
          <Select searchable label="Assign to store" placeholder="Select store" data={storeOptions} value={selectedStore} onChange={setSelectedStore} leftSection={<IconBuildingStore size={16} />} />
          <Button onClick={assignPos} loading={saving} disabled={!selectedPos || !selectedStore}>Update association</Button>
        </Group>
      </Card>

      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" mb="md">
          <TextInput placeholder="Search stores, brands, or codes" value={search} onChange={(e) => setSearch(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} style={{ flex: 1, maxWidth: 420 }} />
          <Button variant="default" onClick={() => void load()}>Search</Button>
        </Group>
        {loading ? <Group justify="center" py="xl"><Loader /></Group> : (
          <Table.ScrollContainer minWidth={850}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>Store</Table.Th><Table.Th>Brand</Table.Th><Table.Th>Notification email</Table.Th><Table.Th>POS</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {stores.map((store) => (
                  <Table.Tr key={store.id}>
                    <Table.Td><Text fw={600}>{store.name}</Text><Text size="xs" c="dimmed">{store.code || 'No store code'}</Text></Table.Td>
                    <Table.Td>{store.brand}</Table.Td>
                    <Table.Td>{store.email ? <Text size="sm">{store.email}</Text> : <Badge color="yellow" variant="light" leftSection={<IconAlertTriangle size={12} />}>Email required</Badge>}</Table.Td>
                    <Table.Td><Button variant="subtle" size="compact-sm" onClick={() => void viewStore(store.id)}>{store.pos_count} terminal{store.pos_count === 1 ? '' : 's'}</Button></Table.Td>
                    <Table.Td><Badge color={store.notification_ready ? 'teal' : 'gray'} variant="light">{store.notification_ready ? 'Notification ready' : 'Not ready'}</Badge></Table.Td>
                    <Table.Td><Button variant="subtle" size="compact-sm" leftSection={<IconEdit size={15} />} onClick={() => openEdit(store)}>Edit</Button></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <Card withBorder radius="md">
        <Group justify="space-between" align="end">
          <TextInput label="Default deployment email CC" description="Used for every successful Visa configuration notification." leftSection={<IconMail size={16} />} value={defaultCc} onChange={(event) => setDefaultCc(event.currentTarget.value)} style={{ flex: 1 }} />
          <Button variant="light" onClick={() => void saveCc()}>Save CC setting</Button>
        </Group>
      </Card>

      <Modal opened={formOpened} onClose={() => setFormOpened(false)} title={editingId ? 'Edit store' : 'Add store'} centered>
        <Stack>
          <TextInput required label="Store name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput label="Store code" value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} />
          <TextInput required label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.currentTarget.value })} />
          <TextInput type="email" label="Store email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
          {!form.email && <Alert color="yellow" icon={<IconAlertTriangle size={17} />}>Deployment will continue, but notification actions remain unavailable until a valid store email is configured.</Alert>}
          <TextInput label="Additional recipients" description="Separate addresses with a comma or semicolon." value={form.additionalRecipients} onChange={(e) => setForm({ ...form, additionalRecipients: e.currentTarget.value })} />
          <Switch label="Store is active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setFormOpened(false)}>Cancel</Button><Button loading={saving} onClick={() => void saveStore()}>Save store</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(details)} onClose={() => setDetails(null)} title={details?.name || 'Store POS terminals'} size="lg" centered>
        <Stack>
          <Group><Badge variant="light">{details?.brand}</Badge>{details?.email ? <Text size="sm">{details.email}</Text> : <Badge color="yellow">Email required</Badge>}</Group>
          <Divider />
          {details?.pos_terminals.length ? details.pos_terminals.map((pos) => (
            <Paper key={pos.id} withBorder p="sm" radius="sm"><Group justify="space-between"><div><Text fw={600}>{pos.hostname}</Text><Text size="xs" c="dimmed">{pos.ip_address || 'No IP'} · {pos.mac_address || 'No MAC'}</Text></div><IconDeviceDesktop size={19} /></Group></Paper>
          )) : <Text c="dimmed">No POS terminals are assigned to this store.</Text>}
        </Stack>
      </Modal>
    </Stack>
  );
}
