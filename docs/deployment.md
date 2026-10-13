# Deployment and release guide

## Deployment model

PennyPilot is a desktop application. There is no hosted application server, staging environment, production web deployment, database service, or cloud sync. Runtime finance data remains in the OS application-data directory on the user's device. CI creates platform-native packages as workflow artifacts; artifacts are not a signed public release.

No application environment variables or deployment secrets are required for the current build. GitHub Actions uses the repository's standard `GITHUB_TOKEN` for workflow operations, with read-only `contents` permission, and no credentials are needed to compile the app. Do not add a GitHub/GitLab secret for financial data or signing until a separate release-signing decision is made.

## CI pipeline

The source-of-truth workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs the verification gate on pushes, pull requests to `main`, and manual dispatch. The default matrix runs Ubuntu, macOS, and Windows. A manual run can select one platform for focused troubleshooting.

The verification job installs the platform prerequisites, Node.js 24, stable Rust, and Chromium, then runs `./scripts/verify.sh`. This includes frontend lint, type checks, Vitest, Playwright, high-severity npm audit, frontend build, Rust formatting, Clippy, Rust tests, and a no-bundle Tauri build.

Packaging is a dependent matrix in the same workflow. A maintainer must manually dispatch from `main`, select `all`, and set the package-build input. Packaging starts only if the verification matrix succeeds; it builds:

| Runner | Artifact types |
| --- | --- |
| macOS | DMG |
| Windows x64 | MSI and NSIS installer |
| Linux x64 | AppImage, DEB, and RPM |

Artifacts are uploaded separately per platform for 14 days; see the workflow's `upload-artifact` retention setting. Pushes, pull requests, single-platform dispatches, and dispatches from other branches do not package.

### Approval limitation

The workflow input records the maintainer's request **before** verification. It is not a separate human approval after checks. This repository is private, and GitHub rejected creation of required-reviewer environment protection under its current plan. No `desktop-release` reviewer gate is configured. If policy requires post-check human approval, upgrade/change repository eligibility and configure an environment with required reviewers (or adopt an equivalent protected release workflow) before treating package output as approved. The current gate does not sign/notarize packages.

## Git host and Merge Requests

The inspected local checkout has a GitHub `origin`, no GitLab remote, no `.gitlab-ci.yml`, and no `glab` executable; GitLab authentication/permissions cannot be verified here. GitLab push and MR creation therefore cannot be completed without the destination project URL and an authorized GitLab credential. The workflow is GitHub Actions, not GitLab CI. If the project is moved/mirrored to GitLab, add a GitLab pipeline that runs the same `./scripts/verify.sh` gate and configure protected `main`, required checks, and MR approvals in project settings; do not assume the GitHub workflow's controls carry over.

Once a GitLab project URL and access are available, the manual handoff is:

```sh
git remote add gitlab <GitLab-clone-URL>
git push -u gitlab docs/update-project-documentation-and-sad
```

Then in that GitLab project, open **Code → Merge requests → New merge request**, select `docs/update-project-documentation-and-sad` as the source and `main` as the target, review the diff, and create the MR. Use SSH or Git Credential Manager; never put a personal access token in the remote URL or command history.

## Staging and production

Neither staging nor production deployment is implemented. Native package artifacts are currently the only deployment output. Do not describe CI artifacts as store-ready installers or a production release.

Recommended future release path (not currently automated):

1. Complete all-platform verification and package builds from a reviewed release commit/tag.
2. Configure platform signing/notarization credentials in the relevant CI secret store, with least privilege and rotation; add signed build steps only after verifying each platform's process.
3. Require post-check approval and protect release tags/branch.
4. Publish checksummed, signed artifacts as a versioned release and keep the source/tag-to-artifact mapping.
5. Install each package on a clean supported OS, then run the smoke test below before public availability.

No signing secret names or values are defined today. Do not create empty placeholder secrets or put credentials in repository files.

## Smoke test

For each platform package:

1. Install/run on a clean supported OS account.
2. Create a new workspace with a fictional test passphrase, confirm it starts with no transactions, and enter a fictional income, expense, refund, and transfer.
3. Verify income/spending/net cash flow, category breakdown and transfer/refund handling; lock and unlock the workspace.
4. Export a small, consented fictional CSV and inspect its encoding/headers; create an encrypted backup and restore it into a disposable workspace, confirming the required pre-restore safety backup.
5. Quit/relaunch and confirm expected workspace status and saved theme; remove only the disposable test workspace afterward.

The browser Playwright harness is not a substitute for this native-package smoke test: it does not exercise native encryption, OS credentials, or real file operations.

## Rollback and recovery

There is no server deployment to roll back. If a package fails smoke testing, stop distribution and remove/unpublish that artifact. Rebuild from the last known-good reviewed commit/tag; do not replace a user's local data as a rollback mechanism. For user data restore, use the validated encrypted logical backup flow, which takes a mandatory encrypted safety backup before replacement. Keep the pre-restore backup and verify restored data before deleting it.

For a broken release, preserve the failed artifact and workflow logs for diagnosis, identify the commit and platform, and document whether the defect affected package installation or workspace data. Never ask users to send database files, passphrases, or financial exports.

## Monitoring and logging

There is no telemetry, hosted logging, crash reporting, analytics, or remote monitoring. Runtime failures are surfaced through the local UI; Rust errors are returned through Tauri IPC with user-facing messages. Do not add financial content, notes, passphrases, or key material to logs. For CI failures, use the workflow run/job logs and avoid uploading private local state.

## Release checklist

- [ ] Reviewed release commit and completed all-platform CI verification.
- [ ] Built artifacts from the intended `main` release commit; confirmed each platform artifact exists.
- [ ] Verified checksums/commit provenance for the artifacts (checksum publication is not currently automated).
- [ ] Completed native clean-install smoke tests on macOS, Windows, and Linux.
- [ ] Confirmed backup/restore and privacy consent behavior in native builds.
- [ ] Confirmed whether the release is private testing or public distribution.
- [ ] For public distribution, completed signing/notarization and post-check human approval (not currently configured).
- [ ] Published release notes that clearly state unsigned/unnotarized limitations until signing is implemented.
- [ ] Kept a tested rollback source commit/tag and a support path that never requests raw user finance data.

Until signing, notarization, protected approval, and native smoke testing are implemented, treat packages as private testing artifacts only.
