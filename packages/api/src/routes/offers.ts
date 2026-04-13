import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPush } from '../lib/push.js';
import { notify } from '../lib/notify.js';

export const offersRouter = Router();

const POSTBACK_SECRET = process.env.EVERFLOW_POSTBACK_SECRET || '';

// ──────────────────────────────────────────────
// PUBLIC: Everflow S2S postback receiver
// No auth — Everflow calls this server-to-server
// ──────────────────────────────────────────────
offersRouter.get('/postback', async (req: Request, res: Response) => {
  const {
    transaction_id,
    offer_id,
    event_id,
    sub1: userId,
    secret,
  } = req.query as Record<string, string>;

  const rawQuery = JSON.stringify(req.query);

  try {
    await execute(
      `INSERT INTO offer_postback_log (raw_query, everflow_offer_id, everflow_event_id, user_id, transaction_id, status)
       VALUES ($1, $2, $3, $4, $5, 'received')`,
      [rawQuery, offer_id || null, event_id || null, userId || null, transaction_id || null]
    );
  } catch { /* logging should not block response */ }

  if (POSTBACK_SECRET && secret !== POSTBACK_SECRET) {
    console.warn('[offers/postback] invalid secret', { offer_id, event_id, userId });
    await logPostbackStatus(transaction_id, 'rejected', 'Invalid secret');
    res.status(200).send('ok');
    return;
  }

  if (!offer_id || !event_id || !userId) {
    console.warn('[offers/postback] missing params', { offer_id, event_id, userId });
    await logPostbackStatus(transaction_id, 'rejected', 'Missing required params');
    res.status(200).send('ok');
    return;
  }

  try {
    const milestone = await queryOne(
      `SELECT om.id AS milestone_id, om.reward_amount, om.event_name,
              o.id AS offer_id, o.name AS offer_name, o.reward_type
       FROM offer_milestones om
       JOIN offers o ON o.id = om.offer_id
       WHERE o.everflow_offer_id = $1 AND om.everflow_event_id = $2`,
      [offer_id, event_id]
    );

    if (!milestone) {
      console.warn('[offers/postback] unknown offer/event', { offer_id, event_id });
      await logPostbackStatus(transaction_id, 'ignored', 'Unknown offer_id or event_id');
      res.status(200).send('ok');
      return;
    }

    const userExists = await queryOne(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!userExists) {
      console.warn('[offers/postback] unknown user', { userId });
      await logPostbackStatus(transaction_id, 'rejected', 'Unknown user_id');
      res.status(200).send('ok');
      return;
    }

    const completion = await queryOne(
      `INSERT INTO offer_completions (user_id, offer_id, milestone_id, everflow_transaction_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, milestone_id) DO NOTHING
       RETURNING id`,
      [userId, milestone.offer_id, milestone.milestone_id, transaction_id || null]
    );

    if (!completion) {
      console.log('[offers/postback] already credited', { userId, milestone_id: milestone.milestone_id });
      await logPostbackStatus(transaction_id, 'duplicate', 'Already credited');
      res.status(200).send('ok');
      return;
    }

    if (milestone.reward_type === 'water') {
      const mo = new Date().toISOString().slice(0, 7);
      await execute(
        `UPDATE farms SET water_in_can = water_in_can + $1,
         total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
         water_month = $3
         WHERE user_id = $2 AND harvested = false`,
        [milestone.reward_amount, userId, mo]
      );
    } else {
      await execute(
        `UPDATE farms SET nutrition = LEAST(10000, nutrition + $1)
         WHERE user_id = $2 AND harvested = false`,
        [milestone.reward_amount, userId]
      );
    }

    const unit = milestone.reward_type === 'water' ? 'g water' : ' fertilizer';
    await sendPush(
      userId,
      `${milestone.offer_name} reward!`,
      `You earned +${milestone.reward_amount}${unit} for "${milestone.event_name}"`,
      { type: 'offer_reward', offer_id: milestone.offer_id }
    );

    await notify(userId, 'offer', 'notif.offer_reward', {
      reward: milestone.reward_amount,
      unit: milestone.reward_type,
      game: milestone.offer_name,
      milestone: milestone.event_name,
    });

    console.log('[offers/postback] credited', {
      userId,
      offer: milestone.offer_name,
      event: milestone.event_name,
      amount: milestone.reward_amount,
    });
    await logPostbackStatus(transaction_id, 'credited', null);

    res.status(200).send('ok');
  } catch (err) {
    console.error('[offers/postback] error:', (err as Error).message);
    await logPostbackStatus(transaction_id, 'error', (err as Error).message);
    res.status(200).send('ok');
  }
});

async function logPostbackStatus(txId: string | undefined, status: string, error: string | null) {
  if (!txId) return;
  try {
    await execute(
      `UPDATE offer_postback_log SET status = $1, error_message = $2
       WHERE transaction_id = $3 AND status = 'received'`,
      [status, error, txId]
    );
  } catch { /* non-critical */ }
}

// ──────────────────────────────────────────────
// AUTH: List available offers with user progress
// ──────────────────────────────────────────────
offersRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const offers = await query(
    `SELECT id, name, description, icon_url, reward_type, sort_order
     FROM offers WHERE active = true ORDER BY sort_order, created_at`
  );

  if (!offers.length) {
    res.json({ success: true, data: { offers: [] } });
    return;
  }

  const offerIds = offers.map((o: any) => o.id);

  const milestones = await query(
    `SELECT id, offer_id, event_name, reward_amount, sort_order
     FROM offer_milestones WHERE offer_id = ANY($1) ORDER BY sort_order`,
    [offerIds]
  );

  const completions = await query(
    `SELECT milestone_id FROM offer_completions WHERE user_id = $1 AND offer_id = ANY($2)`,
    [userId, offerIds]
  );

  const completedSet = new Set(completions.map((c: any) => c.milestone_id));

  const result = offers.map((offer: any) => {
    const offerMilestones = milestones
      .filter((m: any) => m.offer_id === offer.id)
      .map((m: any) => ({
        id: m.id,
        event_name: m.event_name,
        reward_amount: m.reward_amount,
        completed: completedSet.has(m.id),
      }));

    const totalReward = offerMilestones.reduce((s: number, m: any) => s + m.reward_amount, 0);
    const earnedReward = offerMilestones
      .filter((m: any) => m.completed)
      .reduce((s: number, m: any) => s + m.reward_amount, 0);

    return {
      id: offer.id,
      name: offer.name,
      description: offer.description,
      icon_url: offer.icon_url,
      reward_type: offer.reward_type,
      milestones: offerMilestones,
      total_reward: totalReward,
      earned_reward: earnedReward,
      all_completed: offerMilestones.length > 0 && offerMilestones.every((m: any) => m.completed),
    };
  });

  res.json({ success: true, data: { offers: result } });
});

// ──────────────────────────────────────────────
// AUTH: Generate personal tracking link for an offer
// ──────────────────────────────────────────────
offersRouter.get('/:id/link', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const offerId = req.params.id;

  const offer = await queryOne(
    `SELECT id, tracking_link_template FROM offers WHERE id = $1 AND active = true`,
    [offerId]
  );

  if (!offer) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Offer not found' } });
    return;
  }

  let link = offer.tracking_link_template;
  const separator = link.includes('?') ? '&' : '?';
  link = `${link}${separator}sub1=${encodeURIComponent(userId)}`;

  res.json({ success: true, data: { url: link } });
});
