import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { adminDashboardRouter } from './dashboard.js';
import { adminUsersRouter } from './users.js';
import { adminOffersRouter } from './offers.js';
import { adminPushRouter } from './push-campaigns.js';
import { adminLogsRouter } from './logs.js';
import { adminRetentionRouter } from './retention.js';
import { adminHealthRouter } from './health.js';
import { adminAdsRouter } from './ads.js';
import { adminAnalyticsRouter } from './analytics.js';
import { adminAcquisitionRouter } from './acquisition.js';
import { adminPartnersRouter } from './partners.js';
import { adminJobsRouter } from './jobs.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.use('/dashboard', adminDashboardRouter);
adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/offers', adminOffersRouter);
adminRouter.use('/push', adminPushRouter);
adminRouter.use('/logs', adminLogsRouter);
adminRouter.use('/retention', adminRetentionRouter);
adminRouter.use('/health', adminHealthRouter);
adminRouter.use('/ads', adminAdsRouter);
adminRouter.use('/analytics', adminAnalyticsRouter);
adminRouter.use('/acquisition', adminAcquisitionRouter);
adminRouter.use('/partners', adminPartnersRouter);
adminRouter.use('/jobs', adminJobsRouter);
