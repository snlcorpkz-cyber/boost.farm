# Campaign naming conventions — Meta Ads Manager

**Rule zero:** every name is a structured string, not free text. Analytics joins
Meta breakdowns to our own database via `utm_content = {{ad.name}}`. If the
string is malformed the join silently drops the row.

---

## Structure

```
Campaign:  {geo}_{objective}_{yymm}
Ad Set:    {campaign}_{audience}_{event}
Ad:        {adset}_{concept}_{format}_{variant}
```

Delimiter is `_` (underscore). Never use spaces, never use hyphens —
Meta sometimes encodes them inconsistently in macros.

### Tokens

| Token       | Allowed values                                            | Example                       |
|-------------|-----------------------------------------------------------|-------------------------------|
| `geo`       | ISO 3166-1 alpha-2, upper-case, or `WW` for worldwide     | `KZ`, `RU`, `WW`              |
| `objective` | `AppInstalls`, `AppEvents`, `Traffic` (rare)              | `AppInstalls`                 |
| `yymm`      | 4-digit year-month, e.g. campaign launched November 2025  | `2511`                        |
| `audience`  | `Broad`, `Interests`, `LAL1`, `LAL3`, `LAL10`, `Retarget` | `Broad`                       |
| `event`     | `CompletedRegistration`, `EngagedD0`, `Purchase`          | `EngagedD0`                   |
| `concept`   | Short hook slug, `CamelCase`, ≤20 chars                   | `HarvestTestimonial`          |
| `format`    | `9x16`, `1x1`, `4x5`, `16x9`                              | `9x16`                        |
| `variant`   | `v1`, `v2`, …; bump whenever thumbnail or hook changes    | `v1`                          |

### Full example

```
Campaign: KZ_AppInstalls_2511
Ad Set:   KZ_AppInstalls_2511_Broad_EngagedD0
Ad:       KZ_AppInstalls_2511_Broad_EngagedD0_HarvestTestimonial_9x16_v1
```

The last token is what our admin acquisition dashboard (`/admin/acquisition/by-creative`)
renders in the `utm_content` column — so "which creative is winning" is
just a sort by `engaged_d0_pct`.

---

## What NOT to do

- ❌ Don't rename live ads — their `utm_content` would shift and split
  the stats across two rows. Create a new ad (`_v2`) instead.
- ❌ Don't add emojis or non-ASCII to names. `{{ad.name}}` URL-encodes
  them, breaking `Uri.parse` on some Android versions.
- ❌ Don't reuse a concept slug across formats with different hooks —
  each unique *hook + format* gets its own slug + variant.
- ❌ Don't duplicate campaigns per ad set when you could add ad sets
  to one campaign (CBO needs a shared budget to work).

## URL parameters

Every ad must have this tracking URL configured in Meta Ads Manager
at the Ad level → *Tracking → URL Parameters*:

```
utm_source=fb
utm_medium=paid_social
utm_campaign={{campaign.name}}
utm_content={{ad.name}}
fb_campaign_id={{campaign.id}}
fb_adset_id={{adset.id}}
fb_ad_id={{ad.id}}
```

These prefill the Play Install Referrer, which our Android side parses in
`InstallReferrerHelper.kt` and our API persists into `users.acquisition_source`.

## Lifecycle flags for review

When reviewing the weekly report, tag each ad with one of:

- ✅ **Winner** — engaged_d0_pct above median *and* CPI ≤ target. Duplicate
  into a new ad set with higher budget.
- ⏸️ **Paused** — engaged_d0_pct below 25th percentile after 500 impressions.
- 🧪 **Testing** — <500 impressions, not enough signal yet.

Keep a running spreadsheet; never rely on Meta's "Status" column — it
reflects delivery, not creative quality.
