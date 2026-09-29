const TOKEN_KEY = 'sa:token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const listeners = new Set();
export const onUnauthorized = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export async function api(path, { method = 'GET', body, query, signal } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, '网络请求失败，请检查网络后重试');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) {
    setToken(null);
    listeners.forEach((fn) => fn());
  }
  if (!res.ok) throw new ApiError(res.status, data?.message || `请求失败（${res.status}）`, data?.code);
  return data;
}

export const get = (path, query) => api(path, { query });
export const post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
export const put = (path, body) => api(path, { method: 'PUT', body: body ?? {} });
export const del = (path) => api(path, { method: 'DELETE' });
