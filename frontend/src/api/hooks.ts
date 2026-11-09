import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  AuditEntry, DashboardSummary, Job, JobDetail, JobResultDetail, Page, Pos, PosInput, User,
} from './types';

const clean = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const qk = {
  dashboard: ['dashboard'] as const,
  pos: (p: object) => ['pos', p] as const,
  posOne: (id: number) => ['pos', 'one', id] as const,
  posHistory: (id: number, page: number) => ['pos', 'history', id, page] as const,
  facets: ['pos', 'facets'] as const,
  jobs: (p: object) => ['jobs', p] as const,
  job: (id: number) => ['jobs', 'one', id] as const,
  result: (id: number) => ['results', id] as const,
  users: (p: object) => ['users', p] as const,
  audit: (p: object) => ['audit', p] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: async () => (await api.get<DashboardSummary>('/dashboard/summary')).data,
    refetchInterval: 30_000,
  });
}

export interface PosQuery { q?: string; status?: string; store?: string; brand?: string; sort: string; order: 'asc' | 'desc'; page: number; page_size: number }
export function usePosList(p: PosQuery) {
  return useQuery({
    queryKey: qk.pos(p),
    queryFn: async () => (await api.get<Page<Pos>>('/pos', { params: clean({ ...p }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
export function usePos(id: number) {
  return useQuery({ queryKey: qk.posOne(id), queryFn: async () => (await api.get<Pos>(`/pos/${id}`)).data });
}
export function usePosHistory(id: number, page: number) {
  return useQuery({
    queryKey: qk.posHistory(id, page),
    queryFn: async () => (await api.get<Page<JobResultDetail>>(`/pos/${id}/deployments`, { params: { page, page_size: 10 } })).data,
    placeholderData: keepPreviousData,
  });
}
export function useFacets() {
  return useQuery({
    queryKey: qk.facets,
    queryFn: async () => (await api.get<{ stores: string[]; brands: string[] }>('/pos/facets')).data,
    staleTime: 60_000,
  });
}

export function useSavePos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: Partial<PosInput> }) =>
      id ? (await api.patch<Pos>(`/pos/${id}`, data)).data : (await api.post<Pos>('/pos', data)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos'] }); qc.invalidateQueries({ queryKey: qk.dashboard }); },
  });
}
export function useDeletePos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) =>
      ids.length === 1 ? api.delete(`/pos/${ids[0]}`) : api.post('/pos/bulk-delete', { ids }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos'] }); qc.invalidateQueries({ queryKey: qk.dashboard }); },
  });
}

export function useJobs(p: { view: string; q?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: qk.jobs(p),
    queryFn: async () => (await api.get<Page<Job>>('/deployments/jobs', { params: clean({ ...p }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => j.status === 'pending' || j.status === 'running') || p.view === 'running' ? 3000 : 30_000,
  });
}
export function useJob(id: number) {
  return useQuery({
    queryKey: qk.job(id),
    queryFn: async () => (await api.get<JobDetail>(`/deployments/jobs/${id}`)).data,
    refetchInterval: (q) => (q.state.data && ['pending', 'running'].includes(q.state.data.status) ? 2000 : false),
  });
}
export function useResult(id: number | null) {
  return useQuery({
    queryKey: qk.result(id ?? 0),
    queryFn: async () => (await api.get<JobResultDetail>(`/deployments/results/${id}`)).data,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['pending', 'running'].includes(q.state.data.status) ? 2000 : false),
  });
}

export function useUsers(p: { q?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: qk.users(p),
    queryFn: async () => (await api.get<Page<User>>('/users', { params: clean({ ...p }) })).data,
    placeholderData: keepPreviousData,
  });
}

export interface AuditQuery { q?: string; action?: string; date_from?: string; date_to?: string; page: number; page_size: number }
export function useAudit(p: AuditQuery) {
  return useQuery({
    queryKey: qk.audit(p),
    queryFn: async () => (await api.get<Page<AuditEntry>>('/audit-logs', { params: clean({ ...p }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}
