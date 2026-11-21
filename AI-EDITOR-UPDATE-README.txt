RAQIFLUZ — INSTRUCTION-DRIVEN AI + DASHBOARD UPDATE
This is the COMPLETE restored Raqifluz v1.5.0 bot source, with the latest dashboard, channel-name and AI updates included. It supersedes the previous update ZIPs. It is not a database or session backup.

INSTALL / HEROKU AUTO-DEPLOY
1. Back up your repository and persistent data/session using your existing backup method. Do not delete or replace your real database, sessions, media, environment variables or Heroku configuration. If you independently changed the same files, compare/merge them first.
2. Extract this complete ZIP into the ROOT of your existing local repository and replace the matching files. Keep all other files, especially persistent data and credentials. The ZIP contains no credentials, database, sessions or media.
3. Commit and push to the branch already connected to Heroku auto-deploy, for example:
   git add src tests AI-EDITOR-UPDATE-README.txt
   git commit -m "Make AI posts instruction-driven and fix queue-off publishing"
   git push
   Check your Heroku build and logs. Heroku auto-deploy must already be enabled for that branch. No live Heroku deployment or WhatsApp connection was tested here.
4. AI post instructions are OFF until enabled. Nothing resets your saved settings, data or channels.

YOUR AI INSTRUCTIONS
• Settings → AI: configure the provider/key and enable AI content sharing. Source texts, and saved same-day post texts when relevant, are sent to the AI provider; fees can apply.
• Auto-Replies & AI Pilot → AI Pilot → AI post instructions: enable the editor and write what you want in your own words: which posts to select or skip, what to remove or retain, language, style, rewriting, formatting and how to use your details. Save and test a sample. The examples are only examples, not required rules. Optional shortcut switches start off.
• Enter your real channel/bot numbers, link and other authorized details in “Your details for AI to use”; choose “AI decides from my instructions (adaptive)”. Tell AI how you want these used. It can format a relevant footer itself; it is not a fixed pattern. “Fixed” is also available to append the supplied text verbatim. If upgrading from the previous AI-editor ZIP, an existing saved footer stays fixed until you choose adaptive.
• Alternatively, turn on Bot control in the assistant and tell it explicitly to change the instructions for future posts. It normally appends; ask it to replace the old instructions if that is what you want. It can save owner details if they are quoted exactly in your current message; otherwise enter them in settings. Check the returned instructions to ensure the model understood you.
• To protect specific official links, list domains in “Official domains to preserve”. AI can only use URLs present in the source or supplied by you. Listing domains does not guarantee that unlisted links will be classified correctly.
• Same-day history is supplied for natural-language duplicate instructions, even with the shortcut off. It is based on the selected local timezone (default Asia/Karachi) and accepted/published records. Comparisons are best-effort: pending posts, separate concurrent bot processes, history beyond the local day and missing data can affect results. AI can misinterpret any instruction; test representative samples and check outcomes.
• With the AI editor enabled, it controls the post's text and formatting; older templates, translate, header, signature and related formatting are not applied on top. They resume when the editor is off. Existing source filters, blocklist, rate guards, routing and optional AI Pilot/safety remain active. An unavailable/uncertain editor or media-only source post is held in Queue for manual review, even if ordinary queue automation is off, so unchecked source content is not silently published.

AI ASSISTANT POSTING
• With Bot control ON, when you ask the assistant to publish a post and the queue is OFF, it sends directly to active targets without a review button or queue entry. If a target is named, it sends there. When the queue is ON, the post is queued for approval.
• Direct sending remains subject to panic/pause, blocklist, rate limits, target availability and configured AI safety. If AI processing is unavailable or uncertain, the assistant reports that nothing was sent or queued instead of publishing unchecked text. Partial or uncertain outcomes are reported honestly; check History and Delivery review before retrying.

TESTING
Automated tests use isolated databases and mocked AI/WhatsApp providers; they cover queue on/off, direct publication, instruction changes via chat, adaptive formatting, same-day history, review/error paths, partial delivery, existing app tests and dashboard/browser regressions. They do not prove real AI classification, WhatsApp delivery, Heroku deployment or multi-process concurrency. Always verify with your own provider and channels.
