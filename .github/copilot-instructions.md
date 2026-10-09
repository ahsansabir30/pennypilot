# PennyPilot engineering instructions

PennyPilot is a local-first UK personal finance desktop app. Prioritise financial
correctness, privacy, clear interactions and maintainability. Use README.md for
detailed accounting, workspace security, export and restore contracts.

## Approved architecture

- Keep the existing Tauri 2, React, TypeScript, Vite and Rust stack. Architecture
  selection is complete; do not restart it or add a competing framework/server.
- Rust owns financial rules, validation, workspace security and database access.
  React calls narrow Tauri commands; it must not issue SQL or hold database keys.
- SQLite is compiled with SQLCipher. Workspace keys are wrapped using
  Argon2id-derived keys and XChaCha20-Poly1305; device recovery uses the OS
  credential store. Recovery is not a cloud or cross-device service.
- Financial files live under the OS application-data directory, outside the repo.
  Preserve the existing CSP, capabilities and local-only behaviour. Do not add
  telemetry, banking integrations, cloud sync or external services without an
  explicit requirement.
- Reuse existing components, domain helpers and dependencies. Avoid speculative
  abstractions, broad rewrites and unnecessary packages.

## Implemented features and boundaries

- Encrypted workspace creation, unlock, lock and same-device passphrase recovery.
- Persisted accounts, categories and source-dated transactions; monthly summaries,
  category breakdowns and historical trends. New workspaces have starter
  categories and a GBP main account, but no sample financial transactions.
- Manual transaction creation, search, filters, sort, pagination, category
  correction and confirmed deletion. UI edits do not change dates or amounts.
- Editable categories and deterministic merchant rules with priorities,
  conflict explanations, explicit reclassification and preserved manual choices.
- Monthly category budgets, persisted comparison preferences, recorded usage,
  progress, over-limit markers and evidence-based period comparisons.
- Editable savings goals with explicitly entered progress, optional target dates,
  notes and confirmed deletion. Goals do not reserve or transfer money.
- Scoped, consent-based CSV export and independently encrypted logical backups;
  validated, transactional restore with a required pre-restore safety backup.
- Responsive dashboard budget/goal previews, mobile transaction cards, panel
  navigation, validation, loading, error/retry and actionable empty states.
- CSV import, custom account management and recurring/subscription detection
  remain planned. Do not imply they exist or fabricate bills or subscriptions.

## Financial invariants

- GBP amounts are integer pence, never floating-point currency. Transaction amounts
  are positive; income, expense, refund and transfer kinds determine direction.
- Individual monetary inputs are capped at 99,999,999,999 pence and can use safe
  JavaScript numbers. Aggregate totals remain signed 64-bit integers in Rust/SQLite
  and cross IPC as decimal strings. Use BigInt for frontend aggregate arithmetic,
  comparisons and formatting; only visual proportions may use floating point.
  Preserve explicit overflow errors rather than rounding or wrapping.
- Spending is expenses minus refunds; refunds are not income. Net cash flow is
  income minus net spending. Transfers are excluded from all these aggregates.
  Never describe net cash flow or incomplete transaction history as bank balance.
- Validate source calendar dates from 1000-01-01 through 9999-12-31. Group by the
  source date, not a UTC conversion. Test leap days and month boundaries.
- Dashboard history covers up to six supported months. Omit unavailable months
  before January 1000 with an explanation. January 1000 budget comparisons have
  absent prior month/date/amount, not a fabricated zero comparison.
- Empty supported periods mean zero recorded activity, not complete bank history.
  Current-month budgets stop at the local as-of date; future periods have no elapsed
  usage. Partial comparisons use the persisted mode and documented date caps.
- Budget usage follows current categories, including manual corrections, and nets
  refunds. Retain negative usage; clamp only visual progress where appropriate.
- Savings progress is explicitly entered, not inferred from cash flow. Preserve
  zero and overfunded progress; remaining is max(target - progress, 0). A target
  date is not a forecast. Any future estimate must identify its evidence/inputs.

## Categorisation and duplicate handling

- Preserve original merchant text. Use the existing Unicode normalization:
  lowercase letters, collapse punctuation/whitespace, retain digits and accents.
  Do not guess away bank references or substitute description for merchant.
- Rules use normalized exact names or whole phrases, not regexes. Higher priority
  wins; conflicting top-priority categories remain Uncategorised with explanations.
  Match category types; transfers are excluded from categorisation.
- Explicit category choices, including Uncategorised, are manual overrides.
  Rules/reclassification must never silently overwrite them. Only the explicit
  clear-manual-choice action returns a transaction to automatic classification.
- Stable source IDs are unique within an account. Re-ingestion preserves the
  existing transaction and override; changed date/kind/amount is rejected.
  Without a source ID, manual creation is a distinct record.
- Future CSV import must validate the full batch and insert atomically, with
  duplicate and injected-failure rollback tests. Individual ingestion is not an
  implemented CSV importer or an atomic batch.

## Privacy, export and restore

- Use fictional fixtures only. Never commit real statements, financial screenshots,
  database files, browser storage dumps, exports, backups, secrets or credentials.
  Do not log transaction contents, notes, passphrases or key material.
- CSV is plaintext and requires explicit disclosure consent. Preserve scope,
  UTF-8 BOM, ISO dates, GBP labels and spreadsheet formula-injection protection,
  including whitespace/control and full-width prefixes. It is not a backup.
- Preserve backup format/schema/currency and size validation before replacement,
  isolated record validation, required encrypted safety backup and all-or-nothing
  restore rollback. Do not copy a live database file as a logical backup.
- Keep workspace credentials separate from backup passphrases. Do not expose keys
  in exports or replace destination workspace credentials during restore.

## UX and testing

- Keep copy short, calm and useful; preserve accessible labels and financial
  explanations. Do not remove failure feedback or safety consent to reduce text.
- Every visible control must work or be intentionally disabled with a clear state.
  Test save failure, cancel, confirmation, retries and refresh after mutations.
- Use Vitest/Testing Library for frontend tests, Rust tests for domain/persistence
  contracts and Playwright for desktop/mobile browser interactions.
- Playwright uses a strict stateful fictional Tauri IPC harness. It verifies the
  React UI, not native desktop encryption, credential access or private file I/O.
  Cover those separately in Rust; do not claim browser mocks prove native behaviour.
- Prefer getByRole/getByLabel and independent expected aggregates. Include refund/
  transfer exclusion, override recalculation, date limits, large totals above
  Number.MAX_SAFE_INTEGER, invalid inputs and restore failures when relevant.
- Node.js 24/npm and stable Rust/Cargo are the documented development/CI baseline.
  Follow package.json scripts and platform prerequisites in README.md.

## Verification and publishing

- Inspect relevant code before editing; make focused changes and add regression
  tests. Preserve unrelated worktree changes and stage intended paths explicitly.
- Run focused checks first. For code changes, use scripts/publish-change.sh with a
  descriptive Conventional Commit message; it runs the executable scripts/verify.sh
  gate before committing, pushes and checks the remote SHA. Never bypass the gate.
- The gate runs frontend lint, types, unit tests, Playwright, dependency audit and
  build; Rust format, Clippy and tests; and a Tauri build.
- For documentation-only changes, inspect content and git diff --check; application
  tests are unnecessary unless behaviour/configuration changed. Commit and publish
  only the intended documentation.
- Include the Copilot Co-authored-by trailer in commits. Never force-push, amend
  without approval, stage blindly or overwrite unrelated work.
- CI verifies Linux, macOS and Windows on pushes. For focused platform debugging,
  use the existing workflow_dispatch platform input rather than repeatedly running
  all platforms manually; the normal push matrix remains the final shared gate.
- Publishing scripts verify the remote SHA, not CI completion. Check Actions
  separately; report pending/failed jobs honestly. Report commit SHA, branch and
  verification results, and do not start a new feature before publishing the last.
- Give concise progress updates for long checks, naming the active job or blocker.
  Avoid repeated full verification runs when the relevant result is already known.
