/* The 33 options (spec §8.8) — single source of truth for server + client.
   Each: group, key, i18n label/description, optional "owns" sub-setting
   (tab + field anchor) and jump target for the "Configure →" link. */

export const OPTION_GROUPS = [
  { key: 'g1', name: 'Publishing & Content' },
  { key: 'g2', name: 'Filters & Rules' },
  { key: 'g3', name: 'Pacing & Scheduling' },
  { key: 'g4', name: 'Notifications' },
  { key: 'g5', name: 'AI & Automation' },
  { key: 'g6', name: 'Data & Security' },
];

export const OPTIONS = [
  /* g1 — Publishing & Content */
  { g: 'g1', key: 'auto_approve_trusted', owns: { tab: 'automation', field: 'approval' } },
  { g: 'g1', key: 'dedupe_posts', owns: null },
  { g: 'g1', key: 'strip_links', owns: null },
  { g: 'g1', key: 'brand_footer', owns: { tab: 'brand', field: 'footer' } },
  { g: 'g1', key: 'auto_translate', owns: { tab: 'automation', field: 'translateTo' } },
  { g: 'g1', key: 'ai_rewrite', owns: null },
  { g: 'g1', key: 'auto_hashtags', owns: { tab: 'brand', field: 'hashtags' } },
  { g: 'g1', key: 'link_shortener', owns: { tab: 'automation', field: 'shortenerDomain' } },
  /* g2 — Filters & Rules */
  { g: 'g2', key: 'blocklist', owns: { tab: 'ai', field: 'blocklist' } },
  { g: 'g2', key: 'allowlist_only', owns: { tab: 'ai', field: 'allowlist' } },
  { g: 'g2', key: 'skip_no_media', owns: null },
  { g: 'g2', key: 'max_post_age', owns: { tab: 'automation', field: 'maxPostAge' } },
  { g: 'g2', key: 'flag_keywords', owns: { tab: 'ai', field: 'flagKeywords' } },
  { g: 'g2', key: 'profanity_filter', owns: null },
  /* g3 — Pacing & Scheduling */
  { g: 'g3', key: 'quiet_hours', owns: { tab: 'pacing', field: 'quiet' } },
  { g: 'g3', key: 'best_time', owns: { tab: 'pacing', field: 'bestTime' } },
  { g: 'g3', key: 'random_jitter', owns: { tab: 'pacing', field: 'jitter' } },
  { g: 'g3', key: 'weekend_pause', owns: { tab: 'pacing', field: 'weekend' } },
  { g: 'g3', key: 'burst_guard', owns: { tab: 'pacing', field: 'burst' } },
  /* g4 — Notifications */
  { g: 'g4', key: 'daily_report', owns: { tab: 'general', field: 'reportTime' } },
  { g: 'g4', key: 'notify_failure', owns: null },
  { g: 'g4', key: 'notify_pending', owns: { tab: 'notifications', field: 'pendingThreshold' } },
  { g: 'g4', key: 'health_alert', owns: { tab: 'notifications', field: 'healthThreshold' } },
  { g: 'g4', key: 'weekly_digest', owns: { tab: 'notifications', field: 'digestDay' } },
  /* g5 — AI & Automation */
  { g: 'g5', key: 'ai_pilot_suggest', owns: { tab: 'ai', field: 'pilotMode' } },
  { g: 'g5', key: 'auto_replies', owns: { tab: 'autoreplies', field: 'top' } },
  { g: 'g5', key: 'smart_discover', owns: null },
  { g: 'g5', key: 'auto_route', owns: { tab: 'routing', field: 'top' } },
  /* g6 — Data & Security */
  { g: 'g6', key: 'auto_backup', owns: { tab: 'storage', field: 'backupFreq' } },
  { g: 'g6', key: 'cloud_sync', owns: { tab: 'storage', field: 'cloudProvider' } },
  { g: 'g6', key: 'extended_audit', owns: { tab: 'storage', field: 'auditRetention' } },
  { g: 'g6', key: 'pin_for_changes', owns: { tab: 'whatsapp', field: 'pin' } },
  { g: 'g6', key: 'confirm_bulk', owns: null },
];

export const OPTION_COUNT = OPTIONS.length; // 33
