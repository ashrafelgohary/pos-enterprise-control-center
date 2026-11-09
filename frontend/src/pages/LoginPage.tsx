import { Alert, Divider, Box, Button, Card, Grid, Group, List, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconCircleCheck, IconLock, IconShieldLock, IconUser } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState<string | null>(new URLSearchParams(loc.search).get('sso_error'));
  const [sso, setSso] = useState<{ enabled: boolean; label: string; local_login: boolean } | null>(null);
  useEffect(() => { api.get('/auth/sso/config').then((r) => setSso(r.data)).catch(() => setSso(null)); }, []);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: { username: (v) => (v.trim() ? null : 'Required'), password: (v) => (v ? null : 'Required') },
  });

  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    setError(null);
    try {
      await login(v.username.trim(), v.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e, 'Sign-in failed'));
      form.setFieldValue('password', '');
    } finally {
      setBusy(false);
    }
  });

  return (
    <Grid gutter={0} mih="100vh" styles={{ inner: { minHeight: '100vh' } }}>
      <Grid.Col span={{ base: 12, md: 6 }} className="pcc-login-hero" visibleFrom="md">
        <Stack h="100%" justify="space-between" p={56}>
          <Group gap="lg" align="center">
            <img src="/alshaya-logo-white.png" alt="Alshaya Group" style={{ height: 64 }} />
            <div style={{ borderLeft: '1px solid rgba(255,255,255,.25)', paddingLeft: 16 }}>
              <Text fw={700} c="white">POS Control Center</Text>
              <Text size="xs" c="gray.5">Retail IT Infrastructure</Text>
            </div>
          </Group>
          <Box maw={460}>
            <Title order={1} c="white" fz={38} lh={1.15}>Centralized POS configuration management</Title>
            <Text c="gray.4" mt="md">Validate, deploy and audit XML configuration across every store — powered by your existing Ansible automation.</Text>
            <List mt="xl" spacing="sm" c="gray.3" icon={<ThemeIcon size={20} radius="xl" color="teal" variant="light"><IconCircleCheck size={14} /></ThemeIcon>}>
              <List.Item>Drag-and-drop multi-file XML deployments</List.Item>
              <List.Item>Real-time per-POS job tracking with retry</List.Item>
              <List.Item>Role-based access and immutable audit trail</List.Item>
            </List>
          </Box>
          <Text size="xs" c="gray.6">Authorized personnel only. All activity is logged.<br />Ashraf Elgohary · Alshaya Group · Internal use only</Text>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack h="100%" justify="center" align="center" p="xl">
          <Card w="100%" maw={420} p={36} shadow="md">
            <Group justify="center" mb="lg"><img src="/alshaya-logo.png" alt="Alshaya Group" style={{ height: 72 }} /></Group>
            <Title order={2} fz={24}>Sign in</Title>
            <Text c="dimmed" size="sm" mt={4} mb="lg">Use your POS Control Center account.</Text>
            {error && <Alert color="red" icon={<IconAlertCircle size={18} />} mb="md">{error}</Alert>}
            {sso?.enabled && (
              <>
                <Button component="a" href="/api/v1/auth/sso/login" size="md" fullWidth variant="filled" color="brand"
                  leftSection={<IconShieldLock size={18} />}>{sso.label}</Button>
                {sso.local_login && <Divider my="lg" label="or use a local account" labelPosition="center" />}
              </>
            )}
            {(!sso || sso.local_login) && <form onSubmit={submit}>
              <Stack>
                <TextInput label="Username or email" autoComplete="username" leftSection={<IconUser size={16} />}
                  data-autofocus {...form.getInputProps('username')} />
                <PasswordInput label="Password" autoComplete="current-password" leftSection={<IconLock size={16} />}
                  {...form.getInputProps('password')} />
                <Button type="submit" size="md" loading={busy} fullWidth mt="xs">Sign in</Button>
              </Stack>
            </form>}
          </Card>
          <Text size="xs" c="dimmed" ta="center">© Alshaya Group · Developed by Ashraf Elgohary</Text>
        </Stack>
      </Grid.Col>
    </Grid>
  );
}
