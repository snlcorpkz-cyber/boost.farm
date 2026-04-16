import { Router } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const adminLogsRouter = Router();

adminLogsRouter.get('/events', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string || '';
    const eventName = req.query.event_name as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let pi = 0;

    if (userId) {
      pi++;
      where += ` AND e.user_id = $${pi}::uuid`;
      params.push(userId);
    }
    if (eventName) {
      pi++;
      where += ` AND e.event_name = $${pi}`;
      params.push(eventName);
    }

    const rows = await query(
      `SELECT e.*, u.nickname, u.email
       FROM events e
       JOIN users u ON u.id = e.user_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, limit, offset]
    );

    const countRow = await queryOne(
      `SELECT count(*)::int AS c FROM events e ${where}`,
      params
    );

    res.json({ events: rows, total: countRow?.c || 0, page, limit });
  } catch (err) {
    console.error('[admin/logs/events]', err);
    res.status(500).json({ error: 'Failed' });
  }
});

adminLogsRouter.get('/events/names', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT event_name, count(*)::int AS c FROM events GROUP BY event_name ORDER BY c DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

adminLogsRouter.get('/postbacks', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
    const offset = (page - 1) * limit;
    const status = req.query.status as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let pi = 0;

    if (status) {
      pi++;
      where += ` AND status = $${pi}`;
      params.push(status);
    }

    const rows = await query(
      `SELECT * FROM offer_postback_log ${where} ORDER BY created_at DESC LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      [...params, limit, offset]
    );
    const countRow = await queryOne(`SELECT count(*)::int AS c FROM offer_postback_log ${where}`, params);

    res.json({ postbacks: rows, total: countRow?.c || 0, page, limit });
  } catch (err) {
    console.error('[admin/logs/postbacks]', err);
    res.status(500).json({ error: 'Failed' });
  }
});
