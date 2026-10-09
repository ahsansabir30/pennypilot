use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

mod finance;

const APP_SERVICE: &str = "com.pennypilot.desktop";
const RECOVERY_ACCOUNT: &str = "database-recovery-v1";
const KEY_ENVELOPE_VERSION: u32 = 1;
const MIN_PASSPHRASE_CHARACTERS: usize = 12;

#[derive(Debug, thiserror::Error)]
enum WorkspaceError {
    #[error("A workspace already exists.")]
    AlreadyExists,
    #[error("The passphrase must contain at least 12 characters.")]
    PassphraseTooShort,
    #[error("The passphrase could not unlock this workspace.")]
    InvalidPassphrase,
    #[error("The workspace files are incomplete or have an unsupported format.")]
    InvalidWorkspace,
    #[error("The operating system credential store is unavailable.")]
    RecoveryStoreUnavailable,
    #[error("The recovery key could not unlock this workspace.")]
    RecoveryFailed,
    #[error("The workspace is already unlocked.")]
    AlreadyUnlocked,
    #[error("The workspace is locked.")]
    Locked,
    #[error("The workspace storage operation failed.")]
    Storage,
    #[error("The workspace state is unavailable.")]
    StateUnavailable,
    #[error("The transaction data is invalid.")]
    InvalidFinancialInput,
    #[error("The requested record does not exist.")]
    RecordNotFound,
    #[error("This category is used by transactions, rules or budgets. Reassign or remove them before deleting it.")]
    CategoryInUse,
    #[error("A category with this name and type already exists.")]
    CategoryNameExists,
    #[error("You can create up to 200 categorisation rules.")]
    RuleLimit,
    #[error("This source transaction already exists with different financial details. The existing record was preserved.")]
    SourceTransactionChanged,
    #[error("Enter a goal name (up to 80 characters), positive GBP target, non-negative progress, valid optional calendar date and notes up to 1000 characters.")]
    InvalidGoal,
}

type WorkspaceResult<T> = Result<T, WorkspaceError>;

#[derive(Debug, Serialize, Deserialize)]
struct KeyEnvelope {
    version: u32,
    passphrase_salt: String,
    passphrase_nonce: String,
    passphrase_wrapped_key: String,
    recovery_nonce: String,
    recovery_wrapped_key: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum WorkspaceStatus {
    New,
    Locked,
    Unlocked,
}

trait RecoveryKeyStore: Send + Sync {
    fn store(&self, secret: &str) -> WorkspaceResult<()>;
    fn retrieve(&self) -> WorkspaceResult<String>;
    fn delete(&self) -> WorkspaceResult<()>;
}

struct OperatingSystemKeyStore;

impl RecoveryKeyStore for OperatingSystemKeyStore {
    fn store(&self, secret: &str) -> WorkspaceResult<()> {
        let entry = keyring::v1::Entry::new(APP_SERVICE, RECOVERY_ACCOUNT)
            .map_err(|_| WorkspaceError::RecoveryStoreUnavailable)?;
        entry
            .set_password(secret)
            .map_err(|_| WorkspaceError::RecoveryStoreUnavailable)
    }

    fn retrieve(&self) -> WorkspaceResult<String> {
        let entry = keyring::v1::Entry::new(APP_SERVICE, RECOVERY_ACCOUNT)
            .map_err(|_| WorkspaceError::RecoveryStoreUnavailable)?;
        entry
            .get_password()
            .map_err(|_| WorkspaceError::RecoveryStoreUnavailable)
    }

    fn delete(&self) -> WorkspaceResult<()> {
        let entry = keyring::v1::Entry::new(APP_SERVICE, RECOVERY_ACCOUNT)
            .map_err(|_| WorkspaceError::RecoveryStoreUnavailable)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(_) => Err(WorkspaceError::RecoveryStoreUnavailable),
        }
    }
}

struct AppState {
    connection: Mutex<Option<Connection>>,
    recovery_store: Arc<dyn RecoveryKeyStore>,
}

impl AppState {
    fn new(recovery_store: Arc<dyn RecoveryKeyStore>) -> Self {
        Self {
            connection: Mutex::new(None),
            recovery_store,
        }
    }

    fn is_unlocked(&self) -> WorkspaceResult<bool> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| WorkspaceError::StateUnavailable)?;
        Ok(connection.is_some())
    }

    fn set_connection(&self, connection: Connection) -> WorkspaceResult<()> {
        let mut current = self
            .connection
            .lock()
            .map_err(|_| WorkspaceError::StateUnavailable)?;
        if current.is_some() {
            return Err(WorkspaceError::AlreadyUnlocked);
        }
        *current = Some(connection);
        Ok(())
    }

    fn lock(&self) -> WorkspaceResult<()> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| WorkspaceError::StateUnavailable)?;
        if connection.take().is_none() {
            return Err(WorkspaceError::Locked);
        }
        Ok(())
    }
}

fn app_data_dir(app: &AppHandle) -> WorkspaceResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|_| WorkspaceError::Storage)
}

fn key_file(directory: &Path) -> PathBuf {
    directory.join("workspace.keys")
}

fn database_file(directory: &Path) -> PathBuf {
    directory.join("pennypilot.db")
}

fn random_bytes<const N: usize>() -> WorkspaceResult<[u8; N]> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|_| WorkspaceError::Storage)?;
    Ok(bytes)
}

fn passphrase_cipher_key(
    passphrase: &str,
    salt: &[u8; 16],
) -> WorkspaceResult<Zeroizing<[u8; 32]>> {
    let params = Params::new(64 * 1024, 3, 1, Some(32)).map_err(|_| WorkspaceError::Storage)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; 32]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(key)
}

fn seal_key(wrapping_key: &[u8; 32], database_key: &[u8; 32]) -> WorkspaceResult<(String, String)> {
    let nonce = random_bytes::<24>()?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(wrapping_key).map_err(|_| WorkspaceError::Storage)?;
    let nonce = XNonce::from(nonce);
    let ciphertext = cipher
        .encrypt(&nonce, database_key.as_slice())
        .map_err(|_| WorkspaceError::Storage)?;
    Ok((hex::encode(nonce.as_slice()), hex::encode(ciphertext)))
}

fn open_sealed_key(
    wrapping_key: &[u8; 32],
    nonce: &[u8; 24],
    ciphertext: &[u8],
) -> WorkspaceResult<Zeroizing<[u8; 32]>> {
    let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key)
        .map_err(|_| WorkspaceError::InvalidWorkspace)?;
    let nonce = XNonce::from(*nonce);
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(&nonce, ciphertext)
            .map_err(|_| WorkspaceError::InvalidPassphrase)?,
    );
    if plaintext.len() != 32 {
        return Err(WorkspaceError::InvalidWorkspace);
    }
    let mut key = Zeroizing::new([0_u8; 32]);
    key.copy_from_slice(&plaintext);
    Ok(key)
}

fn decode_array<const N: usize>(hex_value: &str) -> WorkspaceResult<[u8; N]> {
    let bytes = hex::decode(hex_value).map_err(|_| WorkspaceError::InvalidWorkspace)?;
    bytes
        .try_into()
        .map_err(|_| WorkspaceError::InvalidWorkspace)
}

fn make_envelope(
    passphrase: &str,
    database_key: &[u8; 32],
    recovery_key: &[u8; 32],
) -> WorkspaceResult<KeyEnvelope> {
    let salt = random_bytes::<16>()?;
    let passphrase_key = passphrase_cipher_key(passphrase, &salt)?;
    let (passphrase_nonce, passphrase_wrapped_key) = seal_key(&passphrase_key, database_key)?;
    let (recovery_nonce, recovery_wrapped_key) = seal_key(recovery_key, database_key)?;
    Ok(KeyEnvelope {
        version: KEY_ENVELOPE_VERSION,
        passphrase_salt: hex::encode(salt),
        passphrase_nonce,
        passphrase_wrapped_key,
        recovery_nonce,
        recovery_wrapped_key,
    })
}

fn unwrap_database_key(
    envelope: &KeyEnvelope,
    wrapping_key: &[u8; 32],
    recovery: bool,
) -> WorkspaceResult<Zeroizing<[u8; 32]>> {
    if envelope.version != KEY_ENVELOPE_VERSION {
        return Err(WorkspaceError::InvalidWorkspace);
    }
    let (nonce_hex, wrapped_key_hex) = if recovery {
        (&envelope.recovery_nonce, &envelope.recovery_wrapped_key)
    } else {
        (&envelope.passphrase_nonce, &envelope.passphrase_wrapped_key)
    };
    let nonce = decode_array::<24>(nonce_hex)?;
    let ciphertext = hex::decode(wrapped_key_hex).map_err(|_| WorkspaceError::InvalidWorkspace)?;
    match open_sealed_key(wrapping_key, &nonce, &ciphertext) {
        Err(WorkspaceError::InvalidPassphrase) if recovery => Err(WorkspaceError::RecoveryFailed),
        result => result,
    }
}

fn read_envelope(directory: &Path) -> WorkspaceResult<KeyEnvelope> {
    let content = fs::read(key_file(directory)).map_err(|_| WorkspaceError::InvalidWorkspace)?;
    let envelope: KeyEnvelope =
        serde_json::from_slice(&content).map_err(|_| WorkspaceError::InvalidWorkspace)?;
    if envelope.version != KEY_ENVELOPE_VERSION {
        return Err(WorkspaceError::InvalidWorkspace);
    }
    Ok(envelope)
}

fn write_envelope(directory: &Path, envelope: &KeyEnvelope) -> WorkspaceResult<()> {
    fs::create_dir_all(directory).map_err(|_| WorkspaceError::Storage)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| WorkspaceError::Storage)?;
    }
    let serialized = serde_json::to_vec(envelope).map_err(|_| WorkspaceError::Storage)?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| WorkspaceError::Storage)?;
    temporary
        .write_all(&serialized)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| WorkspaceError::Storage)?;
    temporary
        .persist(key_file(directory))
        .map_err(|_| WorkspaceError::Storage)?;
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(())
}

fn configure_database(connection: &Connection, database_key: &[u8; 32]) -> WorkspaceResult<()> {
    let key_hex = hex::encode(database_key);
    connection
        .execute_batch(&format!(
            "PRAGMA key = \"x'{key_hex}'\";\
             PRAGMA cipher_memory_security = ON;\
             PRAGMA temp_store = MEMORY;\
             PRAGMA foreign_keys = ON;"
        ))
        .map_err(|_| WorkspaceError::Storage)?;
    let _: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| WorkspaceError::Storage)?;
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| WorkspaceError::InvalidPassphrase)?;
    Ok(())
}

fn open_database(directory: &Path, database_key: &[u8; 32]) -> WorkspaceResult<Connection> {
    let path = database_file(directory);
    if !path.exists() {
        return Err(WorkspaceError::InvalidWorkspace);
    }
    let connection = Connection::open(path).map_err(|_| WorkspaceError::Storage)?;
    configure_database(&connection, database_key)?;
    initialize_database(&connection)?;
    Ok(connection)
}

fn remove_if_present(path: &Path) -> WorkspaceResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(WorkspaceError::Storage),
    }
}

fn cleanup_created_workspace(directory: &Path, state: &AppState) -> WorkspaceResult<()> {
    remove_if_present(&database_file(directory))?;
    remove_if_present(&key_file(directory))?;
    state.recovery_store.delete()
}

fn initialize_database(connection: &Connection) -> WorkspaceResult<()> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY NOT NULL,
                 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS app_metadata (
                 key TEXT PRIMARY KEY NOT NULL,
                 value TEXT NOT NULL
             );
             INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
             COMMIT;",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    finance::initialize_schema(connection)
}

fn validate_passphrase(passphrase: &str) -> WorkspaceResult<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARACTERS {
        return Err(WorkspaceError::PassphraseTooShort);
    }
    Ok(())
}

fn create_workspace(directory: &Path, state: &AppState, passphrase: &str) -> WorkspaceResult<()> {
    validate_passphrase(passphrase)?;
    if state.is_unlocked()? {
        return Err(WorkspaceError::AlreadyUnlocked);
    }
    fs::create_dir_all(directory).map_err(|_| WorkspaceError::Storage)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| WorkspaceError::Storage)?;
    }
    let keys_path = key_file(directory);
    let db_path = database_file(directory);
    if keys_path.exists() || db_path.exists() {
        return Err(WorkspaceError::AlreadyExists);
    }

    let database_key = Zeroizing::new(random_bytes::<32>()?);
    let recovery_key = Zeroizing::new(random_bytes::<32>()?);
    let envelope = make_envelope(passphrase, &database_key, &recovery_key)?;
    let recovery_secret = Zeroizing::new(hex::encode(recovery_key.as_ref()));
    state.recovery_store.store(&recovery_secret)?;
    if let Err(error) = write_envelope(directory, &envelope) {
        cleanup_created_workspace(directory, state)?;
        return Err(error);
    }

    let initialization = (|| {
        let connection = Connection::open(&db_path).map_err(|_| WorkspaceError::Storage)?;
        configure_database(&connection, &database_key)?;
        initialize_database(&connection)?;
        Ok(connection)
    })();
    let connection = match initialization {
        Ok(connection) => connection,
        Err(error) => {
            cleanup_created_workspace(directory, state)?;
            return Err(error);
        }
    };
    state.set_connection(connection)
}

fn unlock_workspace(directory: &Path, state: &AppState, passphrase: &str) -> WorkspaceResult<()> {
    if state.is_unlocked()? {
        return Err(WorkspaceError::AlreadyUnlocked);
    }
    let envelope = read_envelope(directory)?;
    let salt = decode_array::<16>(&envelope.passphrase_salt)?;
    let passphrase_key = passphrase_cipher_key(passphrase, &salt)?;
    let database_key = unwrap_database_key(&envelope, &passphrase_key, false)?;
    let connection = open_database(directory, &database_key)?;
    state.set_connection(connection)
}

fn recover_workspace(
    directory: &Path,
    state: &AppState,
    new_passphrase: &str,
) -> WorkspaceResult<()> {
    validate_passphrase(new_passphrase)?;
    if state.is_unlocked()? {
        return Err(WorkspaceError::AlreadyUnlocked);
    }
    let mut envelope = read_envelope(directory)?;
    let recovery_hex = Zeroizing::new(state.recovery_store.retrieve()?);
    let recovery_key = Zeroizing::new(decode_array::<32>(&recovery_hex)?);
    let database_key = unwrap_database_key(&envelope, &recovery_key, true)?;
    let connection = open_database(directory, &database_key)?;
    let replacement = make_envelope(new_passphrase, &database_key, &recovery_key)?;
    envelope.passphrase_salt = replacement.passphrase_salt;
    envelope.passphrase_nonce = replacement.passphrase_nonce;
    envelope.passphrase_wrapped_key = replacement.passphrase_wrapped_key;
    write_envelope(directory, &envelope)?;
    state.set_connection(connection)
}

#[tauri::command]
fn workspace_status(app: AppHandle, state: State<'_, AppState>) -> Result<WorkspaceStatus, String> {
    if state.is_unlocked().map_err(|error| error.to_string())? {
        return Ok(WorkspaceStatus::Unlocked);
    }
    let directory = app_data_dir(&app).map_err(|error| error.to_string())?;
    let keys_exist = key_file(&directory).exists();
    let database_exists = database_file(&directory).exists();
    match (keys_exist, database_exists) {
        (false, false) => Ok(WorkspaceStatus::New),
        (true, true) => Ok(WorkspaceStatus::Locked),
        _ => Err(WorkspaceError::InvalidWorkspace.to_string()),
    }
}

#[tauri::command]
fn create_workspace_command(
    app: AppHandle,
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<(), String> {
    let passphrase = Zeroizing::new(passphrase);
    create_workspace(
        &app_data_dir(&app).map_err(|error| error.to_string())?,
        &state,
        &passphrase,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn unlock_workspace_command(
    app: AppHandle,
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<(), String> {
    let passphrase = Zeroizing::new(passphrase);
    unlock_workspace(
        &app_data_dir(&app).map_err(|error| error.to_string())?,
        &state,
        &passphrase,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn recover_workspace_command(
    app: AppHandle,
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<(), String> {
    let passphrase = Zeroizing::new(passphrase);
    recover_workspace(
        &app_data_dir(&app).map_err(|error| error.to_string())?,
        &state,
        &passphrase,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn lock_workspace(state: State<'_, AppState>) -> Result<(), String> {
    state.lock().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new(Arc::new(OperatingSystemKeyStore));
    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            workspace_status,
            create_workspace_command,
            unlock_workspace_command,
            recover_workspace_command,
            lock_workspace,
            finance::list_finance_data,
            finance::list_transactions,
            finance::create_transaction,
            finance::update_transaction_category,
            finance::delete_transaction,
            finance::categorisation::list_category_rules,
            finance::categorisation::save_category_rule,
            finance::categorisation::delete_category_rule,
            finance::categorisation::save_category,
            finance::categorisation::delete_category,
            finance::categorisation::reclassify_transactions,
            finance::categorisation::reset_transaction_category,
            finance::budgets::list_budgets,
            finance::budgets::save_budget,
            finance::budgets::delete_budget,
            finance::budgets::save_budget_preferences,
            finance::savings::list_savings_goals,
            finance::savings::save_savings_goal,
            finance::savings::delete_savings_goal
        ])
        .run(tauri::generate_context!())
        .expect("failed to start PennyPilot");
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemoryKeyStore(Mutex<Option<String>>);

    impl RecoveryKeyStore for MemoryKeyStore {
        fn store(&self, secret: &str) -> WorkspaceResult<()> {
            *self
                .0
                .lock()
                .map_err(|_| WorkspaceError::StateUnavailable)? = Some(secret.to_owned());
            Ok(())
        }

        fn retrieve(&self) -> WorkspaceResult<String> {
            self.0
                .lock()
                .map_err(|_| WorkspaceError::StateUnavailable)?
                .clone()
                .ok_or(WorkspaceError::RecoveryStoreUnavailable)
        }

        fn delete(&self) -> WorkspaceResult<()> {
            *self
                .0
                .lock()
                .map_err(|_| WorkspaceError::StateUnavailable)? = None;
            Ok(())
        }
    }

    fn test_state() -> AppState {
        AppState::new(Arc::new(MemoryKeyStore::default()))
    }

    #[test]
    fn database_is_encrypted_and_recovery_resets_the_passphrase() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let state = test_state();
        let original_passphrase = "a long passphrase for testing";
        create_workspace(directory.path(), &state, original_passphrase)
            .expect("create encrypted workspace");
        state.lock().expect("lock workspace");

        let database_bytes =
            fs::read(database_file(directory.path())).expect("read database bytes");
        assert!(!database_bytes.starts_with(b"SQLite format 3"));

        assert!(matches!(
            unlock_workspace(directory.path(), &state, "incorrect passphrase"),
            Err(WorkspaceError::InvalidPassphrase)
        ));
        recover_workspace(
            directory.path(),
            &state,
            "a replacement passphrase for testing",
        )
        .expect("recover using OS key-store secret");
        state.lock().expect("lock recovered workspace");
        unlock_workspace(
            directory.path(),
            &state,
            "a replacement passphrase for testing",
        )
        .expect("unlock using replacement passphrase");
    }

    #[test]
    fn passphrase_length_is_checked_without_trimming() {
        assert!(matches!(
            validate_passphrase("short"),
            Err(WorkspaceError::PassphraseTooShort)
        ));
        assert!(validate_passphrase("twelve chars").is_ok());
        assert!(validate_passphrase("éééééééééééé").is_ok());
    }

    #[test]
    fn recovery_rejects_an_invalid_device_key() {
        let database_key = random_bytes::<32>().expect("database key");
        let recovery_key = random_bytes::<32>().expect("recovery key");
        let envelope = make_envelope(
            "a long passphrase for testing",
            &database_key,
            &recovery_key,
        )
        .expect("key envelope");
        let incorrect_key = random_bytes::<32>().expect("incorrect recovery key");

        assert!(matches!(
            unwrap_database_key(&envelope, &incorrect_key, true),
            Err(WorkspaceError::RecoveryFailed)
        ));
    }
}
