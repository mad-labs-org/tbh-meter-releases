---
name: release-meter
description: Ship a tbh-meter release end-to-end — step 2 builds a test version (RC draft), smoke-test the side-by-side install, then step 3 ships it to players (Latest + Discord). Also covers direct-to-stable (no RC), pre-merge PR builds, and recovery. Use when asked to release the meter, build/ship an RC, promote to stable, ship straight to production, test a release candidate, or cut a throwaway pre-merge build.
---

# Shipping a meter release (the manual runbook)

Architecture/why: `CLAUDE.md` § Release pipeline. All four meter workflows group under
`TBH Meter /` in the Actions sidebar and the numbers keep them in pipeline order (one auto, two you
click, one internal):

```
TBH Meter / 1. Create version tag (auto)        ← never clicked; mints the RC tag on merge
TBH Meter / 2. Build test version to download   ← makes a draft installer you test
TBH Meter / 3. Release to players               ← sends it to players (Latest + auto-update)
TBH Meter / core build (internal)               ← the shared Windows build (never clicked)
```

**The common case needs NO inputs.** Step 1 is automatic; the RC smoke-test between 2 and 3 is a
**human step** (needs the Windows machine). Versions never hide in job logs: each run's name shows
intent, the build job name shows the computed version, every run posts a `::notice` + a summary,
and the [releases list](https://github.com/mad-labs-org/tbh-meter/releases) is the
dashboard (`Latest` = players, drafts = live candidates only).

## 0 — Status (always run first)

```bash
git fetch --tags -q
git -c versionsort.suffix=-rc tag -l 'tbh-meter-v*' --sort=-v:refname | head -5   # newest tags
node app/scripts/compute-version.mjs --json 2>/dev/null \
  || echo "→ refused: no meter changes since the last release (nothing to stage/ship)"
gh release list --repo mad-labs-org/tbh-meter --limit 5                  # Latest + drafts
```

This tells you the newest staged RC, what a stable bump would be, and the current Latest.

## 1 — Normal flow (RC → ship)

The change is merged to `main` with meter changes → **step 1** already created the version tag.

```bash
# Build the test version (defaults to the newest staged RC — no input):
gh workflow run meter-2-build.yml
gh run watch "$(gh run list --workflow=meter-2-build.yml -L1 --json databaseId --jq '.[0].databaseId')"
```

Output: a **DRAFT** on `mad-labs-org/tbh-meter` (invisible to players + electron-updater).
List it (needs auth — the draft shows first):

```bash
gh release list --repo mad-labs-org/tbh-meter --limit 3
```

→ do the **RC smoke-test (§5)**. If good:

```bash
# Ship the newest staged RC to players (no input):
gh workflow run meter-3-ship.yml
gh run watch "$(gh run list --workflow=meter-3-ship.yml -L1 --json databaseId --jq '.[0].databaseId')"
```

→ verify the promote (§6).

## 2 — A specific staged RC

Add `-f candidate=0.X.Y-rc.N` to either workflow (a bare version or a full `tbh-meter-v…` tag both
work):

```bash
gh workflow run meter-2-build.yml -f candidate=0.31.0-rc.2
gh workflow run meter-3-ship.yml  -f candidate=0.31.0-rc.2   # ship exactly the one you tested
```

## 3 — Direct to production (no RC)

Ship main's current code straight to players, skipping the RC build — for an obvious fix:

```bash
gh workflow run meter-3-ship.yml -f direct_from_main=true
```

It versions, builds the stable variant from main's HEAD, ships it, and tags at that commit — exactly
like a promote, just without a separate RC. It is **refused if there are no meter changes**
since the last release (add `-f allow_empty=true` only to force a rebuild, e.g. a build-only change —
explain it or don't use it). It can never undercut a staged RC: direct mode versions all commits
since the base, and the downgrade guard refuses anything ≤ the current Latest.

## 4 — Pre-merge build of a PR (test before merging)

The reader is win32-only, so devs on Mac need a real Windows installer of their branch:

```bash
gh workflow run meter-2-build.yml -f pr=342
```

Builds PR #342's head as `0.0.0-pr.342.<run>` (honest throwaway version, its own draft slot so two
PRs can never collide), publishes a draft, and **posts the download link as a comment on the PR**.
Not promotable — ship the real thing by merging, then §1. The draft is auto-deleted when the PR
closes.

## 5 — RC smoke-test (HUMAN step — hand the maintainer this checklist)

Download the draft installer **logged in** and install on Windows. The RC is side-by-side by design
(`tbh-meter-rc` app, data in `~/tbh-meter-rc`, auto-update OFF) — it never touches the stable install.

- [ ] App opens; splash reaches **ready** (reader attached) with the game running
- [ ] A finished run appears with sane dps/gold/xp/party (no "?" stage, no gold 0)
- [ ] Overlay updates live during a run
- [ ] Upload works (share a run; check the session page link)
- [ ] Whatever the release actually changed, exercised explicitly

If the RC is bad: fix on main → step 1 creates a new version tag → repeat §1. Dead drafts vanish on the next
ship (swept) or when the PR closes.

## 6 — Verify the ship

```bash
gh release view --repo mad-labs-org/tbh-meter --json tagName,isLatest,isDraft
git fetch --tags && git -c versionsort.suffix=-rc tag -l 'tbh-meter-v*' --sort=-v:refname | head -2
```

- [ ] Latest on the public repo = the new version, not a draft
- [ ] The "Verify players can see it" step confirmed the anonymous `/releases/latest` pointer +
      `latest.yml` serve the new version (a `::warning::` there = clients may briefly miss it)
- [ ] The clean `tbh-meter-v<ver>` tag arrived here (advances the base)
- [ ] Discord announcement posted (our server)
- [ ] An installed stable app self-updates: on launch (boot gate; its REST cross-check converges
      if the launch raced the flip), on focus/resume, or within ~3min (interval) while left open

## 7 — Recovery

- **Half-failed ship** (e.g. published Latest but failed at Discord): just **re-run the failed jobs**
  on that run — the build artifact is reused (no ~10-min Windows rebuild) and every publish step is
  idempotent (draft-then-flip, `--clobber`, tag pre-check, draft sweep). The Discord ping is skipped
  on a re-run where the tag was already pushed; the summary prints the manual announce link.
- **Bad RC:** fix → merge → new RC auto-staged → §1 again.
- **"already shipped from <sha>":** step 3 (Release) refused because that version's tag exists at a
  different commit. Don't force it — let the next merge bump the version, then ship that.

## Gotchas

- Step 3 (Release) re-builds the stable variant (different appId/productName from the RC) — the re-build is by
  design, not a missed optimization; "ship == tested commit" holds via the frozen lockfile.
- `-rc.N` and `0.0.0-pr.*` versions never advance the version base; only the clean tag from a ship does.
- Publishing is **same-repo**: `RELEASES_REPO=$GITHUB_REPOSITORY` (= `mad-labs-org/tbh-meter`) and
  steps authenticate with the built-in `GITHUB_TOKEN` — no cross-repo PAT. A 403 on publish means the
  workflow's `GITHUB_TOKEN` lacks `contents: write`, not an expired secret.
- Builds are intentionally UNSIGNED — SmartScreen "Run anyway" is expected and documented in the notes.
- Never hand-push a `tbh-meter-v*` tag — Meter 3 owns stable tags (at the built commit, plain push).
