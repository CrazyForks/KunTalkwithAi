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

export type SyncChange = {
  table: 'conversations' | 'messages' | 'apiConfigs' | 'groups' | 'conversationSettings' | 'tombstones';
  op: 'upsert' | 'delete';
  record: Record<string, any>;
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

  async push(changes: SyncChange[]): Promise<void> {
    const deviceId = AuthService.ensureDeviceId();
    const resp = await authedFetch('/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId, changes }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`sync_push_failed(${resp.status}): ${text}`);
    }
  },
};
