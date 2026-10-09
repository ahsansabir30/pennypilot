# PennyPilot

PennyPilot is a local-first personal finance and subscription tracker for the UK. It is being built as a desktop app and starts with a secure local workspace; financial data is not fabricated and the app does not connect to banks.

## Architecture

- Tauri 2 hosts a React and TypeScript interface built with Vite.
- Rust owns workspace security, financial rules, and database access. The UI calls narrow Tauri commands rather than issuing SQL.
- SQLite is compiled with SQLCipher. A random database key is wrapped with a passphrase-derived key and a separate random recovery key stored in the operating system credential store. The crypto provider uses the macOS Security framework, system OpenSSL on Linux, and OpenSSL from vcpkg for Windows builds.
- The passphrase wrapper uses Argon2id; key wrappers use XChaCha20-Poly1305. Key material is zeroized where practical.
- The database lives in the operating-system application-data directory. On Unix, the workspace directory is restricted to the current user. On Windows, it is under the current user's application-data location.
- SQLCipher's automatic diagnostic logging is disabled at compile time. This avoids recursive memory-lock logging on Windows when `VirtualLock` is denied; cipher memory security remains enabled, and database errors are still returned to the application.

The recovery key is available only through the OS credential store on the device where the workspace was created. It allows a user to set a new passphrase on that device; it is not a cloud or cross-device recovery service. Keep encrypted backups once that feature is available. Anyone who can use the same OS profile and access the application's recovery credential may be able to recover the database, so protect the device account.

The unlocked workspace now includes a financial overview backed by encrypted SQLite records. New workspaces receive a GBP main account and starter income/expense categories; they do not receive fictional financial transactions or hardcoded dashboard totals. Transactions are entered manually in this increment.

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
- Income, expenses, refunds, and transfers are distinct transaction kinds. A refund is a credit against spending: monthly spending is expenses less refunds, and net cash flow is income less that net spending. Refunds are not reported as income.
- Transfers are retained as transactions but excluded from income, spending, category totals, and net cash flow.
- Transaction dates are validated ISO calendar dates and grouped by their source date. Merchant display text is retained separately from its normalized, lowercase matching field.
- Transactions can be created, searched, filtered, sorted, paginated, corrected to a compatible category, and deleted with an in-app confirmation. Edits are intentionally limited to category correction; dates and amounts are immutable through this UI.
- The dashboard shows values from persisted records only. Its trend covers six months ending at the selected month; empty months display zero.

CSV import, custom accounts/categories, recurring payments, budgets, savings goals, and backup/export remain planned work.

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
npm run tauri dev
```

Run the project verification gate:

```sh
./scripts/verify.sh
```

The gate runs frontend linting, type-checking, tests, a high-severity dependency audit and build; Rust formatting, Clippy and tests; and a Tauri desktop build. GitHub Actions runs the same gate on macOS, Windows, and Linux. `scripts/publish-change.sh` refuses to publish unless this executable verification script succeeds.

## Privacy and test data

Use fictional data in development and automated tests. Never commit real statements, database files, exports, backups, secrets, or passphrases. CSV/report exports, when implemented, will be plaintext and must be initiated by the user with a clear sensitivity warning; backups are planned to remain encrypted.
