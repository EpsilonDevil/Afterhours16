// Backend client with idempotency keys for every mutation.
export class APIError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
export class API {
  async req(method, path, body) {
    let res;
    try {
      res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new APIError(0, 'Cannot reach the local game service. Is the server window still open?'); }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new APIError(res.status, data?.error || `Request failed (${res.status})`);
    return data;
  }
  get(path) { return this.req('GET', path); }
  post(path, body = {}) { return this.req('POST', path, body); }
  // mutation with a stable idempotency key; retries once on network failure with the same key
  async mutate(path, body = {}) {
    const key = newKey();
    try { return await this.post(path, { ...body, key }); }
    catch (e) { if (e.status === 0) { await new Promise(r => setTimeout(r, 600)); return this.post(path, { ...body, key }); } throw e; }
  }
}
