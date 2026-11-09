import { Button, Group, Modal, Select, SimpleGrid, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { errorMessage } from '@/api/client';
import { useSavePos } from '@/api/hooks';
import type { Pos, PosStatus } from '@/api/types';

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

interface Values { hostname: string; ip_address: string; mac_address: string; store_name: string; brand: string; notes: string; status: PosStatus }
const EMPTY: Values = { hostname: '', ip_address: '', mac_address: '', store_name: '', brand: '', notes: '', status: 'unknown' };

export default function PosFormModal({ opened, onClose, pos, stores }: {
  opened: boolean; onClose: () => void; pos?: Pos | null; stores?: string[];
}) {
  const save = useSavePos();
  const form = useForm<Values>({
    initialValues: EMPTY,
    validate: {
      hostname: (v) => (HOST_RE.test(v.trim()) ? null : 'Letters, digits, . _ - only (max 63)'),
      ip_address: (v) => (IPV4_RE.test(v.trim()) || v.includes(':') ? null : 'Enter a valid IP address'),
      mac_address: (v) => (!v.trim() || MAC_RE.test(v.trim()) ? null : 'Format aa:bb:cc:dd:ee:ff'),
      store_name: (v) => (v.trim() ? null : 'Store is required'),
    },
  });

  useEffect(() => {
    if (!opened) return;
    form.setValues(pos ? {
      hostname: pos.hostname, ip_address: pos.ip_address, mac_address: pos.mac_address ?? '', store_name: pos.store_name,
      brand: pos.brand ?? '', notes: pos.notes ?? '', status: pos.status,
    } : EMPTY);
    form.resetDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, pos]);

  const submit = form.onSubmit(async (v) => {
    const data = {
      hostname: v.hostname.trim(), ip_address: v.ip_address.trim(), mac_address: v.mac_address.trim() || null,
      store_name: v.store_name.trim(), brand: v.brand.trim() || null, notes: v.notes.trim() || null, status: v.status,
    };
    try {
      await save.mutateAsync({ id: pos?.id, data });
      notifications.show({ color: 'teal', title: pos ? 'POS updated' : 'POS added', message: data.hostname });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Save failed', message: errorMessage(e) });
    }
  });

  return (
    <Modal opened={opened} onClose={onClose} title={pos ? `Edit ${pos.hostname}` : 'Add POS device'} size="lg">
      <form onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Hostname" placeholder="POS001" withAsterisk data-autofocus {...form.getInputProps('hostname')} />
          <TextInput label="IP address" placeholder="10.148.101.11" withAsterisk {...form.getInputProps('ip_address')} />
          <TextInput label="MAC address" placeholder="00:1a:2b:3c:4d:5e" {...form.getInputProps('mac_address')} />
          <Select label="Status" data={[
            { value: 'unknown', label: 'Unknown (auto-detect)' }, { value: 'online', label: 'Online' },
            { value: 'offline', label: 'Offline' }, { value: 'maintenance', label: 'Maintenance (skip checks)' },
          ]} allowDeselect={false} {...form.getInputProps('status')} />
          <TextInput label="Store" placeholder="H&M City Stars" withAsterisk list="pcc-stores" {...form.getInputProps('store_name')} />
          <TextInput label="Brand / model" placeholder="HP Engage One" {...form.getInputProps('brand')} />
        </SimpleGrid>
        <datalist id="pcc-stores">{stores?.map((s) => <option key={s} value={s} />)}</datalist>
        <Textarea label="Notes" mt="sm" autosize minRows={2} maxLength={1000} {...form.getInputProps('notes')} />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{pos ? 'Save changes' : 'Add POS'}</Button>
        </Group>
      </form>
    </Modal>
  );
}
