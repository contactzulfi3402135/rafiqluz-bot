════════════════════════════════════════════════════════════════
 RAQIFLUZ CHANNEL BOT v7.6.0 — DEPLOY GUIDE (GitHub Desktop + Heroku)
════════════════════════════════════════════════════════════════

WHAT THIS BOT DOES
──────────────────
You follow WhatsApp channels → everything they post is mirrored to YOUR
channel automatically (cleaned + beautified on the way). 100% hands-off:
follow a channel on your phone and it becomes a source within minutes.

  •  Sources  → the channels you follow (mirrored FROM) — shown by NAME
  •  Targets  → only channels where this account is OWNER ★ or ADMIN
     (WhatsApp refuses posts from plain followers)
  •  Cloud memory → the bot saves its own login + data to your private
     GitHub repo, so Heroku restarts never lose anything and never ask
     for a new QR scan.
  •  FAST mirroring → live push delivers posts within seconds; the
     push subscription is re-armed automatically before it can expire,
     and a safety-net check every 30 s catches anything push missed.
     Photos, videos and files in posts are mirrored too — and every
     media post is VERIFIED (if WhatsApp doesn't show it, you see an
     honest failure, never a silent loss).
  •  Self-heal → anything posted while the bot was offline/restarting
     is recovered and published on reconnect.
  •  New Post tab → write + publish posts to your channel from the
     dashboard (optional AI clean-up, optional image URL).
  •  WhatsApp tab → the official WhatsApp Web look: search + All/Unread/
     Archived filters, unread badges, date dividers, bubble tails & ticks,
     media previews, emoji picker, green send button — full mirror of the
     account's chats and you can REPLY right from the dashboard.

NEW IN v7.0.0 — MANY NUMBERS + CHAT FEATURES
────────────────────────────────────────────
  •  PUBLIC pairing page → https://YOUR-APP.herokuapp.com/connect
     ANY of your numbers can scan the QR there and gets connected — no
     dashboard password needed just to link a phone. Chats stay inside
     the password-protected dashboard.
  •  One dashboard, many numbers → the 👤 chip inside the WhatsApp tab
     switches between connected numbers (each with its own chats,
     unread counts and send ability). Contacts of every number sync in
     too (📇 chip = the address book, names label every chat).
  •  History sync → right after a scan, WhatsApp sends the same chat
     history it gives a new linked device (recent chats, groups and
     messages) — the dashboard imports it automatically.
  •  🛡️ Anti-delete → when someone deletes a message "for everyone",
     the copy archived here stays readable (WhatsApp only sends a
     "hide it" packet — the text was already stored).
  •  👁️ Anti-view-once → view-once photos/videos are downloaded to the
     dashboard the moment they arrive, before you ever open them on the
     phone. Opening on the phone cannot remove the saved copy.
  •  ✏️ Anti-edit → edited messages keep their original text (tap the
     bubble to read what was written first).
  •  📞 Call log → incoming calls are logged in the chat like the
     official app. Optional auto-reject in Settings (OFF by default).
  •  Feature switches live in Settings ("Chat features" card):
     anti-delete / anti-view-once / anti-edit default ON, call
     auto-reject default OFF.

NEW IN v7.1.0 — MODEL PICKER PER AI
──────────────────────────────────
  •  In Settings → 🤖 AI provider you now pick the AI, then pick the MODEL
     of that AI from a dropdown — exactly like the provider list itself.
  •  After saving an API key, "🔄 Fetch live model list" asks the provider
     itself for its current catalog (Gemini, OpenAI, Claude, Grok, Groq,
     DeepSeek, Mistral, OpenRouter and the other OpenAI-compatible ones).
     The live list is cached for 10 minutes.
  •  No key yet / provider has no catalog endpoint → a curated built-in
     list for that provider is shown, so the picker is never empty.
  •  A custom model id box stays for brand-new or private models — what
     you type there wins over the picker.

NEW IN v7.2.0 — NO MORE QR RE-SCANS + REAL MODEL LISTS
─────────────────────────────────────────────────────
  •  FOUND AND FIXED the real reason deploys asked for a QR scan again.
     The bot SAVED its login to the "bot-state" branch of your GitHub repo
     but tried to READ it back from the repo's default branch — so every
     restart found nothing and asked you to scan. Three more holes were
     fixed in the same pass:
       1. reads are now branch-aware (with a default-branch fallback, so
          state saved by older versions is still recovered),
       2. the "bot-state" branch is CREATED AUTOMATICALLY if it does not
          exist yet (GitHub refuses writes to a missing branch — that is
          what silently broke the very first backup),
       3. the login is now saved ~8 seconds AFTER pairing/connecting and
          after every key change, plus one last save during every deploy
          shutdown (SIGTERM) — so the freshest login always survives.
     Practical result: scan the QR ONCE. Deploys, restarts and dyno
     cycles afterwards re-use the saved login automatically.
     (The QR comes back only if you unlink the device from the phone, or
      if Heroku wipes the dyno filesystem AND cloud memory is switched
      off — in that case the Home tab and the /connect page now show a
      loud "Cloud memory is OFF" warning.)
  •  Model pickers refreshed to the OCTOBER 2026 lineups of all 20 AIs
     (Gemini 3.x, GPT-5.5 family, Claude 5, Grok 4.3, DeepSeek V4,
     Qwen 3.8, GLM 5.3, Mistral 4, free OpenRouter tier, …).
  •  The old "Live list unavailable (HTTP 401)" note is gone. If a live
     list cannot be read you now see WHICH AI failed, WHY (e.g. HTTP 401
     = the saved key was rejected), and how many built-in STARTER models
     are being shown meanwhile — with a button to retry. Built-ins are
     labelled a starting point; the provider's live list stays the truth.

NEW IN v7.6.0 — DASHBOARD REBUILD + TEMPLATE ENGINE V2 (upgrade, nothing rebuilt from scratch)
  1) NEW DASHBOARD LAYOUT
     • Sidebar regrouped into 8 sections with 22 views: Overview, Channels
       (Sources/Targets/Routing), Content (Composer, Scheduled, Approval
       Queue, Posts, Templates), Automation (Beautify, AI Pilot, Auto-Reply,
       Digest & Translate, Guardrails), Inbox (WhatsApp, Contacts &
       Journal), Outreach (Bulk, Email), Insights (Analytics, Health, Logs),
       System (Settings). Section headers fold/unfold; your folds are
       remembered. "Ask AI" tab is gone — the robot lives on every tab.
     • Ctrl+K (or the Search button) = command palette: jump to any view or
       run an action from one box.
     • New home = KPI dashboard: WhatsApp status, published/failed today,
       sources/targets, cloud memory, next scheduled post + live activity
       feed. Updates live (no refresh needed).
     • Design refresh: Inter font, real icons (no emoji in the new UI),
       dark + light theme (toggle top-right, remembered).
     • Every view now shows: loading skeleton → content, a proper EMPTY
       state, or an ERROR box with a Retry button. Nothing ever sits silent.
  2) FLOATING AI ROBOT (every tab, draggable)
     • The robot button can be dragged anywhere; it opens the SAME chat
       (same history) with the AI. 4 quick-action chips: "What failed
       today?", "Publish the missed posts now.", "Undo the last post",
       "Show me the bot status." Expand button = full-screen chat.
     • With Bot control ON it can still act for you (post, toggle, undo…).
  3) TEMPLATE ENGINE V2 (new Templates view)
     • 3 zones per template: HEADER / BODY / FOOTER. Placeholders you can
       drop anywhere: {text} the post · {title} first line · {source}
       channel name · {date} · {time} · {hashtags}. Old {{POST}}/{{DATE}}
       still work.
     • 20 named templates + your custom. Every row has a Sample button
       showing STATIC before/after (no AI call — instant, free).
     • Per-template AI style: optional instruction (e.g. "punchy, one line")
       the AI uses when rewriting text in fixed mode.
     • Off / Fixed / Rotate / Shuffle + POOL checkboxes: tick which
       templates Rotate/Shuffle may use.
     • Visual zone builder: 3 boxes + clickable placeholder chips + a RAW
       mode for plain templates + version history (last 5 saved customs,
       one-click restore).
     • WhatsApp-style live preview bubble (right-to-left text supported).
     • Auto-migration from 7.5.0 (nothing deleted): your signature became
       the global FOOTER; the automatic category header is now the post's
       TITLE LINE when a template has no header of its own. The old
       📢 Auto-headers / ✍️ Signature switches in Channel Power still work —
       they feed those same zones.
  NOTHING LOST: multi-number, cloud memory, WhatsApp mirror, AI bot
  control, bulk/email, guardrails — all exactly as before. Deploy the same
  way (commit to main, no QR re-scan, settings survive).
  MEMORY NOTE: this version needs a bit more RAM to start (it restores a bigger
  saved state). If Heroku ever shows an app error right after a deploy, open
  Heroku -> app -> "More" -> "Change size" and make sure it is at least the
  512 MB dyno (the default).

NEW IN v7.5.0 - POST TEMPLATES, HEADER/FOOTER, FLOATING AI ROBOT, ORGANIZED DASHBOARD
  1) POST TEMPLATE (Channel Power → "Post template")
     Rewrites every post's TEXT into your format. Photos/videos are NEVER
     touched — only the text/caption is formatted.
      • 20 ready-made named templates (Bold, Star frame, Quote, Banner bars,
        Megaphone 📢, Date stamp, Box frame, Elegant ✧, …)
      • + YOUR OWN custom template — use {{POST}} for the post text and
        {{DATE}} for today's date
      • Modes: Off · One fixed template · ROTATE (changes in order on every
        post) · SHUFFLE (random every post)
      • Live preview box shows exactly how a post will look
     You can also tell the AI (Bot control ON): "use the Star frame template",
     "rotate the templates", "my template is: ✨ {{POST}} ✨".
  2) HEADER & FOOTER (Channel Power → "Header & Footer")
      • Custom header — replace the automatic 📢 category header with your own
        line (leave empty = automatic). Needs the 🏷️ Auto headers switch.
      • Footer (signature) — your own line at the bottom. Needs the ✍️ switch.
  3) FLOATING AI ROBOT 🤖
     A robot button that lives on EVERY tab. Click it → your AI chat opens
     (the SAME history as the Ask AI tab — everything you said is there).
     Drag the robot (or the panel) anywhere on screen; it stays where you put
     it. Works with Bot control: "post the missed posts" from any tab.
  4) ORGANIZED DASHBOARD (less scrolling)
     Every card now folds: click a card's title to open/close its contents.
     Each tab opens its main card automatically (sources table, posts
     history, …); the rest is folded until you click it. Your open/closed
     choices are remembered. NOTHING moved, nothing removed — same controls,
     just organized. Settings tab cards all start folded (click to open).
  NOTHING ELSE CHANGED. All previous versions' fixes are included
  (cloud memory >1 MB, zombie-socket self-repair, AI bot control).

NEW IN v7.4.0 - AI BOT CONTROL (the Ask AI tab can now ACT for you)
  With "Bot control" ON (the toggle at the top of the Ask AI tab — OFF by
  default), you give the bot orders in plain English and it does them:
   "which posts were missed in the last 24 hours?"   -> lists them (read-only)
   "post the missed posts to my channel"             -> publishes them through
                                                       the normal pipeline
   "turn on scheduling" / "turn off beautify"        -> toggles any feature
   "pause the source Trending Daily"                 -> pauses one channel
   "post this: <your text>"                          -> publishes a custom post
   "what is on right now?"                           -> full status report
  HOW IT WORKS: the AI answers an action with a tool call, the bot executes
  it server-side, and the result comes back as a ⚙️ line in the chat + a
  "ai.tool" line in the Logs tab. Every action is visible — nothing happens
  silently. Missed-post publishing is safe: the dedupe system never posts
  the same post twice, and the anti-spam rate guard still applies.
  WHAT THE AI CAN NEVER DO (hard limits, not just the prompt): delete posts
  or channels, clear anything, change API keys or passwords, add/remove
  phone numbers.
  ALSO IN THIS VERSION:
   • Cloud memory works again for states over 1 MB (the GitHub 422 "sha"
     error is gone) and restores downloads the raw file — see v7.3.8 note.
   • The zombie-socket self-repair from v7.3.7.

NEW IN v7.3.8 - CLOUD MEMORY FIXED FOR LARGE STATES (GitHub 422 "sha")
  Reported: "Last sync error: GitHub upload HTTP 422: 'sha' wasn't supplied".
  Root cause: GitHub's file API stops returning the file CONTENT once a file
  grows beyond 1 MB (it still returns the file's sha). Our cloud memory
  required the content - so once the saved state passed 1 MB (it grows with
  your inbox/media), every sync lost the sha and died with that 422 error,
  AND every deploy's restore could not find the state (QR-scan risk).
  THE FIX (v7.3.8):
   • Uploads now read the sha from the file METADATA (works at any size) -
     the 422 error is gone; syncs succeed again immediately after deploying.
   • Restores now download the raw file when the content is omitted -
     deploys restore your login/settings again at any state size.
   • A clear "GitHub API rate limit" message is shown instead of confusing
     errors when GitHub is throttling (it recovers by itself).
   • A size guard warns well before GitHub's 100 MB file limit.
  Nothing else changed. After deploying: Home tab -> "Test cloud memory"
  should say all good, and "Last sync error" disappears on the next save
  (or press "Back up now" to save immediately).

NEW IN v7.3.7 - BOT NO LONGER SILENTLY STOPS (zombie-socket watchdog)
  Reported: "the bot made posts, then stopped, no response" - recurring.
  Root cause found: a DEAD CONNECTION THAT STILL REPORTS "OPEN". Sometimes
  the WhatsApp connection quietly dies (network blip) without Baileys ever
  seeing a clean close. The status stays "open", no error is logged, no
  reconnect is triggered - but push events stop, so the bot simply stops
  posting and stays stopped, with a clean-looking log. Every safety net
  (pull check, recovery) was failing SILENTLY at the same time because they
  all use that same dead connection.
  THE FIX (v7.3.7):
   • ZOMBIE WATCHDOG - the 30-second pull safety-net now counts failed
     fetches. If the socket claims "open" yet cannot complete a single
     channel fetch for 3 straight cycles, the bot forces a clean
     reconnect with the SAME saved login (no QR needed). Missed posts are
     auto-recovered right after, as before. Log code: wa.zombie.repair.
   • LOG SIGNALS - you can now see from the logs what is happening:
     channel.pull.fail (first sign of a dead connection),
     wa.zombie.repair (the self-repair), and an hourly channel.heartbeat
     ("Pipeline alive - N sources polled...") so silence is no longer
     silent.
   • IMMEDIATE UNSTICK (before/without deploying): Heroku -> Restart app.
     A fresh connection clears the dead one, and the recovery pass
     re-publishes anything the sources posted while the bot was stuck.

NEW IN v7.3.6 — WHATSAPP TAB NOW LOOKS + WORKS LIKE WHATSAPP WEB
  1. CHAT NAMES (no more bare numbers). A chat not in the phone's address
     book is now named from the sender's profile name (pushName) — exactly
     how the official app labels it. Names are learned from BOTH live
     messages and imported history, saved permanently, and a real name is
     never downgraded back to a number by a later message. All chat names
     are re-resolved at every boot, so existing number-named chats fix
     themselves on deploy. (Chats whose owner never set a profile name
     still show the number — that is what real WhatsApp shows too.)
  2. PROFILE PHOTOS. The chat list, the chat header, the contacts panel
     and group senders now show real profile pictures, fetched from
     WhatsApp (fetchProfilePictureUrl; channels use their own picture)
     and cached 30 minutes. If a contact has no photo, the usual coloured
     initial is shown.
  3. PHOTOS IN CHAT. Regular photos in chats are now stored IN FULL
     (resized, capped ~450 KB each, newest 300 kept) so the tab shows the
     actual pictures instead of "📷 Photo (preview not stored)".

  NOTHING ELSE CHANGED. Settings, QR/creds, numbers, sources/targets,
  pipeline and all other features are untouched by this build.

NEW IN v7.3.5 — CHANNEL IMAGES FIXED FOR GOOD
   Image posts from channel sources were failing with "media unfetchable:
   Cannot derive from empty media key". Root cause found in the old v5.7.x
   bot (which made images work): WhatsApp channels store media on the CDN
   as RAW (unencrypted) bytes — the message carries url/directPath/
   fileSha256 and an EMPTY mediaKey BY DESIGN, so Baileys' downloader can
   never derive a key (there is no key to ask the server to refresh — that
   is why the v7.3.4 key-refresh fix could not help). The official apps
   just download the plaintext bytes from the CDN url.
   The pipeline now does exactly what the old bot did: keyless channel
   media → raw CDN download (with sha256 check); stale url → re-fetch the
   post from the channel for a fresh url and download again; only truly
   keyed (non-channel) media goes through Baileys' downloader. Nothing
   else changed.

NEW IN v7.3.4 — TWO FIXES
   1. IMAGE POSTS FAILED WITH "media unfetchable: Cannot derive from empty
      media key" — posts delivered by the 30-second safety-net fetch (and
      some live upserts) arrive without a usable local media key, and the
      channel pipeline had NO key-refresh recovery (the WhatsApp tab had
      one, the mirror didn't). Now the mirror uses the SAME recovery: ask
      WhatsApp for a fresh media key (reuploadRequest), and if that still
      fails, re-fetch the full message from the server and retry.
   2. SOURCES/TARGETS picker: the big checkbox panel is gone — it's back to
      a COMPACT dropdown in the same place as before: click it, tick as many
      channels as you want (select-all included), press "Add selected".
      Bonus: the Publish history now shows the channel NAME instead of the
      raw number, and a source that only has a number name auto-learns its
      real name from WhatsApp the next time it posts.

NEW IN v7.3.3 — SIX FIXES AT ONCE
   1. PUBLIC PAGE: now shows ONLY the QR / pairing instructions. New option:
      connect by PAIRING CODE (no QR) — enter the phone number on the page,
      get an 8-character code, type it in WhatsApp → Linked devices →
      "Link with phone number". Anyone can connect this way.
   2. AI KEYS: each AI keeps its OWN key. Switch between providers freely —
      the key box always tells you whose key it is. Saving a new key
      immediately re-arms a paused AI (no more waiting out the breaker).
   3. AI TEST: the test now requires the provider to echo a random check
      token, so a fake/instant "OK" can never pass. When Ask AI says
      "paused", it now says WHY (reason + minutes left).
   4. SOURCES/TARGETS: multi-select — tick several channels, add them all
      at once. Channel names are auto-filled from your synced channels
      (channel subjects sync too); a channel never renders as a raw number.
   5. SETTINGS SURVIVE DEPLOYS (the WAL fix): SQLite keeps the newest
      writes in bot.sqlite-wal; old backups zipped only bot.sqlite, so the
      cloud copy was always a few changes behind and deploys "restored"
      old settings. Now the WAL is checkpointed before every backup, the
      -wal/-shm files are backed up too, and EVERY settings change is
      auto-saved to the cloud ~5 s after it happens (with retries).
   6. PAIRING-CODE slots on the public page reuse the number limit; a
      disconnected pair-code session is cleaned up when a new code is asked.

NEW IN v7.3.2 — CHAT NAMES FIXED (NO MORE 15-DIGIT IDS) + CONTACT LIST CLEAN
   WHAT YOU WERE SEEING: every chat/contact showed a raw 15-digit WhatsApp
   internal id. WhatsApp's address-book sync stores those digits in the
   contact's name/notify field when a contact has no saved name, and the old
   code trusted that field blindly.
   FIX: digit-ids are now rejected as names at every layer (address book
   lookup, chat titles, group senders, contact list API, dashboard).
   A chat with no known name now shows "+<phone number>" if the number is
   known, otherwise "Contact •<last4>" — never raw digits.

NEW IN v7.3.1 — "EMPTY (model returned no text)" ON GEMINI, FIXED
──────────────────────────────────────────────────────────────────
  •  Gemini 3.x models are "thinking" models: they spend part of the reply
     budget on internal reasoning BEFORE writing the answer. With the old
     small token limit the whole budget went to thinking, so the API
     returned an empty message and the Test/new-chat showed
     "⛔ EMPTY (model returned no text)" for every Gemini model.
  •  Fixed: Gemini requests now ask for low reasoning effort and always
     get room for the answer; if a reply still comes back empty, one
     automatic retry runs with thinking switched off. Verified against a
     mock of Google's endpoint across 6 scenarios (including providers
     that reject "reasoning_effort" / "max_tokens" — the bot learns and
     retries without the offending field).
  •  Same fix protects every "thinking" model on the other 19 providers
     (GPT-5.x, o-series, Grok reasoning, …): short jobs now always get a
     usable answer, and AI cleaning never silently returns nothing.

NEW IN v7.3.0 — CHAT NAMES + REAL HISTORY (the WhatsApp-Web fixes)
──────────────────────────────────────────────────────────────────
  •  FIXED: chats showed as raw 15-digit numbers. In 2026 WhatsApp
     addresses most 1:1 chats by an anonymous "LID" id, not the phone
     number. The bot now maps every LID to the real number (learned from
     the phone's address book and from WhatsApp's own phoneNumberShare
     event) and shows the saved NAME, or +countrynumber, never 15 digits.
  •  FIXED: those same LID chats had their MESSAGES skipped entirely, so
     history "did not sync". Every LID chat is now archived like any
     other. After deploying, press 👤 → Relink once for a number whose
     history is missing — WhatsApp re-sends the new-device history and it
     now imports fully (names included).
  •  NEW: "⏬ Load older messages" button inside every chat — asks your
     phone for older messages of that chat on demand (WhatsApp only
     serves these for chats that already have at least one message here;
     brand-new messages always arrive on their own).
  •  New link in the WhatsApp tab header: "Open real WhatsApp Web ↗".
     An embedded copy of web.whatsapp.com is technically impossible —
     WhatsApp itself blocks being loaded inside other sites — so this
     one-tap link is the honest fallback for anything this tab does not
     cover. The tab itself IS the WhatsApp-Web-style mirror, now with
     correct names + full history.

IF THE HOME TAB SHOWS A CLOUD-MEMORY ERROR (v7.2.1)
───────────────────────────────────────────────────
  •  Press "🔍 Test cloud memory" on the Home tab — it checks, in order:
     your token, the repo it can see, the bot-state branch and the saved
     login — and prints the EXACT cause plus the exact fix.
  •  "HTTP 404" from GitHub → the token was accepted, but that repo either
     does not exist under that name or the token was not given access to
     it. Two usual causes: PERSIST_GITHUB_REPO is not exactly owner/repo
     (v7.2.1 now auto-cleans pasted URLs, .git suffixes and spaces — but a
     typo'd name still needs fixing), or the fine-grained token was created
     without "Only select repositories → your repo" and "Contents: Read
     and write". An empty repo with zero commits also fails — commit one
     file (README.md) from GitHub's website once.
  •  "HTTP 401" → the token itself was rejected (wrong/expired/revoked):
     generate a new fine-grained token as described in step 4 and replace
     PERSIST_GITHUB_TOKEN.
  •  The bot itself keeps working while this is red — but until it is
     green, a deploy or restart will ask for a QR scan again. That warning
     is the whole point of showing it.

HOW THE FEATURES WORK (the honest version)
──────────────────────────────────────────
  ·  A linked-device bot RECEIVES every message — including the "deleted
     for everyone" control packet — so deleting on other phones only
     hides it THERE; our stored copy was taken at arrival and cannot be
     recalled (that is all "anti-delete" is, on any app).
  ·  View-once media is normal encrypted media with a flag; the file is
     delivered to linked devices when it is SENT. We save it at that
     moment (≤5 MB per file, photos resized) — that is "anti-view-once".
  ·  History sync is what makes a new WhatsApp Web device show your old
     chats: WhatsApp sends recent history when a device links. We import
     the same feed. Coverage is whatever WhatsApp chooses to send
     (usually recent months); everything AFTER pairing is captured live.
  ·  We cannot fake read receipts (blue ticks) for messages you read on
     the phone — WhatsApp does not broadcast those to linked devices.
  •  Bulk Send → phone,name lines with {name} personalization, group
     IDs (@g.us) supported, full send history.
  •  Email tab → send emails from YOUR OWN Gmail / iCloud (multiple
     accounts, switch senders any time). Compose, bulk lists with
     {name}, send-later scheduling, test button, full history.
     Each account needs an APP PASSWORD (Gmail: turn on 2-Step
     Verification → myaccount.google.com/apppasswords · iCloud:
     appleid.apple.com → Sign-In and Security → App-Specific
     Passwords). Stay under ~150 emails/day on Gmail. Channel posts
     are never auto-emailed — every send is yours.
  •  Ask AI tab → chat with the bot's AI (uses your AI key).
  •  13 POWER SWITCHES, ALL OFF BY DEFAULT (Channel Power tab):
     🗓️ Scheduler · 🔀 Smart routing · 📊 Analytics · ✍️ Edit posts ·
     🤖 AI pilot · 🔁 Smart dedupe · ✨ AI beautify · 🏷️ Auto headers ·
     #️⃣ Auto hashtags · 🌐 AI translate · 💬 AI auto-reply (answers
     personal WhatsApp messages for you) · 📰 AI daily digest ·
     ✍️ Signature (your footer on every post).
  •  20 AI PROVIDERS (Settings tab) — OpenRouter, Token Harbor, Google
     Gemini, OpenAI/ChatGPT, xAI/Grok, Anthropic/Claude, Groq, DeepSeek,
     Mistral, Together, Cohere, Perplexity, Fireworks, Cerebras,
     SambaNova, Novita, SiliconFlow, Hugging Face, Alibaba/Qwen, Zhipu/GLM.
     Each shows a clickable "Get API key" link (opens in a new tab) and a
     🧪 Test connection button that verifies your key + model live.
  •  Always-on guardrails (Settings): word blocklist, find→replace rules,
     rate guard — plus a ⏸ pause-all button on Home (stop all mirroring
     instantly; nothing is lost, posts are recovered on resume).

──────────────────────────────────────────────────────────────────
 STEP 1 — CREATE A NEW PRIVATE GITHUB REPO
──────────────────────────────────────────────────────────────────
 1. github.com → New repository
 2. Name: anything (e.g. raqifluz-bot) · PRIVATE · Do NOT add a README
 3. Create repository

──────────────────────────────────────────────────────────────────
 STEP 2 — PUSH THIS FOLDER WITH GITHUB DESKTOP
──────────────────────────────────────────────────────────────────
 1. Unzip this zip anywhere (e.g. Desktop\raqifluz-bot)
 2. GitHub Desktop → File → Add local repository → choose the folder
 3. "Create a repository" if asked (keep the name)
 4. Commit message: "Raqifluz v6.0.0" → Commit to main
 5. Publish repository → make sure PRIVATE is ticked → Publish

──────────────────────────────────────────────────────────────────
 STEP 3 — CREATE A NEW HEROKU APP
──────────────────────────────────────────────────────────────────
 1. dashboard.heroku.com → New → Create new app
 2. Name: anything (e.g. raqifluz-bot) → Create

──────────────────────────────────────────────────────────────────
 STEP 4 — CONNECT THE REPO + SET THE 7 CONFIG VARS
──────────────────────────────────────────────────────────────────
 1. Heroku app → Deploy → Deployment method → GitHub
    → connect your new repo → Enable Automatic Deploys (main branch)
 2. Heroku app → Settings → Config Vars → Add each of these:

    DASHBOARD_PASSWORD   your dashboard password        (required)
    SESSION_SECRET       any long random string         (required)
    PERSIST_GITHUB_REPO  your-username/your-private-repo  (the repo
                          you created in step 1)
    PERSIST_GITHUB_TOKEN a fine-grained personal access token:
                          GitHub → Settings → Developer settings →
                          Personal access tokens → Fine-grained →
                          Generate: select ONLY that repo →
                          Repository permissions → Contents:
                          Read and write. No expiry is fine.
    PERSIST_GITHUB_BRANCH  bot-state
    PUBLIC_URL           https://raqifluz-bot-1-dcac52bddac9.herokuapp.com
                          (your Heroku app's URL — keeps the dyno
                          awake; it rests 00:00–04:00 PKT)

 3. Settings → Add buildpack → Node.js  (if not auto-detected)

──────────────────────────────────────────────────────────────────
 STEP 5 — DEPLOY
──────────────────────────────────────────────────────────────────
 1. Deploy tab → Deploy Branch (main)
 2. Wait for "Your app was successfully deployed"
 3. Open the app → login with admin + your DASHBOARD_PASSWORD
 4. Home tab → the green "✅ Cloud memory is ON" banner must appear.
    If it shows the orange warning instead, cloud memory is not fully
    configured yet — fix it BEFORE scanning the QR (that banner is what
    decides whether future deploys will ask for a QR again).

──────────────────────────────────────────────────────────────────
 STEP 6 — LINK WHATSAPP (ONE QR SCAN — ONLY ONCE)
──────────────────────────────────────────────────────────────────
 1. Open the app → login → the QR code shows on the Home tab
 2. Phone WhatsApp → Settings → Linked devices → Link a device
 3. Scan the QR
 4. "Connected" appears in seconds. DONE — from now on the bot
    re-links itself from cloud memory after every restart.
    (The QR shows again ONLY if you unlink the device from your
     phone or wipe the GitHub bot-state.)

 AFTER LINKING — check the Logs tab for these two lines:
    cloud-state synced …        ← cloud memory works
    Live subscriptions refreshed ← sources are being watched

──────────────────────────────────────────────────────────────────
 ADD CHANNELS
──────────────────────────────────────────────────────────────────
 • Follow any channel on your phone → it becomes a SOURCE
   automatically (Auto-monitor). Or paste an invite link in the
   Sources tab.
 • Your own channel (where you are owner) usually becomes the TARGET
   automatically. If not: Targets tab → add it.
 • Pause any source/target any time — nothing is deleted.

──────────────────────────────────────────────────────────────────
 WHATSAPP ON YOUR PHONE (important)
──────────────────────────────────────────────────────────────────
 • Keep the phone online at least sometimes — WhatsApp requires the
   linked device to re-verify now and then.
 • If you ever change phone/number: unlink the bot first (WhatsApp →
   Linked devices → logout), then re-scan the QR once.

──────────────────────────────────────────────────────────────────
 IF SOMETHING LOOKS WRONG
──────────────────────────────────────────────────────────────────
 • Posts not flowing → Logs tab → look for "channel.pull" lines
   (means push is dead but the safety-net is catching posts — normal
   during WhatsApp hiccups; the bot keeps healing itself).
 • "WhatsApp cannot find …" → that channel was deleted or unfollowed.
   Remove it from Sources.
 • Edit posts is experimental — after big deletions, check the
   channel on your phone.
 • Dashboard locked → wait 15 min (login rate limit) or restart the
   dyno (Heroku → More → Restart dyno).

──────────────────────────────────────────────────────────────────
 Version 6.3.0 · fresh from-scratch rebuild · dark + light themes
════════════════════════════════════════════════════════════════
