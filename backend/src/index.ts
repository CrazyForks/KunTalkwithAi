import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const googleClientIds = (process.env.GOOGLE_CLIENT_IDS || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);
if (googleClientIds.length === 0) {
  console.warn('[everytalk-api] GOOGLE_CLIENT_IDS is empty. /auth/google will reject all tokens.');
}
const googleClient = new OAuth2Client();

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).send('ok');
});

const AuthGoogleBody = z.object({
  idToken: z.string().min(10),
  deviceId: z.string().min(3).max(200),
});

app.post('/auth/google', async (req: express.Request, res: express.Response) => {
  const parsed = AuthGoogleBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: parsed.data.idToken,
      audience: googleClientIds.length ? googleClientIds : undefined,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub) {
      return res.status(401).json({ error: 'invalid_google_token' });
    }

    const googleSub = payload.sub;
    const email = payload.email || null;
    const name = payload.name || null;
    const picture = payload.picture || null;

    const user = await prisma.user.upsert({
      where: { googleSub },
      create: { googleSub, email, name, picture },
      update: { email, name, picture },
    });

    const token = jwt.sign(
      {
        uid: user.id,
        sub: user.googleSub,
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Ensure device clock exists
    await prisma.deviceClock.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: parsed.data.deviceId } },
      create: { userId: user.id, deviceId: parsed.data.deviceId, lastPullAt: BigInt(0) },
      update: {},
    });

    return res.json({ accessToken: token });
  } catch (e) {
    console.error('auth/google failed', e);
    return res.status(401).json({ error: 'auth_failed' });
  }
});

function requireAuth(req: express.Request): { userId: string } {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('missing_token');
  const token = m[1];
  const decoded = jwt.verify(token, JWT_SECRET) as any;
  if (!decoded?.uid) throw new Error('invalid_token');
  return { userId: decoded.uid as string };
}

type TableName = 'conversations' | 'messages' | 'apiConfigs' | 'groups' | 'conversationSettings' | 'tombstones';

type OpName = 'upsert' | 'delete';

const SyncChange = z.object({
  table: z.enum(['conversations', 'messages', 'apiConfigs', 'groups', 'conversationSettings', 'tombstones']),
  op: z.enum(['upsert', 'delete']),
  record: z.record(z.any()),
});

const SyncPushBody = z.object({
  deviceId: z.string().min(3).max(200),
  changes: z.array(SyncChange).max(2000),
});

function toBigIntMs(v: any): bigint {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  if (!Number.isFinite(n) || n < 0) return BigInt(0);
  return BigInt(Math.floor(n));
}

// LWW helper
function shouldApply(existingUpdatedAtMs: bigint | null | undefined, incomingUpdatedAtMs: bigint): boolean {
  if (!existingUpdatedAtMs) return true;
  return incomingUpdatedAtMs >= existingUpdatedAtMs;
}

app.post('/sync/push', async (req, res) => {
  let userId: string;
  try {
    userId = requireAuth(req).userId;
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const parsed = SyncPushBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }

  const { deviceId, changes } = parsed.data;

  try {
    await prisma.deviceClock.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, lastPullAt: BigInt(0) },
      update: {},
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const ch of changes) {
        const table = ch.table as TableName;
        const op = ch.op as OpName;
        const r = ch.record as any;

        if (table === 'tombstones') {
          if (op !== 'upsert') continue;
          const kind = String(r.kind || '');
          const targetId = String(r.targetId || '');
          const deletedAtMs = toBigIntMs(r.deletedAtMs ?? r.deletedAt ?? 0);
          if (!kind || !targetId || deletedAtMs <= 0) continue;
          await tx.tombstone.upsert({
            where: { userId_kind_targetId: { userId, kind, targetId } },
            create: { userId, kind, targetId, deletedAtMs, deviceId },
            update: { deletedAtMs, deviceId },
          });
          continue;
        }

        // Soft-delete via deletedAtMs when op=delete
        if (table === 'conversations') {
          const id = String(r.id || '');
          if (!id) continue;
          const updatedAtMs = toBigIntMs(r.updatedAtMs ?? r.updatedAt ?? Date.now());
          const existing = await tx.conversation.findFirst({ where: { userId, id } });
          const existingUpdated = existing?.updatedAtMs ?? null;

          if (!shouldApply(existingUpdated, updatedAtMs)) continue;

          if (op === 'delete') {
            await tx.conversation.upsert({
              where: { id },
              create: {
                id,
                userId,
                type: String(r.type || 'TEXT'),
                title: r.title ?? null,
                systemPrompt: r.systemPrompt ?? null,
                createdAtMs: toBigIntMs(r.createdAtMs ?? r.createdAt ?? updatedAtMs),
                updatedAtMs,
                isPinned: !!r.isPinned,
                pinnedOrder: Number(r.pinnedOrder || 0),
                deletedAtMs: updatedAtMs,
              },
              update: { updatedAtMs, deletedAtMs: updatedAtMs },
            });
            await tx.tombstone.upsert({
              where: { userId_kind_targetId: { userId, kind: 'conversation', targetId: id } },
              create: { userId, kind: 'conversation', targetId: id, deletedAtMs: updatedAtMs, deviceId },
              update: { deletedAtMs: updatedAtMs, deviceId },
            });
          } else {
            await tx.conversation.upsert({
              where: { id },
              create: {
                id,
                userId,
                type: String(r.type || 'TEXT'),
                title: r.title ?? null,
                systemPrompt: r.systemPrompt ?? null,
                createdAtMs: toBigIntMs(r.createdAtMs ?? r.createdAt ?? updatedAtMs),
                updatedAtMs,
                isPinned: !!r.isPinned,
                pinnedOrder: Number(r.pinnedOrder || 0),
              },
              update: {
                type: String(r.type || 'TEXT'),
                title: r.title ?? null,
                systemPrompt: r.systemPrompt ?? null,
                updatedAtMs,
                isPinned: !!r.isPinned,
                pinnedOrder: Number(r.pinnedOrder || 0),
                deletedAtMs: null,
              },
            });
          }
          continue;
        }

        if (table === 'messages') {
          const id = String(r.id || '');
          const conversationId = String(r.conversationId || '');
          if (!id || !conversationId) continue;
          const timestampMs = toBigIntMs(r.timestampMs ?? r.timestamp ?? Date.now());
          const updatedAtMs = timestampMs;
          const existing = await tx.message.findFirst({ where: { userId, id } });
          const existingUpdated = existing?.timestampMs ?? null;
          if (!shouldApply(existingUpdated, updatedAtMs)) continue;

          if (op === 'delete') {
            await tx.message.upsert({
              where: { id },
              create: {
                id,
                userId,
                conversationId,
                text: String(r.text ?? ''),
                role: String(r.role || 'user'),
                reasoning: r.reasoning ?? null,
                isError: !!r.isError,
                timestampMs,
                imagesJson: r.imagesJson ?? (Array.isArray(r.images) ? JSON.stringify(r.images) : null),
                deletedAtMs: updatedAtMs,
              },
              update: { timestampMs, deletedAtMs: updatedAtMs },
            });
            await tx.tombstone.upsert({
              where: { userId_kind_targetId: { userId, kind: 'message', targetId: id } },
              create: { userId, kind: 'message', targetId: id, deletedAtMs: updatedAtMs, deviceId },
              update: { deletedAtMs: updatedAtMs, deviceId },
            });
          } else {
            await tx.message.upsert({
              where: { id },
              create: {
                id,
                userId,
                conversationId,
                text: String(r.text ?? ''),
                role: String(r.role || 'user'),
                reasoning: r.reasoning ?? null,
                isError: !!r.isError,
                timestampMs,
                imagesJson: r.imagesJson ?? (Array.isArray(r.images) ? JSON.stringify(r.images) : null),
              },
              update: {
                conversationId,
                text: String(r.text ?? ''),
                role: String(r.role || 'user'),
                reasoning: r.reasoning ?? null,
                isError: !!r.isError,
                timestampMs,
                imagesJson: r.imagesJson ?? (Array.isArray(r.images) ? JSON.stringify(r.images) : null),
                deletedAtMs: null,
              },
            });
          }
          continue;
        }

        if (table === 'apiConfigs') {
          const id = String(r.id || '');
          if (!id) continue;
          const updatedAtMs = toBigIntMs(r.updatedAtMs ?? r.updatedAt ?? Date.now());
          const existing = await tx.apiConfig.findFirst({ where: { userId, id } });
          const existingUpdated = existing?.updatedAtMs ?? null;
          if (!shouldApply(existingUpdated, updatedAtMs)) continue;

          if (op === 'delete') {
            await tx.apiConfig.upsert({
              where: { id },
              create: {
                id,
                userId,
                provider: String(r.provider || ''),
                name: String(r.name || ''),
                baseUrl: String(r.baseUrl || ''),
                apiKey: String(r.apiKey || ''),
                modelsJson: r.modelsJson ?? (Array.isArray(r.models) ? JSON.stringify(r.models) : '[]'),
                channel: r.channel ?? null,
                toolsJson: r.toolsJson ?? null,
                modality: String(r.modality || 'TEXT'),
                isDefault: !!r.isDefault,
                updatedAtMs,
                deletedAtMs: updatedAtMs,
              },
              update: { updatedAtMs, deletedAtMs: updatedAtMs },
            });
            await tx.tombstone.upsert({
              where: { userId_kind_targetId: { userId, kind: 'apiConfig', targetId: id } },
              create: { userId, kind: 'apiConfig', targetId: id, deletedAtMs: updatedAtMs, deviceId },
              update: { deletedAtMs: updatedAtMs, deviceId },
            });
          } else {
            await tx.apiConfig.upsert({
              where: { id },
              create: {
                id,
                userId,
                provider: String(r.provider || ''),
                name: String(r.name || ''),
                baseUrl: String(r.baseUrl || ''),
                apiKey: String(r.apiKey || ''),
                modelsJson: r.modelsJson ?? (Array.isArray(r.models) ? JSON.stringify(r.models) : '[]'),
                channel: r.channel ?? null,
                toolsJson: r.toolsJson ?? null,
                modality: String(r.modality || 'TEXT'),
                isDefault: !!r.isDefault,
                updatedAtMs,
              },
              update: {
                provider: String(r.provider || ''),
                name: String(r.name || ''),
                baseUrl: String(r.baseUrl || ''),
                apiKey: String(r.apiKey || ''),
                modelsJson: r.modelsJson ?? (Array.isArray(r.models) ? JSON.stringify(r.models) : '[]'),
                channel: r.channel ?? null,
                toolsJson: r.toolsJson ?? null,
                modality: String(r.modality || 'TEXT'),
                isDefault: !!r.isDefault,
                updatedAtMs,
                deletedAtMs: null,
              },
            });
          }
          continue;
        }

        if (table === 'groups') {
          const id = String(r.id || '');
          if (!id) continue;
          const updatedAtMs = toBigIntMs(r.updatedAtMs ?? r.updatedAt ?? Date.now());
          const existing = await tx.group.findFirst({ where: { userId, id } });
          const existingUpdated = existing?.updatedAtMs ?? null;
          if (!shouldApply(existingUpdated, updatedAtMs)) continue;

          if (op === 'delete') {
            await tx.group.upsert({
              where: { id },
              create: {
                id,
                userId,
                name: String(r.name || ''),
                conversationIdsJson: r.conversationIdsJson ?? (Array.isArray(r.conversationIds) ? JSON.stringify(r.conversationIds) : '[]'),
                createdAtMs: toBigIntMs(r.createdAtMs ?? r.createdAt ?? updatedAtMs),
                updatedAtMs,
                deletedAtMs: updatedAtMs,
              },
              update: { updatedAtMs, deletedAtMs: updatedAtMs },
            });
            await tx.tombstone.upsert({
              where: { userId_kind_targetId: { userId, kind: 'group', targetId: id } },
              create: { userId, kind: 'group', targetId: id, deletedAtMs: updatedAtMs, deviceId },
              update: { deletedAtMs: updatedAtMs, deviceId },
            });
          } else {
            await tx.group.upsert({
              where: { id },
              create: {
                id,
                userId,
                name: String(r.name || ''),
                conversationIdsJson: r.conversationIdsJson ?? (Array.isArray(r.conversationIds) ? JSON.stringify(r.conversationIds) : '[]'),
                createdAtMs: toBigIntMs(r.createdAtMs ?? r.createdAt ?? updatedAtMs),
                updatedAtMs,
              },
              update: {
                name: String(r.name || ''),
                conversationIdsJson: r.conversationIdsJson ?? (Array.isArray(r.conversationIds) ? JSON.stringify(r.conversationIds) : '[]'),
                updatedAtMs,
                deletedAtMs: null,
              },
            });
          }
          continue;
        }

        if (table === 'conversationSettings') {
          const conversationId = String(r.conversationId || '');
          if (!conversationId) continue;
          const updatedAtMs = toBigIntMs(r.updatedAtMs ?? r.updatedAt ?? Date.now());
          const existing = await tx.conversationSetting.findFirst({ where: { userId, conversationId } });
          const existingUpdated = existing?.updatedAtMs ?? null;
          if (!shouldApply(existingUpdated, updatedAtMs)) continue;

          if (op === 'delete') {
            await tx.conversationSetting.upsert({
              where: { conversationId },
              create: {
                conversationId,
                userId,
                type: String(r.type || 'TEXT'),
                textJson: r.textJson ?? (r.text ? JSON.stringify(r.text) : null),
                imageJson: r.imageJson ?? (r.image ? JSON.stringify(r.image) : null),
                updatedAtMs,
                deletedAtMs: updatedAtMs,
              },
              update: { updatedAtMs, deletedAtMs: updatedAtMs },
            });
            await tx.tombstone.upsert({
              where: { userId_kind_targetId: { userId, kind: 'conversationSetting', targetId: conversationId } },
              create: { userId, kind: 'conversationSetting', targetId: conversationId, deletedAtMs: updatedAtMs, deviceId },
              update: { deletedAtMs: updatedAtMs, deviceId },
            });
          } else {
            await tx.conversationSetting.upsert({
              where: { conversationId },
              create: {
                conversationId,
                userId,
                type: String(r.type || 'TEXT'),
                textJson: r.textJson ?? (r.text ? JSON.stringify(r.text) : null),
                imageJson: r.imageJson ?? (r.image ? JSON.stringify(r.image) : null),
                updatedAtMs,
              },
              update: {
                type: String(r.type || 'TEXT'),
                textJson: r.textJson ?? (r.text ? JSON.stringify(r.text) : null),
                imageJson: r.imageJson ?? (r.image ? JSON.stringify(r.image) : null),
                updatedAtMs,
                deletedAtMs: null,
              },
            });
          }
          continue;
        }
      }

      // bump device clock lastPullAt to now if push succeeded
      await tx.deviceClock.update({
        where: { userId_deviceId: { userId, deviceId } },
        data: { lastPullAt: BigInt(Date.now()) },
      });
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('sync/push failed', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.get('/sync/pull', async (req, res) => {
  let userId: string;
  try {
    userId = requireAuth(req).userId;
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const since = Number(req.query.since || 0);
  const sinceMs = toBigIntMs(since);

  try {
    const [conversations, messages, apiConfigs, groups, convSettings, tombstones] = await Promise.all([
      prisma.conversation.findMany({ where: { userId, updatedAtMs: { gt: sinceMs } } }),
      prisma.message.findMany({ where: { userId, timestampMs: { gt: sinceMs } } }),
      prisma.apiConfig.findMany({ where: { userId, updatedAtMs: { gt: sinceMs } } }),
      prisma.group.findMany({ where: { userId, updatedAtMs: { gt: sinceMs } } }),
      prisma.conversationSetting.findMany({ where: { userId, updatedAtMs: { gt: sinceMs } } }),
      prisma.tombstone.findMany({ where: { userId, deletedAtMs: { gt: sinceMs } } }),
    ]);

    const now = Date.now();
    return res.json({
      now,
      conversations,
      messages,
      apiConfigs,
      groups,
      conversationSettings: convSettings,
      tombstones,
    });
  } catch (e) {
    console.error('sync/pull failed', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.listen(PORT, () => {
  console.log(`[everytalk-api] listening on :${PORT}`);
});
