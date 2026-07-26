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
import { adminReportRouter } from './report.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// Dynamic JSON — do not allow shared caches or stale revalidation (304) via
// intermediaries; the SPA uses fetch + React Query polling on many routes.
adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

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
adminRouter.use('/report', adminReportRouter);
