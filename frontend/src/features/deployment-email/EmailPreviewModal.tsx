import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CopyButton,
  Group,
  LoadingOverlay,
  Modal,
  Paper,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconMail,
  IconSettings,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import { buildMailtoUrl, formatEmailForClipboard } from './mailto';
import { downloadBrandedEml } from './eml';
import type { DeploymentEmailPreview, EditableEmail } from './types';

interface EmailPreviewModalProps {
  opened: boolean;
  loading?: boolean;
  preview: DeploymentEmailPreview | null;
  onClose: () => void;
}

const emptyEmail: EditableEmail = { to: '', cc: '', subject: '', body: '' };

export function EmailPreviewModal({ opened, loading = false, preview, onClose }: EmailPreviewModalProps) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<EditableEmail>(emptyEmail);

  useEffect(() => {
    if (!preview) return;
    setEmail({
      to: preview.to.join('; '),
      cc: preview.cc.join('; '),
      subject: preview.subject,
      body: preview.body_text,
    });
  }, [preview]);

  const outlookDisabled = !preview?.ready || !email.to.trim();
  const mailtoUrl = useMemo(() => buildMailtoUrl(email), [email]);

  const openOutlook = () => {
    if (outlookDisabled) return;
    window.location.assign(mailtoUrl);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Visa configuration deployment completed"
      size="xl"
      centered
      closeOnClickOutside={!loading}
      styles={{ title: { fontWeight: 700 } }}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="md">
        <Alert color="teal" icon={<IconCheck size={18} />} title="Deployment successful">
          Review the notification below. The application will never send it automatically.
        </Alert>

        {preview?.warning && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Store email required">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">{preview.warning}</Text>
              {preview.configuration_url && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconSettings size={15} />}
                  onClick={() => {
                    onClose();
                    navigate(preview.configuration_url!);
                  }}
                >
                  Configure store email
                </Button>
              )}
            </Group>
          </Alert>
        )}

        <TextInput
          label="To"
          value={email.to}
          onChange={(event) => setEmail((current) => ({ ...current, to: event.currentTarget.value }))}
          placeholder="store@example.com"
          description="Separate multiple addresses with a semicolon."
        />
        <TextInput
          label="CC"
          value={email.cc}
          onChange={(event) => setEmail((current) => ({ ...current, cc: event.currentTarget.value }))}
        />
        <TextInput
          label="Subject"
          value={email.subject}
          onChange={(event) => setEmail((current) => ({ ...current, subject: event.currentTarget.value }))}
        />

        <Tabs defaultValue="message">
          <Tabs.List>
            <Tabs.Tab value="message" leftSection={<IconMail size={15} />}>Editable message</Tabs.Tab>
            <Tabs.Tab value="preview">Branded preview</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="message" pt="sm">
            <Textarea
              aria-label="Email body"
              minRows={15}
              autosize
              maxRows={24}
              value={email.body}
              onChange={(event) => setEmail((current) => ({ ...current, body: event.currentTarget.value }))}
            />
          </Tabs.Panel>
          <Tabs.Panel value="preview" pt="sm">
            <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
              <Box
                component="iframe"
                title="Alshaya notification email preview"
                srcDoc={preview?.body_html ?? ''}
                style={{ width: '100%', height: 560, border: 0, background: 'white' }}
                sandbox=""
              />
            </Paper>
          </Tabs.Panel>
        </Tabs>

        <Group justify="space-between" wrap="wrap">
          <Button variant="default" onClick={onClose}>Close</Button>
          <Group>
            <CopyButton value={formatEmailForClipboard(email)} timeout={1600}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  color={copied ? 'teal' : 'blue'}
                  leftSection={copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
                  onClick={() => {
                    copy();
                    notifications.show({
                      color: 'teal',
                      message: 'Email content copied to the clipboard.',
                    });
                  }}
                >
                  {copied ? 'Copied' : 'Copy email'}
                </Button>
              )}
            </CopyButton>
            <Button
              disabled={!preview?.ready || !preview?.body_html || !email.to.trim()}
              onClick={async () => {
                if (!preview) return;
                try {
                  await downloadBrandedEml(email, preview.body_html);
                  notifications.show({ color: 'teal', title: 'Branded draft downloaded',
                    message: 'Open the .eml file - Outlook shows it as an editable draft. Review it and click Send.' });
                } catch {
                  notifications.show({ color: 'red', title: 'Could not build email', message: 'Use Open in Outlook (plain text) instead.' });
                }
              }}
            >
              Open branded email
            </Button>
            <Button
              leftSection={<IconExternalLink size={17} />}
              onClick={openOutlook}
              disabled={outlookDisabled}
              title={outlookDisabled ? 'Configure a valid store email first' : 'Open the default email client'}
            >
              Open in Outlook (plain text)
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
