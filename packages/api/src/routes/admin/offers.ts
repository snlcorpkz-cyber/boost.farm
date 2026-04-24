import { Router } from 'express';
import { query, queryOne, execute, withTransaction } from '../../lib/db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const adminOffersRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), 'public/assets/offers');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `offer-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

adminOffersRouter.get('/', async (_req, res) => {
  try {
    const offers = await query(
      `SELECT o.*,
        (SELECT count(*)::int FROM offer_milestones m WHERE m.offer_id = o.id) AS milestone_count,
        (SELECT count(*)::int FROM offer_completions c WHERE c.offer_id = o.id) AS completions_count
       FROM offers o ORDER BY o.sort_order, o.created_at DESC`
    );
    res.json(offers);
  } catch (err) {
    console.error('[admin/offers]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminOffersRouter.get('/:id', async (req, res) => {
  try {
    const offer = await queryOne(`SELECT * FROM offers WHERE id = $1`, [req.params.id]);
    if (!offer) { res.status(404).json({ error: 'Not found' }); return; }

    const milestones = await query(
      `SELECT * FROM offer_milestones WHERE offer_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );
    const completions = await query(
      `SELECT oc.*, u.nickname, u.email, m.event_name
       FROM offer_completions oc
       JOIN users u ON u.id = oc.user_id
       JOIN offer_milestones m ON m.id = oc.milestone_id
       WHERE oc.offer_id = $1
       ORDER BY oc.credited_at DESC LIMIT 100`,
      [req.params.id]
    );
    const postbacks = await query(
      `SELECT * FROM offer_postback_log
       WHERE everflow_offer_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [offer.everflow_offer_id]
    );

    res.json({ ...offer, milestones, completions, postbacks });
  } catch (err) {
    console.error('[admin/offers/:id]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Per-offer analytics — powering the "Analytics" tab in OfferEditPage.
 * Everything is filtered to the requested window (default 30 days) unless
 * otherwise noted. All rows are capped to keep the response small.
 */
adminOffersRouter.get('/:id/analytics', async (req, res) => {
  try {
    const offerId = req.params.id;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string) || 30));

    const offer = await queryOne<any>(
      `SELECT id, name, everflow_offer_id, payout_cents FROM offers WHERE id = $1`,
      [offerId],
    );
    if (!offer) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }

    const [summaryRow, milestones, postbackStatus, recentCompletions, recentPostbacks, topUsers] =
      await Promise.all([
        queryOne<any>(
          `SELECT
             (SELECT count(*)::int FROM offer_completions WHERE offer_id = $1) AS completions_total,
             (SELECT count(*)::int FROM offer_completions
                WHERE offer_id = $1
                  AND credited_at >= now() - ($2 || ' days')::interval) AS completions_in_window,
             (SELECT count(DISTINCT user_id)::int FROM offer_completions
                WHERE offer_id = $1
                  AND credited_at >= now() - ($2 || ' days')::interval) AS unique_users`,
          [offerId, String(days)],
        ),
        query<any>(
          `SELECT m.id, m.event_name, m.everflow_event_id, m.reward_amount, m.sort_order,
                  (SELECT count(*)::int FROM offer_completions oc
                     WHERE oc.milestone_id = m.id) AS completions_total,
                  (SELECT count(*)::int FROM offer_completions oc
                     WHERE oc.milestone_id = m.id
                       AND oc.credited_at >= now() - ($2 || ' days')::interval) AS completions_window,
                  (SELECT count(DISTINCT oc.user_id)::int FROM offer_completions oc
                     WHERE oc.milestone_id = m.id
                       AND oc.credited_at >= now() - ($2 || ' days')::interval) AS unique_users_window
             FROM offer_milestones m
            WHERE m.offer_id = $1
            ORDER BY m.sort_order, m.event_name`,
          [offerId, String(days)],
        ),
        offer.everflow_offer_id
          ? query<any>(
              `SELECT status, count(*)::int AS c
                 FROM offer_postback_log
                WHERE everflow_offer_id = $1
                  AND created_at >= now() - ($2 || ' days')::interval
                GROUP BY status
                ORDER BY c DESC`,
              [offer.everflow_offer_id, String(days)],
            )
          : Promise.resolve([] as any[]),
        query<any>(
          `SELECT oc.id, oc.user_id, oc.everflow_transaction_id, oc.credited_at,
                  oc.milestone_id, m.event_name AS milestone_event, m.reward_amount,
                  u.nickname, u.email
             FROM offer_completions oc
             JOIN users u ON u.id = oc.user_id
             JOIN offer_milestones m ON m.id = oc.milestone_id
            WHERE oc.offer_id = $1
            ORDER BY oc.credited_at DESC
            LIMIT 50`,
          [offerId],
        ),
        offer.everflow_offer_id
          ? query<any>(
              `SELECT id, user_id, transaction_id, status, error_message,
                      everflow_event_id, created_at, raw_query
                 FROM offer_postback_log
                WHERE everflow_offer_id = $1
                ORDER BY created_at DESC
                LIMIT 50`,
              [offer.everflow_offer_id],
            )
          : Promise.resolve([] as any[]),
        query<any>(
          `SELECT oc.user_id, u.nickname, u.email,
                  count(*)::int AS completions,
                  coalesce(sum(m.reward_amount), 0)::float AS reward_total
             FROM offer_completions oc
             JOIN users u ON u.id = oc.user_id
             JOIN offer_milestones m ON m.id = oc.milestone_id
            WHERE oc.offer_id = $1
            GROUP BY oc.user_id, u.nickname, u.email
            ORDER BY completions DESC, reward_total DESC
            LIMIT 20`,
          [offerId],
        ),
      ]);

    // Payout estimate — pay-per-completion model using offers.payout_cents.
    // If the offer uses a per-milestone reward model instead, we still surface
    // the raw count so the admin can compute payout themselves.
    const payoutCents = offer.payout_cents || 0;
    const payout_total_cents = (summaryRow?.completions_total || 0) * payoutCents;
    const payout_window_cents = (summaryRow?.completions_in_window || 0) * payoutCents;

    const postbacks_ok =
      postbackStatus.find((r: any) => r.status === 'success')?.c || 0;
    const postbacks_errors = postbackStatus
      .filter((r: any) => r.status !== 'success')
      .reduce((s: number, r: any) => s + (r.c || 0), 0);

    res.json({
      days,
      offer: {
        id: offer.id,
        name: offer.name,
        everflow_offer_id: offer.everflow_offer_id,
        payout_cents: payoutCents,
      },
      summary: {
        completions_total: summaryRow?.completions_total || 0,
        completions_in_window: summaryRow?.completions_in_window || 0,
        unique_users: summaryRow?.unique_users || 0,
        postbacks_ok,
        postbacks_errors,
        payout_total_cents,
        payout_window_cents,
      },
      milestones,
      postback_status: postbackStatus,
      recent_completions: recentCompletions,
      recent_postbacks: recentPostbacks,
      top_users: topUsers,
    });
  } catch (err) {
    console.error('[admin/offers/:id/analytics]', err);
    res.status(500).json({ error: 'Failed to load offer analytics' });
  }
});

adminOffersRouter.post('/', async (req, res) => {
  try {
    const { name, description, reward_type, everflow_offer_id, tracking_link_template, sort_order, store_url, payout_cents, milestones } = req.body;

    const offer = await withTransaction(async (txQ, txQ1) => {
      const row = await txQ1(
        `INSERT INTO offers (name, description, reward_type, everflow_offer_id, tracking_link_template, sort_order, store_url, payout_cents, icon_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '')
         RETURNING *`,
        [name, description || '', reward_type, everflow_offer_id, tracking_link_template, sort_order || 0, store_url || '', payout_cents || 0]
      );

      if (milestones?.length) {
        for (const m of milestones) {
          await txQ1(
            `INSERT INTO offer_milestones (offer_id, event_name, everflow_event_id, reward_amount, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [row.id, m.event_name, m.everflow_event_id, m.reward_amount, m.sort_order || 0]
          );
        }
      }
      return row;
    });

    res.json(offer);
  } catch (err) {
    console.error('[admin/offers POST]', err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

adminOffersRouter.put('/:id', async (req, res) => {
  try {
    const { name, description, reward_type, everflow_offer_id, tracking_link_template, sort_order, active, store_url, payout_cents, milestones } = req.body;

    await withTransaction(async (txQ, txQ1, txExec) => {
      await txExec(
        `UPDATE offers SET name=$2, description=$3, reward_type=$4, everflow_offer_id=$5,
          tracking_link_template=$6, sort_order=$7, active=$8, store_url=$9, payout_cents=$10
         WHERE id=$1`,
        [req.params.id, name, description || '', reward_type, everflow_offer_id, tracking_link_template, sort_order || 0, active ?? true, store_url || '', payout_cents || 0]
      );

      if (milestones) {
        await txExec(`DELETE FROM offer_milestones WHERE offer_id = $1`, [req.params.id]);
        for (const m of milestones) {
          await txQ1(
            `INSERT INTO offer_milestones (offer_id, event_name, everflow_event_id, reward_amount, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.params.id, m.event_name, m.everflow_event_id, m.reward_amount, m.sort_order || 0]
          );
        }
      }
    });

    const updated = await queryOne(`SELECT * FROM offers WHERE id = $1`, [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('[admin/offers PUT]', err);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upload (or replace) the icon for an offer.
 *
 * Files land on a named Docker volume mounted at UPLOAD_DIR — see the
 * `offer_assets` volume in docker-compose.yml. The same volume is
 * mounted read-only inside the nginx (web) container at
 * /usr/share/nginx/html/assets/offers/, which is how the browser then
 * fetches the icon via the same `/assets/offers/...` URL returned here.
 */
adminOffersRouter.post('/:id/icon', (req, res, next) => {
  // Wrap multer so we can turn its errors (file too large, bad mime,
  // disk full, etc.) into proper JSON responses instead of default HTML.
  upload.single('icon')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large (max 2 MB)' });
        return;
      }
      console.error('[admin/offers/icon] multer:', err);
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid offer ID' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file or unsupported format (png / jpg / jpeg / webp)' });
      return;
    }
    const offerExists = await queryOne<{ id: string }>(
      `SELECT id FROM offers WHERE id = $1`,
      [req.params.id],
    );
    if (!offerExists) {
      // Clean up the orphan file we just wrote — otherwise the volume
      // collects garbage from typos in the URL.
      fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    const iconUrl = `/assets/offers/${req.file.filename}`;
    await execute(`UPDATE offers SET icon_url = $2 WHERE id = $1`, [req.params.id, iconUrl]);
    res.json({ icon_url: iconUrl });
  } catch (err) {
    console.error('[admin/offers/icon]', err);
    res.status(500).json({ error: 'Failed', details: (err as Error).message });
  }
});

adminOffersRouter.delete('/:id', async (req, res) => {
  try {
    await execute(`UPDATE offers SET active = false WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/offers DELETE]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
