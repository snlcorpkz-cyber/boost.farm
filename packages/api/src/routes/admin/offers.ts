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

adminOffersRouter.post('/:id/icon', upload.single('icon'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const iconUrl = `/assets/offers/${req.file.filename}`;
    await execute(`UPDATE offers SET icon_url = $2 WHERE id = $1`, [req.params.id, iconUrl]);
    res.json({ icon_url: iconUrl });
  } catch (err) {
    console.error('[admin/offers/icon]', err);
    res.status(500).json({ error: 'Failed' });
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
