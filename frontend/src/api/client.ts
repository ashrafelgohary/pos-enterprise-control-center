import axios, { AxiosError } from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 120_000 });

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Double-submit CSRF token (bound server-side to the session JWT)
api.interceptors.request.use((cfg) => {
  const method = (cfg.method ?? 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCookie('pcc_csrf');
    if (token) cfg.headers.set('X-CSRF-Token', token);
  }
  return cfg;
});

let unauthorizedHandler: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { unauthorizedHandler = fn; };

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    const url = err.config?.url ?? '';
    if (err.response?.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/me')) {
      unauthorizedHandler?.();
    }
    return Promise.reject(err);
  },
);

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'Cannot reach the server. Check your connection.';
    const d = (err.response.data as { detail?: unknown })?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length) return String((d[0] as { msg?: string }).msg ?? fallback);
    return `${fallback} (HTTP ${err.response.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

export async function downloadFile(url: string, params: Record<string, unknown>, fallbackName: string) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const cd = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}
