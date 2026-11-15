---
name: release
description: Release Roffatistics - push to GitHub main (Pages = production) and then sync the Hermes forge copy. Use for every push to main in this repo.
---

# Release Roffatistics

GitHub main is production (GitHub Pages). The Hermes app (`hermes/roffatistics`, roffatistics.hermes.blockworlds.nl) serves a **copy** of the site in the forge repo's `site/`. It does not follow GitHub on its own, so every release must also be synced there.

## Steps

1. `npm test` must be green.
2. Bump the version in `package.json` **and** `APP_VERSION` in `modules/legal.js`. They must match, or a test fails.
3. `git add -u && git commit` with only the `Claude-Session:` trailer, then `git push -q origin main`.
4. Watch Pages: `gh run watch $(gh run list -L1 --json databaseId -q '.[0].databaseId') --exit-status`.
5. **When the push succeeds**, run the sync:

   ```bash
   /nebula/apps/hermes-import/sync-roffatistics.sh
   ```

   It copies the current GitHub version (app.js, index.html, style.css, favicons, modules/, data/, assets/) into the forge clone's `site/` at `/nebula/apps/hermes-import/forge/roffatistics`, runs the forge test and pushes. If `site/` is already current, it does nothing.
6. Wait for the forge build: `~/.claude/tools/wait-forge.sh roffatistics <forge commit>`.
7. Tell the operator to run `/deploy roffatistics` in Telegram. Deploys are the operator's.

If you add a new top-level runtime file (anything `index.html` loads from the repo root), add it to the rsync list in the sync script.
