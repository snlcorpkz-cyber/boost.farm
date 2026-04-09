import { Router, Request, Response } from 'express';
import { query } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get('/', async (_req: Request, res: Response) => {
  const products = await query(`SELECT * FROM products WHERE active = true`);
  res.json({ success: true, data: { products } });
});
