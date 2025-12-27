import { AuthService } from './AuthService';

async function authedFetch(path: string, init?: RequestInit) {
  const token = AuthService.getAccessToken();
  if (!token) throw new Error('not_signed_in');

  const headers = new Headers(init?.headers || undefined);
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${AuthService.getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
}

export type SyncPullResponse = {
  now: number;
  conversations: any[];
  messages: any[];
  apiConfigs: any[];
  groups: any[];
  conversationSettings: any[];
  tombstones: any[];
};

export const CloudSyncService = {
  async pull(since: number): Promise<SyncPullResponse> {
    const resp = await authedFetch(`/sync/pull?since=${encodeURIComponent(String(since || 0))}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`sync_pull_failed(${resp.status}): ${text}`);
    }
    return resp.json() as Promise<SyncPullResponse>;
  },
};
