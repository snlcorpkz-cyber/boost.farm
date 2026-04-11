import { Router, Request, Response } from 'express';
import { query } from '../lib/db.js';

export const productsRouter = Router();

productsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const products = await query(`SELECT * FROM products WHERE active = true ORDER BY difficulty_stars ASC, name_key ASC`);
    console.log(`[products] Returned ${products.length} products`);
    res.json({ success: true, data: { products } });
  } catch (err) {
    console.error('[products] DB query failed:', (err as Error).message);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: 'Failed to load products' },
    });
  }
});
