import { Router } from 'express';
import { partnerAuthRouter } from './auth.js';
import { partnerOverviewRouter } from './overview.js';
import { partnerConversionsRouter } from './conversions.js';
import { partnerPostbacksRouter } from './postbacks.js';
import { partnerSettingsRouter } from './settings.js';
import { requirePartner } from '../../middleware/partner.js';

export const partnerRouter = Router();

// Public — login lives under the same base, no auth middleware needed
partnerRouter.use('/auth', partnerAuthRouter);

// Everything else requires a partner JWT. `requirePartner` attaches
// `req.partner` with the partner_id that every handler uses to scope
// queries. Partner portals MUST NEVER read data outside their own row.
partnerRouter.use('/overview', requirePartner, partnerOverviewRouter);
partnerRouter.use('/conversions', requirePartner, partnerConversionsRouter);
partnerRouter.use('/postbacks', requirePartner, partnerPostbacksRouter);
partnerRouter.use('/settings', requirePartner, partnerSettingsRouter);

// Convenience: /partner/me returns the JWT payload so the portal can
// show "logged in as X" in the header without a separate roundtrip.
partnerRouter.get('/me', requirePartner, (req, res) => {
  res.json({ success: true, data: req.partner });
});
