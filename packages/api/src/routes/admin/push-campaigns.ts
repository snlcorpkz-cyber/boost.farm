import { Router } from 'express';
import { query, queryOne, execute, withTransaction } from '../../lib/db.js';
import { sendPushBatch } from '../../lib/push.js';

export const adminPushRouter = Router();

adminPushRouter.get('/', async (_req, res) => {
  try {
    const campaigns = await query(
      `SELECT * FROM push_campaigns ORDER BY created_at DESC LIMIT 100`
    );
    res.json(campaigns);
  } catch (err) {
    console.error('[admin/push]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.get('/:id', async (req, res) => {
  try {
    const campaign = await queryOne(`SELECT * FROM push_campaigns WHERE id = $1`, [req.params.id]);
    if (!campaign) { res.status(404).json({ error: 'Not found' }); return; }

    const recipients = await query(
      `SELECT pcr.*, u.nickname, u.email
       FROM push_campaign_recipients pcr
       JOIN users u ON u.id = pcr.user_id
       WHERE pcr.campaign_id = $1
       ORDER BY pcr.sent_at DESC NULLS LAST
       LIMIT 200`,
      [req.params.id]
    );
    res.json({ ...campaign, recipients });
  } catch (err) {
    console.error('[admin/push/:id]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.post('/', async (req, res) => {
  try {
    const { title, body, data, target_type, target_filter, target_user_ids, scheduled_at } = req.body;

    const campaign = await queryOne(
      `INSERT INTO push_campaigns (title, body, data, target_type, target_filter, target_user_ids, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        title, body,
        JSON.stringify(data || {}),
        target_type || 'all',
        JSON.stringify(target_filter || {}),
        target_user_ids || null,
        scheduled_at || null,
        req.user?.userId || null,
      ]
    );
    res.json(campaign);
  } catch (err) {
    console.error('[admin/push POST]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.put('/:id', async (req, res) => {
  try {
    const { title, body, data, target_type, target_filter, target_user_ids, scheduled_at } = req.body;
    await execute(
      `UPDATE push_campaigns SET title=$2, body=$3, data=$4, target_type=$5, target_filter=$6, target_user_ids=$7, scheduled_at=$8
       WHERE id=$1 AND status='draft'`,
      [req.params.id, title, body, JSON.stringify(data || {}), target_type, JSON.stringify(target_filter || {}), target_user_ids || null, scheduled_at || null]
    );
    const updated = await queryOne(`SELECT * FROM push_campaigns WHERE id = $1`, [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('[admin/push PUT]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.post('/:id/estimate', async (req, res) => {
  try {
    const campaign = await queryOne(`SELECT * FROM push_campaigns WHERE id = $1`, [req.params.id]);
    if (!campaign) { res.status(404).json({ error: 'Not found' }); return; }

    const count = await buildRecipientCount(campaign);
    res.json({ estimated: count });
  } catch (err) {
    console.error('[admin/push/estimate]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.post('/estimate', async (req, res) => {
  try {
    const { target_type, target_filter, target_user_ids } = req.body;
    const count = await buildRecipientCount({ target_type, target_filter, target_user_ids });
    res.json({ estimated: count });
  } catch (err) {
    console.error('[admin/push/estimate]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.post('/:id/send', async (req, res) => {
  try {
    const campaign = await queryOne(`SELECT * FROM push_campaigns WHERE id = $1`, [req.params.id]);
    if (!campaign) { res.status(404).json({ error: 'Not found' }); return; }
    if (campaign.status !== 'draft') {
      res.status(400).json({ error: 'Campaign already sent or sending' });
      return;
    }

    await execute(`UPDATE push_campaigns SET status = 'sending' WHERE id = $1`, [campaign.id]);

    // Fire and return immediately — sending happens in background
    sendCampaign(campaign).catch(err => {
      console.error('[admin/push/send] background error:', err);
    });

    res.json({ success: true, status: 'sending' });
  } catch (err) {
    console.error('[admin/push/send]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminPushRouter.delete('/:id', async (req, res) => {
  try {
    await execute(`DELETE FROM push_campaigns WHERE id = $1 AND status = 'draft'`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/push DELETE]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── Internal ───

async function buildRecipientQuery(campaign: any): Promise<{ userIds: string[]; tokens: { user_id: string; token: string }[] }> {
  const filter = campaign.target_filter || {};
  let where = 'WHERE pt.token IS NOT NULL';
  const params: any[] = [];
  let pi = 0;

  if (campaign.target_type === 'users' && campaign.target_user_ids?.length) {
    pi++;
    where += ` AND u.id = ANY($${pi})`;
    params.push(campaign.target_user_ids);
  } else if (campaign.target_type === 'segment') {
    if (filter.country) {
      pi++;
      where += ` AND u.country = $${pi}`;
      params.push(filter.country);
    }
    if (filter.platform) {
      pi++;
      where += ` AND u.device_platform = $${pi}`;
      params.push(filter.platform);
    }
    if (filter.rank) {
      pi++;
      where += ` AND f.rank_id = $${pi}`;
      params.push(filter.rank);
    }
    if (filter.registered_after) {
      pi++;
      where += ` AND u.created_at >= $${pi}`;
      params.push(filter.registered_after);
    }
    if (filter.registered_before) {
      pi++;
      where += ` AND u.created_at <= $${pi}`;
      params.push(filter.registered_before);
    }
    if (filter.active_days) {
      pi++;
      where += ` AND u.last_active_at >= now() - ($${pi} || ' days')::interval`;
      params.push(filter.active_days);
    }
  }

  const rows = await query(
    `SELECT DISTINCT u.id AS user_id, pt.token
     FROM users u
     JOIN push_tokens pt ON pt.user_id = u.id
     LEFT JOIN farms f ON f.user_id = u.id AND f.harvested = false
     ${where}`,
    params
  );

  return {
    userIds: [...new Set(rows.map((r: any) => r.user_id))],
    tokens: rows,
  };
}

async function buildRecipientCount(campaign: any): Promise<number> {
  const { userIds } = await buildRecipientQuery(campaign);
  return userIds.length;
}

async function sendCampaign(campaign: any): Promise<void> {
  try {
    const { tokens } = await buildRecipientQuery(campaign);
    if (!tokens.length) {
      await execute(`UPDATE push_campaigns SET status = 'sent', total_recipients = 0, sent_at = now() WHERE id = $1`, [campaign.id]);
      return;
    }

    // Insert recipients
    for (const t of tokens) {
      try {
        await execute(
          `INSERT INTO push_campaign_recipients (campaign_id, user_id, token, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (campaign_id, user_id) DO NOTHING`,
          [campaign.id, t.user_id, t.token]
        );
      } catch { /* skip duplicates */ }
    }

    await execute(`UPDATE push_campaigns SET total_recipients = $2 WHERE id = $1`, [campaign.id, tokens.length]);

    // Send in batches
    const batchSize = 500;
    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const userIds = batch.map((t: any) => t.user_id);

      // Mirror the push into the in-app inbox so users who tap the bell
      // icon see the campaign even if they swiped the system notification
      // away (or never got one, e.g. web / notifications disabled).
      try {
        const payload = JSON.stringify({
          message_key: 'notif.campaign',
          title: campaign.title,
          body: campaign.body,
          campaign_id: campaign.id,
        });
        await execute(
          `INSERT INTO notifications (user_id, type, payload)
           SELECT unnest($1::uuid[]), 'campaign', $2::jsonb`,
          [userIds, payload]
        );
      } catch (err) {
        console.warn('[sendCampaign] inbox insert failed:', (err as Error).message);
      }

      try {
        await sendPushBatch(
          userIds,
          campaign.title,
          campaign.body,
          { ...(campaign.data || {}), campaign_id: campaign.id }
        );

        await execute(
          `UPDATE push_campaign_recipients SET status = 'sent', sent_at = now()
           WHERE campaign_id = $1 AND user_id = ANY($2)`,
          [campaign.id, userIds]
        );
        sentCount += batch.length;
      } catch (err) {
        await execute(
          `UPDATE push_campaign_recipients SET status = 'failed', error = $3
           WHERE campaign_id = $1 AND user_id = ANY($2)`,
          [campaign.id, userIds, (err as Error).message]
        );
        failCount += batch.length;
      }
    }

    await execute(
      `UPDATE push_campaigns SET status = 'sent', sent_at = now(), delivered = $2, failed = $3 WHERE id = $1`,
      [campaign.id, sentCount, failCount]
    );
  } catch (err) {
    console.error('[sendCampaign] error:', err);
    await execute(`UPDATE push_campaigns SET status = 'failed' WHERE id = $1`, [campaign.id]);
  }
}
