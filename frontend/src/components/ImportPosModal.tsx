import { Alert, Button, Checkbox, Code, Group, List, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/api/client';
import type { ImportResult } from '@/api/types';

export default function ImportPosModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const qc = useQueryClient();

  const close = () => { setFile(null); setResult(null); setUpdate(false); onClose(); };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<ImportResult>('/pos/import', fd, { params: { update_existing: update } });
      setResult(data);
      qc.invalidateQueries({ queryKey: ['pos'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      notifications.show({ color: data.errors.length ? 'yellow' : 'teal', title: 'Import finished',
        message: `${data.created} created · ${data.updated} updated · ${data.skipped} skipped` });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Import failed', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title="Import POS devices" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Upload a UTF-8 CSV with header <Code>hostname,ip_address,mac_address,store_name,brand,notes</Code>.
          Required: hostname, ip_address, store_name.
        </Text>
        <Dropzone onDrop={(f) => { setFile(f[0] ?? null); setResult(null); }} maxFiles={1} maxSize={5 * 1024 * 1024}
          accept={{ 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] }} className="pcc-dropzone"
          onReject={() => notifications.show({ color: 'red', message: 'Only a single .csv file up to 5 MB' })}>
          <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
            {file ? <IconFileSpreadsheet size={40} stroke={1.4} /> : <IconUpload size={40} stroke={1.4} />}
            <div>
              <Text fw={600}>{file ? file.name : 'Drop CSV here or click to browse'}</Text>
              <Text size="sm" c="dimmed">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Max 5 MB'}</Text>
            </div>
          </Group>
        </Dropzone>
        <Checkbox label="Update existing devices (matched by hostname)" checked={update} onChange={(e) => setUpdate(e.currentTarget.checked)} />
        {result && (
          <Alert color={result.errors.length ? 'yellow' : 'teal'} title="Import result">
            <Text size="sm">{result.created} created · {result.updated} updated · {result.skipped} skipped · {result.errors.length} errors</Text>
            {result.errors.length > 0 && (
              <ScrollArea.Autosize mah={180} mt="xs">
                <List size="xs" spacing={2}>{result.errors.map((e, i) => <List.Item key={i}>{e}</List.Item>)}</List>
              </ScrollArea.Autosize>
            )}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>{result ? 'Close' : 'Cancel'}</Button>
          <Button onClick={run} loading={busy} disabled={!file}>Import</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
