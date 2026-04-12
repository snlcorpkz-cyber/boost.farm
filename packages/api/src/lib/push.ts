import admin from 'firebase-admin';
import { query, execute } from './db.js';

let initialized = false;

function initFirebase() {
  if (initialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
    return;
  }
  try {
    const credential = admin.credential.cert(JSON.parse(raw));
    admin.initializeApp({ credential });
    initialized = true;
    console.log('[push] Firebase Admin initialized');
  } catch (err) {
    console.error('[push] Failed to initialize Firebase Admin:', (err as Error).message);
  }
}

initFirebase();

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!initialized) return;

  const tokens = await query(
    `SELECT token FROM push_tokens WHERE user_id = $1`,
    [userId]
  );
  if (!tokens.length) return;

  for (const row of tokens) {
    try {
      await admin.messaging().send({
        token: row.token,
        notification: { title, body },
        data: data || {},
        android: {
          priority: 'high' as const,
          notification: { sound: 'default', channelId: 'boostfarm_default' },
        },
      });
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        await execute(`DELETE FROM push_tokens WHERE token = $1`, [row.token]);
      } else {
        console.error('[push] send error:', (err as Error).message);
      }
    }
  }
}

export async function sendPushBatch(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!initialized || !userIds.length) return;

  const tokens = await query(
    `SELECT user_id, token FROM push_tokens WHERE user_id = ANY($1)`,
    [userIds]
  );
  if (!tokens.length) return;

  const messages = tokens.map((row: any) => ({
    token: row.token,
    notification: { title, body },
    data: data || {},
    android: {
      priority: 'high' as const,
      notification: { sound: 'default', channelId: 'boostfarm_default' },
    },
  }));

  const batchSize = 500;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    try {
      const result = await admin.messaging().sendEach(batch);
      const staleTokens: string[] = [];
      result.responses.forEach((resp, idx) => {
        if (resp.error) {
          const code = resp.error.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            staleTokens.push(batch[idx].token);
          }
        }
      });
      if (staleTokens.length) {
        await execute(
          `DELETE FROM push_tokens WHERE token = ANY($1)`,
          [staleTokens]
        );
      }
    } catch (err) {
      console.error('[push] batch error:', (err as Error).message);
    }
  }
}
