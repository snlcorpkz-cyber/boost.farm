/**
 * Shared types for the partner framework.
 *
 * Consumed by:
 *   - `packages/api` — DTO shapes at the HTTP boundary
 *   - `apps/partner` — partner-facing dashboard
 *   - `apps/admin`   — admin's "Partners" section (when it lands)
 */

export type PartnerType = 'offerwall' | 'affiliate' | 'network' | 'influencer' | 'other';
export type PartnerStatus = 'draft' | 'active' | 'paused' | 'archived';
export type PartnerApprovalMode = 'auto' | 'manual';
export type PartnerPostbackMethod = 'GET' | 'POST';

export interface Partner {
  id: string;
  slug: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  defaultPayoutCents: number;
  postbackUrlTemplate: string | null;
  postbackMethod: PartnerPostbackMethod;
  approvalMode: PartnerApprovalMode;
  holdHours: number;
  contactEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PartnerConversionStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'duplicate';

/** Canonical event types we record in `partner_conversions`. */
export type PartnerEventType =
  | 'install'
  | 'first_play'
  | 'stage_reached'
  | 'harvest'
  | string; // future-proof; dashboard rendering is event-type agnostic

export interface PartnerConversion {
  id: string;
  partnerId: string;
  userIdHash: string;          // never the raw user_id — always hashed
  clickId: string | null;
  eventType: PartnerEventType;
  payoutCents: number;
  status: PartnerConversionStatus;
  holdUntil: string | null;
  createdAt: string;
  approvedAt: string | null;
  paidAt: string | null;
}

export interface PartnerOverview {
  partner: {
    slug: string;
    name: string;
    status: PartnerStatus;
    defaultPayoutCents: number;
    postbackConfigured: boolean;
  };
  range: { days: number };
  totals: {
    attributedUsers: number;   // users.partner_id = X in window
    conversions: number;
    harvests: number;
    payoutPendingCents: number;
    payoutApprovedCents: number;
    payoutPaidCents: number;
  };
  funnel: Array<{ step: string; users: number; pct: number }>;
  daily: Array<{ date: string; installs: number; harvests: number; payoutCents: number }>;
}

export interface PartnerPostbackLogEntry {
  id: string;
  createdAt: string;
  sentAt: string | null;
  status: 'queued' | 'sent' | 'failed' | 'dead';
  attempts: number;
  url: string;
  lastResponseCode: number | null;
  lastError: string | null;
}

export interface PartnerSession {
  accountId: string;
  partnerId: string;
  partnerSlug: string;
  partnerName: string;
  email: string;
  role: 'partner' | 'partner_admin';
}
