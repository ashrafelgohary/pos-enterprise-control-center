import { api } from '@/api/client';
import type { DeploymentEmailPreview } from './types';

export interface JobEmailPreview extends DeploymentEmailPreview {
  store_name: string;
  pos_ids: number[];
  pos_hostnames: string[];
}

/** One preview per store for all POS that succeeded in the job. */
export async function fetchJobEmailPreviews(jobId: number): Promise<JobEmailPreview[]> {
  return (await api.get<JobEmailPreview[]>(`/deployments/jobs/${jobId}/email-previews`)).data;
}
