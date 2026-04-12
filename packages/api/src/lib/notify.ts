import { execute, queryOne } from './db.js';
import { sendPush } from './push.js';

const PUSH_MESSAGES: Record<string, (p: Record<string, string | number>) => { title: string; body: string }> = {
  greet: (p) => ({
    title: 'New Greeting!',
    body: `${p.name || 'A friend'} greeted you! +${p.amount || 0}g water`,
  }),
  water: (p) => ({
    title: 'Garden Watered!',
    body: `${p.name || 'A friend'} watered your garden!`,
  }),
};

export async function notify(
  userId: string,
  type: string,
  messageKey: string,
  params: Record<string, string | number> = {}
) {
  await execute(
    `INSERT INTO notifications (user_id, type, payload) VALUES ($1, $2, $3)`,
    [userId, type, JSON.stringify({ message_key: messageKey, ...params })]
  );

  const pushMsg = PUSH_MESSAGES[type];
  if (pushMsg) {
    const { title, body } = pushMsg(params);
    sendPush(userId, title, body, { type }).catch(() => {});
  }
}

export async function getUserNickname(userId: string): Promise<string> {
  const user = await queryOne(`SELECT nickname FROM users WHERE id = $1`, [userId]);
  return user?.nickname ?? 'Someone';
}
