import { useCallback, useState } from 'react';
import { notifications } from '@mantine/notifications';

import type { DeploymentEmailPreview } from './types';

export function useDeploymentEmail() {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<DeploymentEmailPreview | null>(null);

  const openForSuccessfulDeployment = useCallback(async (deploymentId: number) => {
    setOpened(true);
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/deployments/${deploymentId}/email-preview`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || 'Unable to prepare the deployment email.');
      }
      setPreview(await response.json());
    } catch (error) {
      setOpened(false);
      notifications.show({
        color: 'red',
        title: 'Email preview unavailable',
        message: error instanceof Error ? error.message : 'Unable to prepare the deployment email.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    opened,
    loading,
    preview,
    close: () => setOpened(false),
    openForSuccessfulDeployment,
  };
}
