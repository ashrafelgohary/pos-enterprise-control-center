export interface StoreListItem {
  id: number;
  name: string;
  code: string | null;
  brand: string;
  email: string | null;
  additional_recipients: string[];
  is_active: boolean;
  notification_ready: boolean;
  pos_count: number;
}

export interface StorePOS {
  id: number;
  hostname: string;
  ip_address: string | null;
  mac_address: string | null;
  store_id?: number | null;
}

export interface StoreDetails extends Omit<StoreListItem, 'pos_count'> {
  created_at: string;
  updated_at: string;
  pos_terminals: StorePOS[];
}

export interface StorePayload {
  name: string;
  code: string | null;
  brand: string;
  email: string | null;
  additional_recipients: string[];
  is_active: boolean;
}

const API = '/api/v1';
// Adapt this constant only if the existing POS list route has another path.
const POS_LIST_ENDPOINT = `${API}/pos?page_size=500`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const storeApi = {
  list: (search = '') => request<StoreListItem[]>(`${API}/stores${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  get: (id: number) => request<StoreDetails>(`${API}/stores/${id}`),
  create: (payload: StorePayload) => request<StoreDetails>(`${API}/stores`, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: number, payload: Partial<StorePayload>) => request<StoreDetails>(`${API}/stores/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id: number) => request<void>(`${API}/stores/${id}`, { method: 'DELETE' }),
  listPos: async () => {
    const payload = await request<StorePOS[] | { items: StorePOS[] }>(POS_LIST_ENDPOINT);
    return Array.isArray(payload) ? payload : payload.items;
  },
  assignPos: (posId: number, storeId: number | null) => request<void>(`${API}/stores/pos/${posId}`, { method: 'PUT', body: JSON.stringify({ store_id: storeId }) }),
  getSettings: () => request<{ default_cc: string[] }>(`${API}/settings/deployment-email`),
  updateSettings: (defaultCc: string[]) => request<{ default_cc: string[] }>(`${API}/settings/deployment-email`, { method: 'PUT', body: JSON.stringify({ default_cc: defaultCc }) }),
};
