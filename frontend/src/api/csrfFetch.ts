// Adds the session CSRF token to same-origin API calls made with window.fetch
// (axios calls already get it in api/client.ts). Needed by the store/email features.
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|; )pcc_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const nativeFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const sameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
  const token = csrfToken();
  if (UNSAFE.has(method) && sameOrigin && token) {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
    init = { ...init, headers };
  }
  return nativeFetch(input, init);
};

export {};
