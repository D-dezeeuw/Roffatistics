# Roffatistics — Development Guide

This document defines how every phase in the roadmap gets built: branching, task breakdown, coding standards, testing, and what "done" means.

---

## Workflow overview

```
main
 └─ phase/0-skeleton        ← one branch per roadmap phase
 └─ phase/1-map-foundation
 └─ phase/2-zoom-tiers
 └─ ...
```

Each phase lives in its own branch, is self-contained, and merges to `main` only after the verification checklist passes. No partial merges — a phase either ships complete or stays on the branch.

---

## Branch strategy

| Convention | Example |
| --- | --- |
| Branch name | `phase/<number>-<slug>` |
| Slug | kebab-case, matches roadmap phase title |
| Base | always cut from `main` |
| Merge | squash-merge into `main` with a single conventional commit |

```bash
git checkout main
git pull
git checkout -b phase/1-map-foundation
```

Commit message format (conventional commits):

```
feat(phase-1): add CartoDB dark matter tile layer

Short imperative summary (≤72 chars). Blank line, then optional
body only if the WHY is non-obvious from the code.
```

Types: `feat` · `fix` · `test` · `refactor` · `chore` · `docs`

---

## Merging and releasing

### Merge process

When a phase passes the Definition of Done, merge it back to `main` with a squash-merge so the phase lands as a single atomic commit:

```bash
# on the phase branch — tests green, checklist clear
git checkout main
git pull                              # ensure main is up to date
git merge --squash phase/1-map-foundation
git commit                            # opens editor with squashed message
git push origin main
git branch -d phase/1-map-foundation  # clean up local branch
git push origin --delete phase/1-map-foundation  # clean up remote
```

The squash commit message must follow the conventional commit format and include the verification summary in the body (see Verification and reporting below).

### Versioning (semver)

Each merged phase bumps the **minor** version. Patch versions are reserved for bug fixes on `main` between phases. `v1.0.0` is the first public release — only after Phase 7 (deploy + polish) is complete.

| Phase | Version | Notes |
| --- | --- | --- |
| 0 — Skeleton | `v0.1.0` | |
| 1 — Map foundation | `v0.2.0` | |
| 2 — Zoom tiers | `v0.3.0` | |
| 3 — CBS demographics | `v0.4.0` | |
| 4 — Crime overlay | `v0.5.0` | |
| 5 — Education overlay | `v0.6.0` | |
| 6 — Municipality tier | `v0.7.0` | |
| 7 — Polish + deploy | `v1.0.0` | First public release |

Bug fix committed directly to `main` between phases: bump patch only (`v0.4.0` → `v0.4.1`).

### Bumping `package.json`

Update the version in `package.json` as the last commit before tagging — do not squash this into the phase commit:

```bash
npm version minor --no-git-tag-version   # or `patch` for a fix
# review the change, then:
git add package.json
git commit -m "chore: bump version to v0.4.0"
```

### Tagging on GitHub

After the version commit is on `main`:

```bash
git tag -a v0.4.0 -m "Phase 3 — CBS demographics overlay"
git push origin v0.4.0
```

Then create a GitHub Release from that tag:

- **Title:** `v0.4.0 — <Phase name>`
- **Body:** paste the verification summary from the squash-merge commit
- **Attach:** nothing (static site, no build artefact to distribute)

GitHub Releases serve as the project changelog. Every tag should have one.

### npm publishing (conditional)

This project is a static site and is **not published to npm by default**. If in the future any module (e.g. `datasets.js`, the CBS OData client) is extracted into a standalone reusable package, publish it separately under its own repo and package name.

If that decision is made, the publish flow is:

```bash
# ensure you are on main, version bumped, tag pushed
npm publish --access public   # scoped package: @zeeuw/<name>
```

Before publishing:

- Confirm `package.json` has `"files"` set to only what callers need (no `tests/`, no `data/`, no `server.js`)
- Confirm `"main"` and `"exports"` point to the correct entry
- Run `npm pack --dry-run` and review the file list
- The GitHub Release must already exist for the version being published

---

## Task breakdown

Each phase in the roadmap has a checklist. Before starting a phase:

1. Copy its checklist into a working scratchpad or editor bookmark — treat each `- [ ]` as an atomic unit of work.
2. Implement one task at a time, commit when it passes tests.
3. Never start the next task while the current one has a failing test.

Tasks should be small enough that a single commit covers one task. If a task takes more than ~90 minutes or touches more than two files, split it.

---

## Coding standards

### KISS — Keep It Simple
- Solve exactly the problem in front of you. No abstractions for hypothetical future cases.
- If you can do it in a function, don't make it a class. If you can do it inline, don't make it a function.
- Three similar lines are fine. Extract only when a fourth appears.

### DRY — Don't Repeat Yourself
- Shared logic lives in `modules/`. One canonical place per concern.
- Data normalization (CBS response → `{ regionCode, label, value }`) happens in one function. Callers never parse API responses directly.
- Design tokens live in `style.css` custom properties. Never hardcode a color or spacing value in JS or HTML.

### Concise and professional
- No comments that describe what the code does — names do that.
- Add a comment only when the WHY is non-obvious: a hidden constraint, an API quirk, a deliberate trade-off.
- No dead code, no `console.log` left in, no `TODO` committed to `main`.
- Functions: one clear purpose, one level of abstraction. If the body needs a comment to explain a section, it should be its own function.
- Modules export only what callers need. Keep internals private (unexported).

### File and naming conventions
```
modules/         camelCase.js exports
data/            kebab-case.json
CSS classes      kebab-case
JS variables     camelCase
JS constants     UPPER_SNAKE_CASE
```

---

## Testing

### Stack
Node.js built-in test runner (`node --test`). No test framework dependency.

```bash
node --test tests/*.test.js
node --test --experimental-test-coverage \
     --test-coverage-exclude='tests/**' \
     tests/*.test.js
```

### What "100 / 100 / 100" means

| Number | Metric | How to verify |
| --- | --- | --- |
| 1st 100 | All tests pass — zero failures, zero skipped | `node --test` output: `pass: N, fail: 0` |
| 2nd 100 | 100% line + branch coverage on all `modules/*.js` | `--experimental-test-coverage` report shows no uncovered lines |
| 3rd 100 | Zero linting violations (manual checklist below) | Run the self-review checklist before every merge |

A phase does not merge until all three are green.

### Test file convention

One test file per module: `tests/map.test.js`, `tests/overlays.test.js`, etc.

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegions } from '../modules/datasets.js';

describe('normalizeRegions', () => {
  it('filters to province codes only', () => {
    const raw = [
      { RegioS: 'PV20', BevolkingAanHetBeginVanDePeriode: 650000 },
      { RegioS: 'GM0014', BevolkingAanHetBeginVanDePeriode: 12000 },
    ];
    const result = normalizeRegions(raw, 'province');
    assert.equal(result.length, 1);
    assert.equal(result[0].regionCode, 'PV20');
  });
});
```

### What to test

| Module | What to unit-test |
| --- | --- |
| `datasets.js` | normalize functions, OData URL construction, `sessionStorage` cache hit/miss, error handling on non-200 |
| `overlays.js` | zoom threshold logic, color interpolation (given a value between min/max, returns expected hex), layer-swap decision function |
| `legend.js` | label generation (given min/max and steps, returns correct breakpoints) |
| `map.js` | bounds clamping logic (pure functions only — Leaflet itself is not under test) |
| `panel.js` | data-to-template mapping functions |

Leaflet, the DOM, and fetch are not unit-tested here. Integration smoke tests for those live in the verification checklist below.

### Mocking external calls
Use Node.js `--experimental-vm-modules` or simple dependency injection: modules that call `fetch` should accept a `fetcher` argument that defaults to `globalThis.fetch`. Tests pass in a stub:

```js
const stub = async () => ({ ok: true, json: async () => mockPayload });
const result = await fetchCBS('70072ned', 'PV*', stub);
```

---

## Manual self-review checklist

Run before every merge to `main`:

- [ ] No `console.log`, `debugger`, or commented-out code committed
- [ ] No hardcoded color values or magic numbers outside `style.css` / named constants
- [ ] Every exported function has a corresponding test
- [ ] `sessionStorage` caching does not break tests (tests should not share state)
- [ ] All API error paths have a fallback (empty state, not a thrown exception reaching the user)
- [ ] Tooltip and panel render correctly at all three zoom tiers
- [ ] Attribution line visible on the map at all zoom levels
- [ ] Browser console is clean (no errors, no warnings) on localhost

---

## Verification and reporting

After all tests pass and the checklist is clear, write a short phase summary in the commit body or as a PR description section. Format:

```
## Phase N verification — <phase name>

**Tests:** pass: X, fail: 0, coverage: 100%
**Manual checks:** all passed
**Browser:** tested at zoom 6 / 8 / 11 on Chrome and Firefox

**What was built:**
- <one line per significant deliverable>

**Decisions made during implementation:**
- <anything that deviated from the roadmap, and why>

**Known limitations / deferred:**
- <anything intentionally left out, with a note on which future phase handles it>
```

This summary becomes the squash-merge commit body so the `main` git log is a readable history of what shipped.

---

## Definition of Done (per phase)

A phase is done when **all** of the following are true:

- [ ] Every roadmap task for the phase is implemented
- [ ] `node --test` → `fail: 0`
- [ ] Coverage report → 100% lines and branches on all modified modules
- [ ] Manual checklist → all items checked
- [ ] App runs on `localhost:3000` with no console errors
- [ ] Verification summary is written
- [ ] Branch is squash-merged to `main` with a conventional commit

---

## Suggestions beyond what you listed

These aren't blockers, but worth keeping in mind:

**Error boundaries and graceful degradation** — define what the map shows when a CBS or Politie API call fails (e.g. grey fill + "data unavailable" tooltip). Without this, a network blip leaves users with a broken-looking map.

**Data shape validation** — CBS OData responses can change column names between dataset versions. Add a lightweight assertion on the expected fields when normalizing, so failures are caught early with a clear message rather than `undefined` silently propagating to the choropleth.

**Conventional commit linting** — even without CI, running `git log --oneline` should read like a changelog. The commit message format in this doc is enough; the discipline is the tooling.

**Accessibility smoke test** — after Phase 7, run the browser's built-in accessibility audit (Chrome DevTools → Lighthouse → Accessibility). Aim for 100. A map-heavy app commonly fails on contrast ratios and missing focus indicators.

**Performance budget** — the municipality GeoJSON (`gemeente_2023.geojson`) can be 1–3 MB. Define an acceptable load time (e.g. ≤ 2s on a 4G connection) and verify it before shipping Phase 6. If it's too heavy, serve a topojson version (~60% smaller) or clip to the visible province.

**Changelog** — after each phase merges, append a one-liner to `CHANGELOG.md` under an `## Unreleased` heading. When the site goes live, that becomes `## v1.0.0`. Takes 30 seconds per phase and makes the project history readable to anyone looking at the repo.
