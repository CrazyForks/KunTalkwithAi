import { db, type ApiConfig, type Conversation, type ConversationGroup, type ConversationSettings, type Message } from '../db';
import { AuthService } from './AuthService';
import { CloudSyncService, type SyncChange, type SyncPullResponse } from './CloudSyncService';

const LAST_PULL_AT_KEY = 'everytalk.cloudSync.lastPullAt';
const LAST_PUSH_AT_KEY = 'everytalk.cloudSync.lastPushAt';

function getNum(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    const n = Number(raw || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function setNum(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.floor(value || 0)));
  } catch {
    // ignore
  }
}

function toMs(v: any): number {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function ensureArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function safeJsonParse<T = any>(v: any): T | null {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
}

function normalizeConversation(r: any): Conversation {
  const createdAt = toMs(r.createdAtMs ?? r.createdAt) || Date.now();
  const updatedAt = toMs(r.updatedAtMs ?? r.updatedAt) || createdAt;
  return {
    id: String(r.id || ''),
    type: String(r.type || 'TEXT') === 'IMAGE' ? 'IMAGE' : 'TEXT',
    title: r.title ?? undefined,
    systemPrompt: r.systemPrompt ?? undefined,
    createdAt,
    updatedAt,
    isPinned: !!r.isPinned,
    pinnedOrder: Number(r.pinnedOrder || 0),
  };
}

function normalizeMessage(r: any): Message {
  const timestamp = toMs(r.timestampMs ?? r.timestamp) || Date.now();
  const images = r.imagesJson ? (safeJsonParse<any[]>(r.imagesJson) ?? []) : ensureArray(r.images);
  return {
    id: String(r.id || ''),
    conversationId: String(r.conversationId || ''),
    text: String(r.text ?? ''),
    role: (String(r.role || 'user') as any),
    reasoning: r.reasoning ?? undefined,
    isError: !!r.isError,
    timestamp,
    images: images.length ? images : undefined,
  };
}

function normalizeApiConfig(r: any): ApiConfig {
  const updatedAt = toMs(r.updatedAtMs ?? r.updatedAt) || Date.now();
  const models = r.modelsJson ? (safeJsonParse<any[]>(r.modelsJson) ?? []) : ensureArray(r.models);
  return {
    id: String(r.id || ''),
    provider: String(r.provider || ''),
    name: String(r.name || ''),
    baseUrl: String(r.baseUrl || ''),
    apiKey: String(r.apiKey || ''),
    models,
    channel: r.channel ?? undefined,
    toolsJson: r.toolsJson ?? undefined,
    modality: String(r.modality || 'TEXT') === 'IMAGE' ? 'IMAGE' : 'TEXT',
    isDefault: !!r.isDefault,
    updatedAt,
  };
}

function normalizeGroup(r: any): ConversationGroup {
  const createdAt = toMs(r.createdAtMs ?? r.createdAt) || Date.now();
  const updatedAt = toMs(r.updatedAtMs ?? r.updatedAt) || createdAt;
  const conversationIds = r.conversationIdsJson
    ? (safeJsonParse<any[]>(r.conversationIdsJson) ?? [])
    : ensureArray(r.conversationIds);

  return {
    id: String(r.id || ''),
    name: String(r.name || ''),
    conversationIds,
    createdAt,
    updatedAt,
  };
}

function normalizeConversationSetting(r: any): ConversationSettings {
  const updatedAt = toMs(r.updatedAtMs ?? r.updatedAt) || Date.now();

  const text = r.textJson ? safeJsonParse<any>(r.textJson) : (r.text ?? undefined);
  const image = r.imageJson ? safeJsonParse<any>(r.imageJson) : (r.image ?? undefined);

  return {
    conversationId: String(r.conversationId || ''),
    type: String(r.type || 'TEXT') === 'IMAGE' ? 'IMAGE' : 'TEXT',
    text: text ?? undefined,
    image: image ?? undefined,
    updatedAt,
  };
}

function normalizeTombstone(r: any): { kind: string; targetId: string; deletedAt: number } {
  return {
    kind: String(r.kind || ''),
    targetId: String(r.targetId || ''),
    deletedAt: toMs(r.deletedAtMs ?? r.deletedAt) || Date.now(),
  };
}

async function applyRemote(data: SyncPullResponse) {
  const tombstones = ensureArray(data.tombstones).map(normalizeTombstone).filter(t => t.kind && t.targetId);

  await db.transaction(
    'rw',
    [db.conversations, db.messages, db.apiConfigs, db.groups, db.conversationSettings, db.tombstones],
    async () => {
      // Apply tombstones first (delete local copies)
      for (const t of tombstones) {
        const existing = await db.tombstones.get([t.kind, t.targetId] as any);
        if (!existing || (existing.deletedAt ?? 0) < t.deletedAt) {
          await db.tombstones.put({ kind: t.kind as any, targetId: t.targetId, deletedAt: t.deletedAt } as any);
        }

      if (t.kind === 'conversation') {
        await db.messages.where('conversationId').equals(t.targetId).delete();
        await db.conversationSettings.delete(t.targetId);
        await db.conversations.delete(t.targetId);
      }
      if (t.kind === 'message') await db.messages.delete(t.targetId);
      if (t.kind === 'apiConfig') await db.apiConfigs.delete(t.targetId);
      if (t.kind === 'group') await db.groups.delete(t.targetId);
      if (t.kind === 'conversationSetting') await db.conversationSettings.delete(t.targetId);
    }

    for (const r of ensureArray(data.conversations)) {
      const c = normalizeConversation(r);
      if (!c.id) continue;
      const localTs = await db.tombstones.get(['conversation', c.id] as any);
      if (localTs && (localTs.deletedAt ?? 0) >= (c.updatedAt ?? 0)) continue;
      await db.conversations.put(c);
    }

    for (const r of ensureArray(data.messages)) {
      const m = normalizeMessage(r);
      if (!m.id || !m.conversationId) continue;
      const localTs = await db.tombstones.get(['message', m.id] as any);
      if (localTs && (localTs.deletedAt ?? 0) >= (m.timestamp ?? 0)) continue;
      await db.messages.put(m);
    }

    for (const r of ensureArray(data.apiConfigs)) {
      const a = normalizeApiConfig(r);
      if (!a.id) continue;
      const localTs = await db.tombstones.get(['apiConfig', a.id] as any);
      if (localTs && (localTs.deletedAt ?? 0) >= (a.updatedAt ?? 0)) continue;
      await db.apiConfigs.put(a);
    }

    for (const r of ensureArray(data.groups)) {
      const g = normalizeGroup(r);
      if (!g.id) continue;
      const localTs = await db.tombstones.get(['group', g.id] as any);
      if (localTs && (localTs.deletedAt ?? 0) >= (g.updatedAt ?? 0)) continue;
      await db.groups.put(g);
    }

    for (const r of ensureArray(data.conversationSettings)) {
      const s = normalizeConversationSetting(r);
      if (!s.conversationId) continue;
      const localTs = await db.tombstones.get(['conversationSetting', s.conversationId] as any);
      if (localTs && (localTs.deletedAt ?? 0) >= (s.updatedAt ?? 0)) continue;
      await db.conversationSettings.put(s);
    }
    }
  );
}

async function collectLocalChanges(since: number): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];

  const convs = await db.conversations.where('updatedAt').above(since).toArray();
  for (const c of convs) {
    changes.push({
      table: 'conversations',
      op: 'upsert',
      record: {
        id: c.id,
        type: c.type,
        title: c.title ?? null,
        systemPrompt: c.systemPrompt ?? null,
        createdAtMs: c.createdAt,
        updatedAtMs: c.updatedAt,
        isPinned: !!c.isPinned,
        pinnedOrder: Number(c.pinnedOrder || 0),
      },
    });
  }

  const msgs = await db.messages.where('timestamp').above(since).toArray();
  for (const m of msgs) {
    changes.push({
      table: 'messages',
      op: 'upsert',
      record: {
        id: m.id,
        conversationId: m.conversationId,
        text: m.text,
        role: m.role,
        reasoning: m.reasoning ?? null,
        isError: !!m.isError,
        timestampMs: m.timestamp,
        imagesJson: m.images ? JSON.stringify(m.images) : null,
      },
    });
  }

  const apiConfigs = await db.apiConfigs.filter((c) => (c.updatedAt ?? 0) > since).toArray();
  for (const a of apiConfigs) {
    changes.push({
      table: 'apiConfigs',
      op: 'upsert',
      record: {
        id: a.id,
        provider: a.provider,
        name: a.name,
        baseUrl: a.baseUrl,
        apiKey: a.apiKey,
        modelsJson: JSON.stringify(a.models || []),
        channel: a.channel ?? null,
        toolsJson: (a as any).toolsJson ?? null,
        modality: a.modality,
        isDefault: !!a.isDefault,
        updatedAtMs: a.updatedAt ?? Date.now(),
      },
    });
  }

  const groups = await db.groups.filter((g) => (g.updatedAt ?? 0) > since).toArray();
  for (const g of groups) {
    changes.push({
      table: 'groups',
      op: 'upsert',
      record: {
        id: g.id,
        name: g.name,
        conversationIdsJson: JSON.stringify(g.conversationIds || []),
        createdAtMs: g.createdAt,
        updatedAtMs: g.updatedAt ?? Date.now(),
      },
    });
  }

  const settings = await db.conversationSettings.where('updatedAt').above(since).toArray();
  for (const s of settings) {
    changes.push({
      table: 'conversationSettings',
      op: 'upsert',
      record: {
        conversationId: s.conversationId,
        type: s.type,
        textJson: s.text ? JSON.stringify(s.text) : null,
        imageJson: s.image ? JSON.stringify(s.image) : null,
        updatedAtMs: s.updatedAt,
      },
    });
  }

  const tombstones = await db.tombstones.where('deletedAt').above(since).toArray();
  for (const t of tombstones as any[]) {
    changes.push({
      table: 'tombstones',
      op: 'upsert',
      record: {
        kind: t.kind,
        targetId: t.targetId,
        deletedAtMs: t.deletedAt,
      },
    });
  }

  return changes;
}

export const CloudSyncManager = {
  getLastPullAt(): number {
    return getNum(LAST_PULL_AT_KEY);
  },

  getLastPushAt(): number {
    return getNum(LAST_PUSH_AT_KEY);
  },

  async syncOnce(): Promise<{ pushed: number; pulledNow: number }> {
    if (!AuthService.isSignedIn()) throw new Error('not_signed_in');

    const pushSince = this.getLastPushAt();
    const pullSince = this.getLastPullAt();

    // Push local changes first
    const changes = await collectLocalChanges(pushSince);
    const MAX_PUSH_CHANGES = 1500;
    if (changes.length > 0) {
      for (let i = 0; i < changes.length; i += MAX_PUSH_CHANGES) {
        const batch = changes.slice(i, i + MAX_PUSH_CHANGES);
        await CloudSyncService.push(batch);
      }
      setNum(LAST_PUSH_AT_KEY, Date.now());
    }

    // Pull server changes and apply
    const data = await CloudSyncService.pull(pullSince);
    await applyRemote(data);
    setNum(LAST_PULL_AT_KEY, data.now || Date.now());

    return { pushed: changes.length, pulledNow: data.now || Date.now() };
  },
};
