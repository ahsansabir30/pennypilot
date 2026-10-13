# Developer guide

This guide describes the checked-out PennyPilot desktop application. For component boundaries and data/security flows, see the [Software Architecture Document](architecture/SAD.md). The canonical product and accounting contracts remain in the [README](../README.md).

## Prerequisites

- Node.js 24 and npm.
- Stable Rust toolchain and Cargo.
- Tauri 2 host-platform prerequisites. Linux builds need WebKitGTK 4.1 and the native packages installed by the CI workflow.
- Windows builds need OpenSSL for SQLCipher; CI installs the `x64-windows-static-md` vcpkg triplet.
- A usable OS credential store for workspace recovery: Keychain on macOS, Credential Manager on Windows, Secret Service on Linux.
- Chromium for Playwright. Install it with `npx playwright install chromium`; on Linux use `npx playwright install --with-deps chromium`.

The Rust dependency lockfile is `src-tauri/Cargo.lock`; the frontend lockfile is `package-lock.json`. Use the documented Node.js and Rust versions rather than unpinned system defaults.

## Local setup

From the repository root:

```sh
npm ci
npx playwright install chromium
npm run tauri dev
```

`npm run tauri dev` starts Vite on port `1420` and opens the Tauri desktop window. Native storage, credential-store, encryption, and file operations are not available in a normal web browser. Browser-only use displays a desktop-required message; Playwright's Tauri IPC mock is for frontend tests only.

For a production frontend preview:

```sh
npm run build
npm run preview
```

The configured Playwright server uses `127.0.0.1:1422`, strict port binding, and a production build.

## Environment and secrets

There are no required application environment variables, `.env` files, API keys, or external service credentials. Do not add credentials for banking, cloud sync, analytics, or telemetry without an explicit product/security decision.

| Variable | Use |
| --- | --- |
| `TAURI_DEV_HOST` | Optional Vite/Tauri development setting for HMR from a remote device; not required for ordinary local development. |
| `CI` | Set by CI; Playwright uses it to reject `test.only`. |
| OpenSSL/vcpkg variables | Set by the Windows GitHub Actions job for SQLCipher compilation; not application runtime configuration. |

`.env.example` is intentionally absent because the app currently needs no application secrets or runtime configuration. Keep workspace data, exports, backups, OS credentials, and real financial records outside Git.

## Command inventory

All npm commands below are declared in `package.json`; the full gate is `scripts/verify.sh`.

| Command | What it verifies or runs |
| --- | --- |
| `npm run tauri dev` | Native desktop development app; uses Vite on port `1420`. |
| `npm run lint` | ESLint over `src`, `e2e`, and project configs. |
| `npm run typecheck` | Frontend and Playwright TypeScript checks. |
| `npm test` | One-shot Vitest run for `src/**/*.test.{ts,tsx}`. |
| `npm test -- src/finance.test.ts` | Run the focused finance helper tests once. |
| `npm run test:e2e` | Playwright desktop and mobile browser projects. |
| `npm run test:e2e -- e2e/finance.spec.ts` | Run a focused browser journey file. |
| `npm run build` | Type-check and build the production frontend to `dist/`. |
| `npm run tauri build` | Build and bundle the native desktop application for the host OS. |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | Check Rust formatting. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Lint Rust with warnings treated as errors. |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` | Run Rust unit/domain/persistence tests. |
| `./scripts/verify.sh` | Run frontend lint/types/unit/E2E/audit/build plus Rust format/Clippy/tests and a no-bundle Tauri build. |

Focused Rust test example:

```sh
cargo test --manifest-path src-tauri/Cargo.toml backup
```

`npm run test:e2e` can start its own preview server; its Playwright config builds the production frontend first. Playwright uses one worker, desktop Chromium and a Pixel 7 mobile profile. Tests serve the configured CSP as a response header and freeze `Object.prototype`. The IPC harness uses fictional state and is not evidence of native encryption, file IO, or OS credential-store behavior.

## Testing and code quality

- Use Vitest and Testing Library for frontend logic and component behavior; add focused tests beside the feature (`src/*.test.ts(x)`).
- Use Rust tests for financial rules, validation, SQLCipher persistence, OS-key-store integration boundaries, and backup/restore safety.
- Use Playwright for user-visible browser interaction with the deterministic fictional Tauri IPC harness. Do not describe these as native desktop tests.
- Keep financial amounts as integer pence; use Rust/SQLite signed 64-bit aggregates and decimal-string IPC values, with `BigInt` for frontend aggregate arithmetic.
- Test errors and edge cases as well as successful paths: refunds/transfers, manual categorisation, dates, overflow, stale requests, restore failures, and cancellation.
- Preserve privacy: fictional fixtures only, no secrets or finance data in logs/screenshots/fixtures, and no broad catch or success-shaped fallback.
- Keep command access deny-by-default. New Tauri commands need to be registered, included in the generated ACL list, and granted through the main-window capability; tests check these surfaces stay aligned.
- Avoid new dependencies, frameworks, network services, or architecture layers unless an explicit requirement justifies them.

## Branching and Merge Requests

The checked-in workflow runs verification on pushes and pull requests targeting `main`; the workflow does not configure protected-branch required checks or an MR approval policy. Treat `main` as the integration target and use a short-lived branch per change, such as `docs/<topic>` or `fix/<topic>`. This is a recommended workflow, not a Git-host enforcement rule.

Before opening a Merge Request:

1. Rebase or update the feature branch from `main` without rewriting shared history.
2. Run `./scripts/verify.sh` for code/configuration changes; documentation-only changes need a content/link review and `git diff --check`.
3. Review the complete diff, ensure only intended paths are staged, and check for private data.
4. Open an MR into `main`. Describe the user/operational impact, implementation, tests, risks, and any migration or deployment requirement.
5. A reviewer should check finance correctness, privacy/security, platform behavior, tests, and documentation. Merge only when required CI and approvals are green.

There is no GitLab remote or GitLab CI configuration in the inspected checkout. GitLab MR rules, required checks, and approval count must be configured by the GitLab project administrators if this repository is mirrored or moved there. GitHub branch protection is platform configuration and is not established by the workflow YAML itself.

## Safe feature workflow

1. Inspect the closest frontend component, Rust command/domain logic, schema migration, capability, and tests before editing.
2. Define behavior and failure semantics. For finance changes, state the accounting/date/currency invariants and test them independently.
3. Keep Rust authoritative for validation, persistence, cryptography, and finance rules. Add a narrow Tauri command only when needed; never issue SQL from React.
4. Add/update frontend and Rust tests, plus E2E for important UI journeys. Keep fixtures fictional.
5. Run the smallest relevant tests first, then `./scripts/verify.sh` for code changes.
6. Update README/developer/deployment/SAD material when behavior, storage contracts, commands, architecture, or release steps change.
7. Review the diff and stage only the intended files. For source changes, the repository's `scripts/publish-change.sh` runs the full gate, creates a Conventional Commit, pushes to the configured `origin`, and checks the remote SHA. It is not a GitLab publisher unless `origin` is configured to GitLab.

## Platform prerequisites and troubleshooting

The CI workflow lists the native packages required for its Linux and Windows builds. Tauri development additionally requires a supported host webview and platform toolchain.

- Linux: install WebKitGTK 4.1, OpenSSL, AppIndicator, DBus, librsvg, `patchelf`, and compiler/build packages. Playwright's Linux browser dependencies are installed in CI via `playwright install --with-deps chromium`.
- Windows: install Visual Studio C++ build tools and WebView2; CI provisions OpenSSL through vcpkg.
- macOS: Xcode Command Line Tools and the system WebKit webview are required.
- If Playwright preview fails with a port error, free `1422`; `reuseExistingServer` is disabled and strict binding is intentional.
- If a Tauri invocation fails in a normal browser, use the Tauri desktop window instead. No browser polyfill provides encrypted native storage.
