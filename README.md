# PennyPilot

PennyPilot is a local-first personal finance and subscription tracker for the UK. It is being built as a desktop app and starts with a secure local workspace; financial data is not fabricated and the app does not connect to banks.

## Architecture

- Tauri 2 hosts a React and TypeScript interface built with Vite.
- Rust owns workspace security, financial rules, and database access. The UI calls narrow Tauri commands rather than issuing SQL.
- SQLite is compiled with SQLCipher. A random database key is wrapped with a passphrase-derived key and a separate random recovery key stored in the operating system credential store.
- The passphrase wrapper uses Argon2id; key wrappers use XChaCha20-Poly1305. Key material is zeroized where practical.
- The database lives in the operating-system application-data directory. On Unix, the workspace directory is restricted to the current user. On Windows, it is under the current user's application-data location.

The recovery key is available only through the OS credential store on the device where the workspace was created. It allows a user to set a new passphrase on that device; it is not a cloud or cross-device recovery service. Keep encrypted backups once that feature is available. Anyone who can use the same OS profile and access the application's recovery credential may be able to recover the database, so protect the device account.

The first workspace screen is the only implemented product flow in this increment. Transaction import, categorisation, budgets, subscriptions, analytics, and backup/export are planned subsequent features.

## Development

Prerequisites:

- Node.js 24 and npm
- Rust stable and Cargo
- Tauri system prerequisites for the host platform (including WebKitGTK development packages on Linux)
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
