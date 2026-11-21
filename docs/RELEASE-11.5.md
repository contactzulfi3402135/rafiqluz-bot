# Raqifluz 11.5 — delivery and control upgrade

Heroku deployment is retained. This release makes substantial changes to the
existing single-workspace bot while retaining its three switchable designs and
light/dark/system appearance. Read README-HEROKU.txt before upgrading.

## What's new
- A per-source, per-target, per-part SQLite delivery journal: sends are marked
  in progress before the provider call, accepted only afterward, and unknown
  outcomes require an owner decision. Successful targets/parts are not resent
  during ordinary retries. Later parts do not leapfrog a failed earlier part.
- Approval Queue → Live → Delivery review displays uncertain, interrupted and
  unverified sends. An owner can mark accepted or explicitly permit a retry
  after checking the destination. Retry can duplicate a message. A changed
  payload is blocked from reusing a previous receipt.
- Post history now has per-target delivery details, and Compose keeps the draft
  visible when a send is partial or uncertain. Invalid selected targets cannot
  accidentally fall back to broadcasting to all targets.
- Partial fan-out, paused/missing targets, and media read-back failures are no
  longer represented as a fully published post. Provider acceptance is not a
  delivery receipt. Legacy recorded copies without a journal are conservatively
  blocked from automatic retry; inspect destinations before republishing.
- Approval-first items and AI weekly plans actually wait for approval, even
  with zero delay or a delay buffer. Missing held media is never silently
  replaced by text-only content. Failed queue items and their media are retained.
- Interrupted queue items require review rather than autopilot replay. Fixed
  scheduled-channel persistence/overlap and the personal-message scheduler's
  per-number socket selection and concurrent runs. Daily/weekly schedules use
  local calendar times across ordinary daylight-saving transitions. Schedule occurrences use
  journal records and uncertain outcomes are not automatically resent.
- AI post-text bot-control action creates a human-approved draft. AI content
  sharing is explicitly opt-in, including for existing installations; keys and
  settings remain intact. With AI safety enabled, owners can choose legacy
  continue-on-unavailable or hold for human review. It is not a guarantee that
  content is safe. Other AI bot-control actions retain their existing authority.
- Optional GitHub snapshots can include held approval media only with the
  separate PERSIST_HOLD_MEDIA=1 opt-in, and schedule a best-effort sync after
  journal updates. Manual DB export still excludes held
  media and WhatsApp sessions; see the Heroku guide for recovery limitations.
- Shutdown blocks new journalled sends before attempting the final snapshot;
  this remains best-effort and Heroku can terminate the dyno.
- Additive schema; no intentional deletion of existing posts, settings, queues,
  schedules or credentials. Old pending approval-first drafts are migrated to
  human approval on startup; older timed holds keep their existing timing.

## Important limitations
No official WhatsApp Cloud API, tenant isolation, shared durable queue, formal
availability guarantee, exactly-once delivery, end-to-end consent framework or
multi-dyno support is implemented. Some existing integrations and direct send
paths are outside the new channel/personal-schedule journal. Bot-control and
other automation can still make changes if enabled. AI content consent does
not govern GitHub, RSS, webhooks, email or provider model discovery. Review each
integration separately. Provider outcomes are inherently ambiguous, and stale
Heroku snapshots can lose receipts as well as content.

## Verification
`npm test` runs isolated backup, archive, migration, mocked delivery/automation,
cloud-media and local HTTP integration tests.
`tests/security-integration.js` mutates settings and is only for an isolated
server with TEST_ALLOW_MUTATIONS=1. Live WhatsApp, a real Heroku deployment,
GitHub credentials, SMTP, and production data are not exercised by those tests.
