export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (res.status === 204) return ({ ok: true } as unknown) as T;
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json?.ok !== true) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}
