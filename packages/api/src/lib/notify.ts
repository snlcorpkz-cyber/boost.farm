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
  invite: (p) => ({
    title: 'New Friend!',
    body: `${p.name || 'Someone'} joined via your link! +${p.fert || 0} fertilizer`,
  }),
  quest: (p) => ({
    title: 'Quest Complete!',
    body: `You earned +${p.reward || 0}${p.unit === 'water' ? 'g water' : ' fertilizer'}`,
  }),
  gift: (p) => ({
    title: 'Daily Challenge Done!',
    body: `You earned +${p.reward || 0}g water for completing today's challenge!`,
  }),
  stage: (p) => ({
    title: 'New Growth Stage!',
    body: `Your plant has grown to a new stage! +${p.bonus || 100}g water bonus. Keep going!`,
  }),
  harvest: (p) => ({
    title: 'Harvest Ready!',
    body: `Your crop is fully grown! Collect your reward!`,
  }),
  offer: (p) => ({
    title: `${p.game || 'Game'} Reward!`,
    body: `You earned +${p.reward || 0}${p.unit === 'water' ? 'g water' : ' fertilizer'} for "${p.milestone || 'milestone'}"`,
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
