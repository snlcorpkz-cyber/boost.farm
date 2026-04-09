import { execute, queryOne } from './db.js';

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
}

export async function getUserNickname(userId: string): Promise<string> {
  const user = await queryOne(`SELECT nickname FROM users WHERE id = $1`, [userId]);
  return user?.nickname ?? 'Someone';
}
