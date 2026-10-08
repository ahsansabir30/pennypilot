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
