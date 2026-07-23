# Release asset version sync

## Problem

GitHub Releases were tagged `vYYYY.MM.DD-<sha>`, but electron-builder always
named installers from the fixed `package.json` version `0.1.0`, so every Release
shipped assets like `GenAIUsageWidget.Setup.0.1.0.exe`.

## Decision

Keep continuous releases on every push to `main`. Before packaging, CI stamps
`package.json` with a CalVer-style semver string derived once in a `meta` job:

- `version`: `YYYY.M.D-<sha7>` (no leading zeros — required by semver)
- `tag`: `v${version}`

Build jobs run `npm version … --no-git-tag-version` then `npm run dist`. The
release job publishes under the same `meta` tag. Repo `package.json` stays at
`0.1.0` for local/PR CI.

## Out of scope

- Semver marketing versions (`0.2.0`, …)
- Changing the PR CI workflow
- Renaming historical Releases
