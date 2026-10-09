# PennyPilot

PennyPilot is a local-first personal finance and subscription tracker for the UK. It is being built as a desktop app and starts with a secure local workspace; financial data is not fabricated and the app does not connect to banks.

## Architecture

- Tauri 2 hosts a React and TypeScript interface built with Vite.
- Rust owns workspace security, financial rules, and database access. The UI calls narrow Tauri commands rather than issuing SQL.
- SQLite is compiled with SQLCipher. A random database key is wrapped with a passphrase-derived key and a separate random recovery key stored in the operating system credential store. The crypto provider uses the macOS Security framework, system OpenSSL on Linux, and OpenSSL from vcpkg for Windows builds.
- The passphrase wrapper uses Argon2id; key wrappers use XChaCha20-Poly1305. Key material is zeroized where practical.
- The database lives in the operating-system application-data directory. On Unix, the workspace directory is restricted to the current user. On Windows, it is under the current user's application-data location.
- SQLCipher's automatic diagnostic logging is disabled at compile time. This avoids recursive memory-lock logging on Windows when `VirtualLock` is denied; cipher memory security remains enabled, and database errors are still returned to the application.

The recovery key is available only through the OS credential store on the device where the workspace was created. It allows a user to set a new passphrase on that device; it is not a cloud or cross-device recovery service. Keep encrypted backups and their separate backup passphrases. Anyone who can use the same OS profile and access the application's recovery credential may be able to recover the database, so protect the device account.

The unlocked workspace now includes a financial overview backed by encrypted SQLite records. New workspaces receive a GBP main account and starter income/expense categories; they do not receive fictional financial transactions or hardcoded dashboard totals. Transactions are entered manually in this increment.

The home dashboard surfaces up to three monthly category budgets (highest usage first) and three savings goals, with clear links to their complete editors. A count includes all over-limit budgets, even beyond the preview. Remaining allowance comes from recorded category expenses less refunds, not an assumed balance; savings progress is the amount you explicitly entered. These previews refresh after edits, category corrections and restore, and provide independent loading, error/retry and actionable empty states. Phone and tablet layouts show transactions as readable cards without horizontal scrolling, while desktop retains a searchable table. Manual category explanations are available under **Category details**; conflicting automatic rules remain visible. Bills, subscriptions and unusual-spending alerts are not fabricated from missing evidence.

Only one management panel opens at a time. Budget and goal shortcuts focus their editor, including repeated clicks. Detailed periods, calculations, notes and file formats remain available in expandable sections instead of repeated helper paragraphs. Failed locks remain visible while the workspace stays unlocked; failed rule loads provide a retry rather than an empty list. Budget saves clear the form only on success. Restore keeps the private-data panel open so the safety-backup path and instructions remain visible.

## Deterministic categorisation

- Merchant normalization lowercases Unicode letters, replaces punctuation/whitespace runs with a single space, and trims the result. Digits and accents are retained; original merchant text is kept. It does not guess away bank prefixes, branch numbers, or references.
- Manage categories and rules from the dashboard. Category names and colours are editable; income/expense type is fixed once created. Referenced categories cannot be deleted. Starter categories/rules are seeded once, so edits and deletions survive reopening.
- Rules use either an exact normalized merchant name or a whole normalized phrase anywhere in that name, not regexes or wildcard matching. Description text is not used as a merchant substitute. Income rules only apply to income; expense rules also apply to refunds; transfers remain excluded.
- Higher priority wins (0–1000, up to 200 rules). Same-category ties agree. Highest-priority ties targeting different categories remain **Uncategorised**. Each automatic transaction stores an explanation listing matching patterns, category names and priorities, including lower-priority overlaps. Explanations are snapshots from the last classification.
- Default rules cover fictional fixture merchants such as North Market, Coffee Shop, Streaming Service and Salary Payment. They are editable/deletable examples, not claims about real merchants. No sample transactions or financial totals are inserted.
- New transactions default to automatic categorisation, falling back to Uncategorised when no compatible rule matches. Selecting a category or explicitly selecting Uncategorised stores a **manual choice**. Manual corrections, including clearing a category, cannot be overwritten by rules. Existing pre-feature records conservatively retain their choices as manual.
- Saving/deleting a rule affects subsequent transactions only. **Reclassify automatic transactions** explicitly applies current rules to existing non-manual records and refreshes dashboard category totals. **Use rules (clear manual choice)** is the only action that clears an individual manual override.
- The transaction ingestion command accepts an optional stable `sourceId`, unique within an account. Re-ingesting the same source returns the existing transaction without altering its category or override; a changed date, kind or amount is rejected explicitly. Without a source ID, creation is a distinct manual record. CSV import is not included yet; its future importer must pass stable source IDs through this same ingestion path.
- All categorisation runs locally in Rust against the encrypted database. No LLM, external service or additional server is used.

## Financial data and accounting

- Accounts and categories are stored in the encrypted workspace. Accounts use GBP.
- Transaction amounts are positive integer pence (for example, `1234` is £12.34); direction is represented by the transaction kind, not a negative amount.
- Individual amounts and limits are capped at 99,999,999,999 pence, safely representable as JavaScript numbers. Aggregate totals remain signed 64-bit integer pence in Rust/SQLite and cross IPC as decimal strings. The UI uses BigInt for currency arithmetic, comparisons and formatting, including totals beyond JavaScript's safe-integer range. Only chart/progress proportions use floating point. Totals outside the signed 64-bit range fail explicitly rather than rounding or wrapping.
- Income, expenses, refunds, and transfers are distinct transaction kinds. A refund is a credit against spending: monthly spending is expenses less refunds, and net cash flow is income less that net spending. Refunds are not reported as income.
- Transfers are retained as transactions but excluded from income, spending, category totals, and net cash flow.
- Transaction dates are validated ISO calendar dates from 1000-01-01 through 9999-12-31 and grouped by their source date. Merchant display text is retained separately from its normalized, lowercase matching field.
- Transactions can be created, searched, filtered, sorted, paginated, corrected to a compatible category, and deleted with an in-app confirmation. Edits are intentionally limited to category correction; dates and amounts are immutable through this UI.
- The dashboard shows values from persisted records only. Its trend covers up to six months ending at the selected month; supported empty months display zero recorded activity, not evidence of no actual activity. Months before January 1000 are unavailable and omitted with an explanation, not queried as invalid dates.

## Monthly budgets and insights

Open **Budgets** from the dashboard. Limits are positive integer GBP pence for a specific category and calendar month; setting a limit does not roll it into other months. Category IDs link budgets to edited category names. A category referenced by a budget cannot be deleted until its budgets are removed.

Budget used is recorded expenses minus refunds in that transaction's current category, by validated source date. Transfers and income are excluded. Manual category corrections and explicit rule reclassification refresh usage. Refund-only periods may produce negative usage: the amount and remaining allowance retain that fact, while the progress bar floors at zero. Above-limit amounts and usage of at least 80% are marked using recorded evidence only.

Past months use their full calendar period (including leap days); the current month stops at the local as-of date; future months have no elapsed usage. Same-elapsed-days comparison for partial months is the default, capped at the previous month's last day. Users can choose full-previous-month comparison, explicitly labelled as potentially unequal periods; this preference persists in the encrypted workspace. Comparisons show recorded amounts, dates and record counts, not claims of complete banking history. Missing category records yield no inferred comparison. January 1000 has no supported previous month: its comparison month, end date and amount are absent in both modes, and the UI explains that no comparison is available. Net cash flow is not an account balance, and no forecasts are presented.

## Savings goals

**Manage savings goals** stores a name, positive GBP target, explicitly entered non-negative GBP progress, optional validated calendar target date and editable notes. All amounts are integer pence in the encrypted workspace. Progress can be zero or exceed the target; overfunding is retained and displayed. Remaining is `max(target - progress, 0)`. The percentage uses the entered progress divided by the target; only the visual progress bar caps at 100%.

The inputs are shown with each calculation. Goal progress is never inferred from imported income, transaction history, net cash flow or an assumed bank balance. Goals do not move or reserve funds. Target dates are user preferences, not estimated completion dates; this release intentionally makes no projected outcomes. Edits and confirmed deletions do not change transactions.

## Private transaction export

Open **Export & backup** and review the CSV date range, account, category, kind and literal search filter. Defaults copy the dashboard month and filters when the panel is opened. Export includes all matching rows, not just the current page. Both date endpoints are inclusive. A separate plaintext-disclosure checkbox is required; no file is uploaded or shared.

CSV format is UTF-8 with a BOM for spreadsheet compatibility, comma separators, CRLF record endings and quoted data cells with doubled embedded quotes. Source dates are `YYYY-MM-DD`; currency is explicitly `GBP`; amounts are positive decimal pounds with exactly two places **and** integer pence. `kind` supplies direction: refunds are not income and transfers are not spending. The whitelist contains transaction ID, source date, account name, kind, amounts/currency, category, original and normalized merchant, description and category provenance. It excludes source IDs, goal notes, workspace keys, credentials and passphrases. Spreadsheet-sensitive text beginning with `=`, `+`, `-`, `@` (including leading whitespace/control characters and full-width equivalents) is prefixed with an apostrophe. This intentionally changes report text for safety; CSV is not a backup or a lossless re-import format.

Exports are plaintext financial information. Protect or deliberately remove them when no longer needed. A scope over 100,000 transactions or a file over 64 MiB is rejected without writing a partial export; narrow the scope.

## Encrypted backup and safe restore

Backups and exports are written only on explicit user action to private subfolders of the OS application-data directory, **outside the Git repository**. The UI displays exact local paths after success. Typical locations:

| OS | Application-data root |
| --- | --- |
| macOS | `~/Library/Application Support/com.pennypilot.desktop/` |
| Windows | `%APPDATA%\\com.pennypilot.desktop\\` |
| Linux | `$XDG_DATA_HOME/com.pennypilot.desktop/` (usually `~/.local/share/com.pennypilot.desktop/`) |

Encrypted files use `private-backups/pennypilot-<random-id>.ppbackup`; CSV uses `private-exports/pennypilot-<random-id>.csv`. Existing files are never overwritten. Unix folders are mode 0700 and files 0600; Windows files inherit the current user's application-data permissions. These folders are local, not an off-device disaster-recovery copy: use your file manager to copy encrypted backups to a private offline drive. PennyPilot does not configure cloud storage, upload, schedule exports or share files.

SQLite/SQLCipher supports consistent read transactions and backup facilities. PennyPilot uses a **logical snapshot**, not a copy of the live encrypted database file: one read transaction under the workspace lock reads accounts, categories, source-dated transactions, source IDs/manual overrides/explanations, rules, budgets, comparison preference and savings goals/notes from the same database state. It carries domain data and identifiers, not internal database creation timestamps, app metadata or credential files. Merchant normalization is regenerated deterministically on restore. There are no hardcoded totals or stored inferred balances.

Version 1 backups accept only schema 5 and GBP. The JSON envelope contains a format/version, fixed KDF/cipher labels, random 16-byte salt, random 24-byte nonce and hex ciphertext. The authenticated payload is encrypted using **XChaCha20-Poly1305**; the independent backup passphrase is derived with **Argon2id** (64 MiB memory, three passes, one lane, 32-byte key). Encryption is mandatory; there is no plaintext-backup option. A backup passphrase must have 12–1024 characters. Passphrases/keys are not stored inside the backup; serialized plaintext and derived key buffers are zeroized where practical. Losing the backup passphrase makes that file unrecoverable—even with the workspace OS recovery credential.

Restore procedure:

1. Unlock the destination workspace. On another device, create a new local workspace first; its unlock passphrase and recovery credential remain its own.
2. Paste the absolute local `.ppbackup` file path and enter that file's backup passphrase. Review the replacement warning, check the consent box and type **RESTORE**.
3. The file is size-bounded (64 MiB envelope, 24 MiB plaintext, at most 100,000 records per domain table / 200 rules). Version/currency, authenticated encryption, types, IDs, relationships, dates, amounts, categories, rule limits and manual provenance are validated in an isolated in-memory database **before current data changes**. Unknown/corrupted formats and incompatible backups are rejected.
4. Before replacing anything, PennyPilot must successfully create an encrypted **pre-restore safety backup** in `private-backups`, using the backup passphrase just entered. A safety-backup failure aborts restore. After successful restore, its exact path is shown. A failed write may also leave this safety file in that folder.
5. Domain records are replaced in one SQLite transaction in the existing SQLCipher database. A failed write or final commit rolls back deletions and inserts, including on the live application connection; successful restore is all-or-nothing, not a merge. Workspace key envelopes, OS recovery credentials and unlock passphrases are never replaced. Keep the safety backup until you have reviewed the restored data.

Round-trip, cross-device/different-key persistence, corrupted-file, wrong-passphrase, incompatible-schema, invalid-record, injected-write-failure and commit-lock-failure tests cover the restore contract. CSV and raw database files are not accepted as restore backups.

CSV import, custom accounts and recurring payment detection remain planned work.

## Development

Prerequisites:

- Node.js 24 and npm
- Rust stable and Cargo
- Tauri system prerequisites for the host platform (including WebKitGTK and OpenSSL development packages on Linux)
- OpenSSL development libraries for Windows (the CI workflow installs them through vcpkg)
- An available OS credential store (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)

Install frontend dependencies and start the desktop app:

```sh
npm ci
npx playwright install chromium
npm run tauri dev
```

Run the project verification gate:

```sh
./scripts/verify.sh
```

The gate runs frontend linting, type-checking, unit and Playwright tests, a high-severity dependency audit and build; Rust formatting, Clippy and tests; and a Tauri desktop build. GitHub Actions installs Chromium (including Linux dependencies) and runs the same gate on macOS, Windows, and Linux. `scripts/publish-change.sh` refuses to publish unless this executable verification script succeeds.

Run browser workflows separately with `npm run test:e2e`. Chromium desktop and mobile projects use a dedicated Vite server on `127.0.0.1:1422` and isolated browser contexts; an existing server is not reused. Failure traces and results stay under `node_modules/.tmp/playwright-results`. On Linux, install browser prerequisites with `npx playwright install --with-deps chromium`.

Browser tests exercise the real React interface with a strict, stateful, fictional-only Tauri IPC harness: records change on edits, summaries are calculated from those records, unsupported commands fail, and normal flows must have no console or page errors. They cover navigation, loading/retries, validation, transaction/category/rule controls, filters and pagination, budgets, savings, local export consent and restore feedback. These are frontend interaction tests, **not native desktop end-to-end tests**: they do not open a real workspace, access the OS credential store, write private files or prove encryption. Rust tests separately verify financial calculations, persistence, encryption and backup/restore safety.

## Privacy and test data

Use fictional data in development and automated tests. Never commit real statements, database files, exports, backups, secrets, or passphrases. CSV exports are plaintext and require deliberate disclosure consent; backups are always independently passphrase-encrypted. The publishing script rejects database files, key files and `.ppbackup` files.
