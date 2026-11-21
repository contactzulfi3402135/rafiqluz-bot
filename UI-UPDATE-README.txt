RAQIFLUZ WORKSPACE UI UPDATE

For the restored Drive release raqifluz-v1.5.0.zip (package version 11.5.0).

1. Back up your repository and your application data first.
2. Extract this ZIP into the root of that repository and replace the matching
   files. Keep the directory structure. If your repository has additional
   edits in these files, review and merge them rather than blindly overwriting.
3. Commit and push those changes to the branch connected to Heroku. Your
   existing Heroku auto-deploy configuration will deploy that commit.

This overlay contains UI source, a service-worker cache version, and one
state-free test. It contains no database, sessions, media, .env, credentials,
or dependencies. It does not change Heroku config vars or provision a backup.
Verify your backup and recovery process before deploying; Heroku filesystem
storage is ephemeral and cloud snapshots alone do not guarantee recovery.

Tests: original npm test suite and the added node tests/ui-structure-test.js
passed on an isolated copy. Automated browser checks used a disconnected demo;
no real WhatsApp pairing or live Heroku deployment was tested.
