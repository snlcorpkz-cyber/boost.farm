import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { adminDashboardRouter } from './dashboard.js';
import { adminUsersRouter } from './users.js';
import { adminOffersRouter } from './offers.js';
import { adminPushRouter } from './push-campaigns.js';
import { adminLogsRouter } from './logs.js';
import { adminRetentionRouter } from './retention.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.use('/dashboard', adminDashboardRouter);
adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/offers', adminOffersRouter);
adminRouter.use('/push', adminPushRouter);
adminRouter.use('/logs', adminLogsRouter);
adminRouter.use('/retention', adminRetentionRouter);
