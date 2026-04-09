import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { farmRouter } from './routes/farm.js';
import { userRouter } from './routes/user.js';
import { friendsRouter } from './routes/friends.js';
import { questsRouter } from './routes/quests.js';
import { gamesRouter } from './routes/games.js';
import { petsRouter } from './routes/pets.js';
import { productsRouter } from './routes/products.js';
import { errorHandler } from './middleware/error-handler.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);
app.use('/farm', farmRouter);
app.use('/user', userRouter);
app.use('/friends', friendsRouter);
app.use('/quests', questsRouter);
app.use('/games', gamesRouter);
app.use('/pets', petsRouter);
app.use('/admin/products', productsRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[API] Running on http://localhost:${PORT}`);
});

export default app;
