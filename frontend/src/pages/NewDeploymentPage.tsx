import {
  ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, List, Loader, Progress, Stack, Stepper, Table, Text, ThemeIcon, Tooltip,
} from '@mantine/core';
import { Dropzone, type FileRejection } from '@mantine/dropzone';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowRight, IconCircleCheck, IconCircleX, IconCloudUpload, IconFileCode, IconPlayerPlay,
  IconQuestionMark, IconRefresh, IconTrash, IconWifi, IconWifiOff, IconUpload, IconX,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import type { Job, PosRef, UploadBatch } from '@/api/types';
import { PERMS, useAuth } from '@/auth/AuthContext';
import PageHeader from '@/components/PageHeader';
import PosSelect from '@/components/PosSelect';
import { bytes } from '@/utils/format';

const MAX_MB = 5;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.xml$/i;
interface Row { selected: boolean; pos: PosRef | null }

const MATCH_LABEL: Record<string, { label: string; color: string }> = {
  filename: { label: 'by filename', color: 'teal' },
  mac: { label: 'by MAC address', color: 'cyan' },
  content: { label: 'by XML content', color: 'blue' },
  manual: { label: 'manual', color: 'grape' },
};

export default function NewDeploymentPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [staged, setStaged] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [starting, setStarting] = useState(false);
  const [posReach, setPosReach] = useState<Record<number, { online: boolean; last_seen: string | null }>>({});
  const [reachChecking, setReachChecking] = useState(false);
  const [reachCheckedAt, setReachCheckedAt] = useState<string | null>(null);

  const targetIds = useMemo(
    () => Array.from(new Set(Object.values(rows).map((r) => r.pos?.id).filter((x): x is number => !!x))).sort((a, b) => a - b),
    [rows],
  );
  const checkReachability = async (ids: number[] = targetIds) => {
    if (!ids.length) return;
    setReachChecking(true);
    try {
      const { data } = await api.post<{ checked_at: string; results: Record<string, { online: boolean; last_seen: string | null }> }>(
        '/pos/reachability', { ids });
      setPosReach((cur) => {
        const next = { ...cur };
        Object.entries(data.results).forEach(([k, v]) => { next[Number(k)] = v; });
        return next;
      });
      setReachCheckedAt(data.checked_at);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Status check failed', message: errorMessage(e) });
    } finally {
      setReachChecking(false);
    }
  };
  // check automatically after upload and whenever a target POS is changed
  const targetKey = targetIds.join(',');
  useEffect(() => {
    const missing = targetIds.filter((i) => !(i in posReach));
    if (missing.length) void checkReachability(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const addFiles = (files: File[]) => {
    const bad: string[] = [];
    setStaged((cur) => {
      const names = new Set(cur.map((f) => f.name.toLowerCase()));
      const next = [...cur];
      for (const f of files) {
        if (!NAME_RE.test(f.name)) { bad.push(`${f.name}: invalid name or not .xml`); continue; }
        if (f.size > MAX_MB * 1024 * 1024) { bad.push(`${f.name}: larger than ${MAX_MB} MB`); continue; }
        if (names.has(f.name.toLowerCase())) { bad.push(`${f.name}: duplicate`); continue; }
        names.add(f.name.toLowerCase());
        next.push(f);
      }
      return next;
    });
    if (bad.length) notifications.show({ color: 'orange', title: `${bad.length} file(s) skipped`, message: bad.slice(0, 4).join('\n') });
  };
  const onReject = (r: FileRejection[]) =>
    notifications.show({ color: 'red', title: 'Files rejected', message: r.slice(0, 4).map((x) => `${x.file.name}: ${x.errors[0]?.message}`).join('\n') });

  const upload = async () => {
    setUploading(true);
    setProgress(0);
    try {
      const fd = new FormData();
      staged.forEach((f) => fd.append('files', f, f.name));
      const { data } = await api.post<UploadBatch>('/deployments/uploads', fd, {
        onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      const initial: Record<number, Row> = {};
      data.files.forEach((f) => { initial[f.id] = { selected: f.is_valid && !!f.matched_pos && !f.busy, pos: f.matched_pos }; });
      setBatch(data);
      setRows(initial);
      setStaged([]);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Upload failed', message: errorMessage(e) });
    } finally {
      setUploading(false);
    }
  };

  const discard = async () => {
    if (batch) {
      try { await api.delete(`/deployments/uploads/${batch.batch_id}`); } catch { /* already cleaned */ }
    }
    setBatch(null);
    setRows({});
  };

  const files = batch?.files ?? [];
  const stats = useMemo(() => {
    const valid = files.filter((f) => f.is_valid).length;
    const matched = files.filter((f) => f.is_valid && rows[f.id]?.pos).length;
    const chosen = files.filter((f) => f.is_valid && rows[f.id]?.selected && rows[f.id]?.pos);
    const counts = new Map<number, number>();
    chosen.forEach((f) => { const id = rows[f.id].pos!.id; counts.set(id, (counts.get(id) ?? 0) + 1); });
    const dupes = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
    return { valid, invalid: files.length - valid, matched, unmatched: valid - matched, chosen, dupes };
  }, [files, rows]);

  const setRow = (id: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const selectable = files.filter((f) => f.is_valid && rows[f.id]?.pos);
  const allSelected = selectable.length > 0 && selectable.every((f) => rows[f.id].selected);
  const toggleAll = () => setRows((r) => {
    const n = { ...r };
    selectable.forEach((f) => { n[f.id] = { ...n[f.id], selected: !allSelected }; });
    return n;
  });

  const start = () => {
    const chosen = stats.chosen;
    modals.openConfirmModal({
      title: 'Start deployment',
      children: (
        <Stack gap="xs">
          {chosen.some((f) => posReach[rows[f.id].pos!.id]?.online === false) && (
            <Alert color="orange" icon={<IconWifiOff size={16} />} p="xs">
              Offline: <b>{chosen.filter((f) => posReach[rows[f.id].pos!.id]?.online === false).map((f) => rows[f.id].pos!.hostname).join(', ')}</b>.
              These POS will most likely fail with &quot;unreachable&quot;. You can untick them or deploy anyway.
            </Alert>
          )}
          <Text size="sm">Deploy <b>{chosen.length}</b> XML file(s) to <b>{chosen.length}</b> POS device(s) using the configured Ansible playbook?</Text>
          <List size="sm" spacing={2}>
            {chosen.slice(0, 8).map((f) => <List.Item key={f.id}>{f.original_filename} → <b>{rows[f.id].pos!.hostname}</b> ({rows[f.id].pos!.ip_address})</List.Item>)}
            {chosen.length > 8 && <List.Item>…and {chosen.length - 8} more</List.Item>}
          </List>
        </Stack>
      ),
      labels: { confirm: 'Start deployment', cancel: 'Cancel' },
      onConfirm: async () => {
        setStarting(true);
        try {
          const { data } = await api.post<Job>('/deployments', {
            batch_id: batch!.batch_id,
            items: chosen.map((f) => ({ file_id: f.id, pos_id: rows[f.id].pos!.id })),
          });
          qc.invalidateQueries({ queryKey: ['jobs'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          notifications.show({ color: 'blue', title: `Deployment #${data.id} queued`, message: `${data.total_devices} POS targeted` });
          nav(`/deployments/jobs/${data.id}`);
        } catch (e) {
          notifications.show({ color: 'red', title: 'Could not start deployment', message: errorMessage(e) });
        } finally {
          setStarting(false);
        }
      },
    });
  };

  const canRun = can(PERMS.JOBS_RUN);

  return (
    <>
      <PageHeader title="XML Deployment" subtitle="Upload POS XML configuration files, verify the target devices, then deploy through Ansible."
        crumbs={[{ label: 'Deployments', to: '/deployments/history' }, { label: 'New deployment' }]} />

      <Card mb="md" py="md">
        <Stepper active={batch ? 1 : 0} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Upload" description="Drop XML files" />
          <Stepper.Step label="Review & match" description="Verify target POS" />
          <Stepper.Step label="Deploy" description="Run via Ansible" />
        </Stepper>
      </Card>

      {!batch && (
        <Card>
          <Dropzone onDrop={addFiles} onReject={onReject} multiple maxSize={MAX_MB * 1024 * 1024} loading={uploading}
            accept={{ 'text/xml': ['.xml'], 'application/xml': ['.xml'] }} className="pcc-dropzone" radius="lg">
            <Stack align="center" justify="center" mih={220} gap="xs" style={{ pointerEvents: 'none' }}>
              <Dropzone.Accept><IconUpload size={56} stroke={1.3} color="var(--mantine-color-brand-6)" /></Dropzone.Accept>
              <Dropzone.Reject><IconX size={56} stroke={1.3} color="var(--mantine-color-red-6)" /></Dropzone.Reject>
              <Dropzone.Idle><IconCloudUpload size={56} stroke={1.3} color="var(--mantine-color-dimmed)" /></Dropzone.Idle>
              <Text fz="xl" fw={600}>Drag & drop XML files here</Text>
              <Text c="dimmed" size="sm">or click to browse · .xml only · up to {MAX_MB} MB each · name files after the POS (e.g. POS001.xml)</Text>
            </Stack>
          </Dropzone>

          {staged.length > 0 && (
            <>
              <Group justify="space-between" mt="lg" mb="xs">
                <Text fw={600}>{staged.length} file(s) ready to validate</Text>
                <Button variant="subtle" color="gray" size="xs" onClick={() => setStaged([])}>Clear all</Button>
              </Group>
              <Table>
                <Table.Tbody>
                  {staged.map((f) => (
                    <Table.Tr key={f.name}>
                      <Table.Td w={30}><IconFileCode size={18} color="var(--mantine-color-brand-6)" /></Table.Td>
                      <Table.Td><Text size="sm" fw={500}>{f.name}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{bytes(f.size)}</Text></Table.Td>
                      <Table.Td ta="right"><ActionIcon variant="subtle" color="gray" aria-label="Remove"
                        onClick={() => setStaged((s) => s.filter((x) => x !== f))}><IconTrash size={16} /></ActionIcon></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {uploading && <Progress value={progress} mt="md" animated />}
              <Group justify="flex-end" mt="md">
                <Button size="md" rightSection={<IconArrowRight size={18} />} loading={uploading} onClick={upload}>
                  Validate & continue
                </Button>
              </Group>
            </>
          )}
        </Card>
      )}

      {batch && (
        <Card p={0}>
          <Group p="md" justify="space-between" wrap="wrap">
            <Group gap="xs">
              <Badge size="lg" variant="light" color="gray">{files.length} files</Badge>
              <Badge size="lg" variant="light" color="teal">{stats.matched} matched</Badge>
              {stats.unmatched > 0 && <Badge size="lg" variant="light" color="orange">{stats.unmatched} unmatched</Badge>}
              {stats.invalid > 0 && <Badge size="lg" variant="light" color="red">{stats.invalid} invalid</Badge>}
            </Group>
            <Group gap="xs">
              {targetIds.length > 0 && (() => {
                const off = targetIds.filter((i) => posReach[i]?.online === false).length;
                const on = targetIds.filter((i) => posReach[i]?.online === true).length;
                return <>
                  {on > 0 && <Badge size="lg" variant="light" color="teal" leftSection={<IconWifi size={12} />}>{on} online</Badge>}
                  {off > 0 && <Badge size="lg" variant="light" color="red" leftSection={<IconWifiOff size={12} />}>{off} offline</Badge>}
                </>;
              })()}
              <Tooltip label={reachCheckedAt ? `Last checked ${new Date(reachCheckedAt).toLocaleTimeString()}` : 'Check POS reachability'}>
                <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} loading={reachChecking}
                  disabled={!targetIds.length} onClick={() => void checkReachability()}>Check status</Button>
              </Tooltip>
              <Button variant="subtle" color="gray" leftSection={<IconTrash size={16} />} onClick={discard}>Discard & start over</Button>
            </Group>
          </Group>
          {stats.dupes.size > 0 && (
            <Alert color="orange" mx="md" mb="md" icon={<IconAlertTriangle size={18} />}>
              The same POS is selected for more than one file. Each POS can only receive one XML file per deployment.
            </Alert>
          )}
          <Table.ScrollContainer minWidth={900}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}><Checkbox checked={allSelected} indeterminate={!allSelected && stats.chosen.length > 0} onChange={toggleAll} aria-label="Select all" /></Table.Th>
                  <Table.Th>XML file</Table.Th><Table.Th>Validation</Table.Th><Table.Th>Target POS</Table.Th>
                  <Table.Th>IP address</Table.Th><Table.Th>POS status</Table.Th><Table.Th>Store</Table.Th><Table.Th>Size</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {files.map((f) => {
                  const row = rows[f.id] ?? { selected: false, pos: null };
                  const dup = row.selected && row.pos && stats.dupes.has(row.pos.id);
                  return (
                    <Table.Tr key={f.id} bg={dup ? 'var(--mantine-color-orange-light)' : undefined}>
                      <Table.Td>
                        <Checkbox disabled={!f.is_valid || !row.pos} checked={row.selected && !!row.pos}
                          onChange={(e) => setRow(f.id, { selected: e.currentTarget.checked })} aria-label={`Select ${f.original_filename}`} />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={8} wrap="nowrap">
                          <IconFileCode size={18} color="var(--mantine-color-brand-6)" />
                          <div>
                            <Text size="sm" fw={600}>{f.original_filename}</Text>
                            {f.root_element && <Text size="xs" c="dimmed">&lt;{f.root_element}&gt;{f.sha256 && ` · ${f.sha256.slice(0, 12)}…`}</Text>}
                          </div>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {f.is_valid ? (
                          <Group gap={4} wrap="nowrap"><ThemeIcon size={18} radius="xl" color="teal" variant="light"><IconCircleCheck size={13} /></ThemeIcon><Text size="sm" c="teal">Valid XML</Text></Group>
                        ) : (
                          <Tooltip label={f.validation_error} multiline w={320}>
                            <Group gap={4} wrap="nowrap"><ThemeIcon size={18} radius="xl" color="red" variant="light"><IconCircleX size={13} /></ThemeIcon>
                              <Text size="sm" c="red" truncate maw={220}>{f.validation_error}</Text></Group>
                          </Tooltip>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {f.is_valid ? (
                          <Stack gap={4}>
                            <PosSelect value={row.pos} disabled={!canRun}
                              onChange={(p) => setRow(f.id, { pos: p, selected: !!p })} />
                            <Group gap={4}>
                              {row.pos && f.matched_pos && row.pos.id === f.matched_pos.id && f.match_method ? (
                                <Badge size="xs" variant="dot" color={MATCH_LABEL[f.match_method].color}>matched {MATCH_LABEL[f.match_method].label}</Badge>
                              ) : row.pos ? <Badge size="xs" variant="dot" color="grape">manual</Badge>
                                : <Badge size="xs" variant="light" color="orange" leftSection={<IconQuestionMark size={10} />}>no match</Badge>}
                              {f.busy && <Badge size="xs" color="orange" variant="light">deployment in progress</Badge>}
                            </Group>
                          </Stack>
                        ) : <Text size="sm" c="dimmed">—</Text>}
                      </Table.Td>
                      <Table.Td><Text size="sm" ff="monospace">{row.pos?.ip_address ?? '—'}</Text></Table.Td>
                      <Table.Td>
                        {!row.pos ? <Text size="sm" c="dimmed">—</Text>
                          : !(row.pos.id in posReach) ? (reachChecking ? <Group gap={6}><Loader size={12} /><Text size="xs" c="dimmed">Checking…</Text></Group> : <Text size="sm" c="dimmed">—</Text>)
                          : posReach[row.pos.id].online
                            ? <Badge color="teal" variant="light" leftSection={<IconWifi size={12} />}>Online</Badge>
                            : <Tooltip label={posReach[row.pos.id].last_seen ? `Last seen ${new Date(posReach[row.pos.id].last_seen!).toLocaleString()}` : 'Never seen online'}>
                                <Badge color="red" variant="light" leftSection={<IconWifiOff size={12} />}>Offline</Badge>
                              </Tooltip>}
                      </Table.Td>
                      <Table.Td><Text size="sm">{row.pos?.store_name ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{f.size_bytes ? bytes(f.size_bytes) : '—'}</Text></Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group justify="space-between" p="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Text size="sm" c="dimmed"><b>{stats.chosen.length}</b> of {files.length} files selected for deployment</Text>
            {canRun ? (
              <Button size="md" leftSection={<IconPlayerPlay size={18} />} loading={starting}
                disabled={stats.chosen.length === 0 || stats.dupes.size > 0} onClick={start}>
                Start deployment ({stats.chosen.length})
              </Button>
            ) : <Text size="sm" c="orange">Your role can upload but not run deployments.</Text>}
          </Group>
        </Card>
      )}
    </>
  );
}
