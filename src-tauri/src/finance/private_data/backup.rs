use super::*;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::de::DeserializeOwned;
use std::io::Read;
use zeroize::Zeroizing;

const FORMAT: &str = "pennypilot-encrypted-backup";
const SCHEMA: u32 = 5;
const AAD: &[u8] = b"PennyPilot encrypted backup v1; Argon2id-v1; XChaCha20-Poly1305";
const MAX_PLAINTEXT: usize = 24 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedBackup {
    format: String,
    version: u32,
    kdf: String,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTransaction {
    id: i64,
    input: TransactionInput,
    category_source: String,
    category_explanation: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    currency: String,
    created_at: String,
    accounts: Vec<Account>,
    categories: Vec<Category>,
    transactions: Vec<StoredTransaction>,
    rules: Vec<categorisation::CategoryRule>,
    budgets: Vec<budgets::BudgetInput>,
    comparison_mode: String,
    goals: Vec<savings::Goal>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreResult {
    safety_backup_path: String,
    record_count: u32,
}

fn collect<T>(
    connection: &Connection,
    sql: &str,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> WorkspaceResult<Vec<T>> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|_| WorkspaceError::Storage)?;
    let items = statement
        .query_map([], map)
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(items)
}

fn capture(connection: &Connection) -> WorkspaceResult<Snapshot> {
    categorisation::atomic(connection, || {
        let version: u32 = connection
            .query_row("SELECT max(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .map_err(|_| WorkspaceError::Storage)?;
        if version != SCHEMA {
            return Err(WorkspaceError::InvalidBackup);
        }
        for table in [
            "accounts",
            "categories",
            "transactions",
            "category_rules",
            "monthly_budgets",
            "savings_goals",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .map_err(|_| WorkspaceError::Storage)?;
            if count > MAX_RECORDS as i64 {
                return Err(WorkspaceError::DataLimit);
            }
        }
        let created_at = connection
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(|_| WorkspaceError::Storage)?;
        let accounts = collect(
            connection,
            "SELECT id,name,currency_code FROM accounts ORDER BY id",
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    currency_code: row.get(2)?,
                })
            },
        )?;
        let categories = collect(
            connection,
            "SELECT id,name,category_type,color FROM categories ORDER BY id",
            |row| {
                Ok(Category {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    category_type: row.get(2)?,
                    color: row.get(3)?,
                })
            },
        )?;
        let transactions=collect(connection,
            "SELECT id,source_id,account_id,category_id,amount_pence,kind,transaction_date,description,merchant,category_source,category_explanation
             FROM transactions ORDER BY id", |row| {
                let source:String=row.get(9)?;
                Ok(StoredTransaction {id:row.get(0)?,input:TransactionInput {
                    source_id:row.get(1)?,manual_category:source=="manual",account_id:row.get(2)?,category_id:row.get(3)?,
                    amount_pence:row.get(4)?,kind:row.get(5)?,transaction_date:row.get(6)?,description:row.get(7)?,merchant:row.get(8)?,
                },category_source:source,category_explanation:row.get(10)?})
            })?;
        let rules = categorisation::rules(connection)?;
        let budgets = collect(
            connection,
            "SELECT month,category_id,limit_pence FROM monthly_budgets ORDER BY month,category_id",
            |row| {
                Ok(budgets::BudgetInput {
                    month: row.get(0)?,
                    category_id: row.get(1)?,
                    limit_pence: row.get(2)?,
                })
            },
        )?;
        let comparison_mode = connection
            .query_row(
                "SELECT comparison_mode FROM budget_preferences WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| WorkspaceError::Storage)?;
        let goals = savings::list(connection)?;
        Ok(Snapshot {
            schema_version: SCHEMA,
            currency: "GBP".to_owned(),
            created_at,
            accounts,
            categories,
            transactions,
            rules,
            budgets,
            comparison_mode,
            goals,
        })
    })
}

fn valid_id(id: i64) -> WorkspaceResult<()> {
    if !(1..=9_007_199_254_740_991).contains(&id) {
        return Err(WorkspaceError::InvalidBackup);
    }
    Ok(())
}

fn replace(connection: &Connection, snapshot: &Snapshot) -> WorkspaceResult<()> {
    if snapshot.schema_version != SCHEMA
        || snapshot.currency != "GBP"
        || snapshot.accounts.is_empty()
        || snapshot.created_at.len() > 40
        || snapshot.rules.len() > 200
        || [
            snapshot.accounts.len(),
            snapshot.categories.len(),
            snapshot.transactions.len(),
            snapshot.budgets.len(),
            snapshot.goals.len(),
        ]
        .into_iter()
        .any(|count| count > MAX_RECORDS)
    {
        return Err(WorkspaceError::InvalidBackup);
    }
    categorisation::atomic(connection, || {
        connection
            .execute_batch(
                "DELETE FROM transactions; DELETE FROM category_rules; DELETE FROM monthly_budgets;
            DELETE FROM savings_goals; DELETE FROM categories; DELETE FROM accounts;",
            )
            .map_err(|_| WorkspaceError::Storage)?;
        for account in &snapshot.accounts {
            valid_id(account.id)?;
            if account.name.trim().is_empty()
                || account.name.chars().count() > 80
                || account.currency_code != "GBP"
            {
                return Err(WorkspaceError::InvalidBackup);
            }
            connection
                .execute(
                    "INSERT INTO accounts(id,name,currency_code) VALUES(?1,?2,?3)",
                    params![account.id, account.name, account.currency_code],
                )
                .map_err(|_| WorkspaceError::Storage)?;
        }
        for category in &snapshot.categories {
            valid_id(category.id)?;
            connection
                .execute(
                    "INSERT INTO categories(id,name,category_type,color) VALUES(?1,?2,?3,?4)",
                    params![
                        category.id,
                        category.name,
                        category.category_type,
                        category.color
                    ],
                )
                .map_err(|_| WorkspaceError::Storage)?;
            categorisation::save_category_from(
                connection,
                &categorisation::CategoryInput {
                    id: Some(category.id),
                    name: category.name.clone(),
                    category_type: category.category_type.clone(),
                    color: category.color.clone(),
                },
            )?;
        }
        for rule in &snapshot.rules {
            let id = rule.id.ok_or(WorkspaceError::InvalidBackup)?;
            valid_id(id)?;
            connection.execute("INSERT INTO category_rules(id,pattern,match_type,category_id,priority,enabled) VALUES(?1,?2,?3,?4,?5,?6)",
                params![id,rule.pattern,rule.match_type,rule.category_id,rule.priority,rule.enabled]).map_err(|_|WorkspaceError::Storage)?;
            categorisation::save_rule(connection, rule)?;
        }
        for stored in &snapshot.transactions {
            valid_id(stored.id)?;
            let input = &stored.input;
            validate_transaction(connection, input)?;
            if stored.category_explanation.is_empty()
                || stored.category_explanation.len() > 65_536
                || input.manual_category != (stored.category_source == "manual")
                || match stored.category_source.as_str() {
                    "transfer" => input.kind != "transfer" || input.category_id.is_some(),
                    "manual" => input.kind == "transfer",
                    "rule" => input.kind == "transfer" || input.category_id.is_none(),
                    "uncategorised" => input.kind == "transfer" || input.category_id.is_some(),
                    _ => true,
                }
            {
                return Err(WorkspaceError::InvalidBackup);
            }
            connection.execute(
                "INSERT INTO transactions(id,source_id,account_id,category_id,amount_pence,kind,transaction_date,description,merchant,
                    merchant_normalized,category_source,category_explanation) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![stored.id,input.source_id,input.account_id,input.category_id,input.amount_pence,input.kind,input.transaction_date,
                    input.description,input.merchant,normalize_merchant(input.merchant.as_deref()),stored.category_source,stored.category_explanation]
            ).map_err(|_|WorkspaceError::Storage)?;
        }
        for budget in &snapshot.budgets {
            let exists:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM monthly_budgets WHERE month=?1 AND category_id=?2)",
                params![budget.month,budget.category_id],|row|row.get(0)).map_err(|_|WorkspaceError::Storage)?;
            if exists {
                return Err(WorkspaceError::InvalidBackup);
            }
            budgets::save(connection, budget)?;
        }
        if !matches!(snapshot.comparison_mode.as_str(), "same_day" | "full_month") {
            return Err(WorkspaceError::InvalidBackup);
        }
        connection
            .execute(
                "UPDATE budget_preferences SET comparison_mode=?1 WHERE id=1",
                [&snapshot.comparison_mode],
            )
            .map_err(|_| WorkspaceError::Storage)?;
        for goal in &snapshot.goals {
            let id = goal.id.ok_or(WorkspaceError::InvalidBackup)?;
            valid_id(id)?;
            connection.execute("INSERT INTO savings_goals(id,name,target_pence,progress_pence,target_date,notes) VALUES(?1,?2,?3,?4,?5,?6)",
                params![id,goal.name,goal.target_pence,goal.progress_pence,goal.target_date,goal.notes]).map_err(|_|WorkspaceError::Storage)?;
            savings::save(connection, goal)?;
        }
        Ok(())
    })
}

fn validate_snapshot(snapshot: &Snapshot) -> WorkspaceResult<()> {
    let candidate = Connection::open_in_memory().map_err(|_| WorkspaceError::Storage)?;
    crate::configure_database(&candidate, &crate::random_bytes::<32>()?)?;
    crate::initialize_database(&candidate)?;
    replace(&candidate, snapshot).map_err(|_| WorkspaceError::InvalidBackup)
}

fn backup_passphrase(passphrase: &str) -> WorkspaceResult<()> {
    if !(12..=1024).contains(&passphrase.chars().count()) {
        return Err(WorkspaceError::InvalidBackupPassphrase);
    }
    Ok(())
}

fn encrypt(snapshot: &Snapshot, passphrase: &str) -> WorkspaceResult<Vec<u8>> {
    backup_passphrase(passphrase)?;
    let plaintext =
        Zeroizing::new(serde_json::to_vec(snapshot).map_err(|_| WorkspaceError::Storage)?);
    if plaintext.len() > MAX_PLAINTEXT {
        return Err(WorkspaceError::DataLimit);
    }
    let salt = crate::random_bytes::<16>()?;
    let nonce = crate::random_bytes::<24>()?;
    let key = crate::passphrase_cipher_key(passphrase, &salt)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| WorkspaceError::Storage)?;
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| WorkspaceError::Storage)?;
    serde_json::to_vec(&EncryptedBackup {
        format: FORMAT.to_owned(),
        version: 1,
        kdf: "argon2id-v1".to_owned(),
        cipher: "xchacha20poly1305".to_owned(),
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ciphertext: hex::encode(ciphertext),
    })
    .map_err(|_| WorkspaceError::Storage)
}

fn parse<T: DeserializeOwned>(bytes: &[u8]) -> WorkspaceResult<T> {
    serde_json::from_slice(bytes).map_err(|_| WorkspaceError::InvalidBackup)
}

fn decrypt(bytes: &[u8], passphrase: &str) -> WorkspaceResult<Snapshot> {
    backup_passphrase(passphrase)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::InvalidBackup);
    }
    let envelope: EncryptedBackup = parse(bytes)?;
    if envelope.format != FORMAT
        || envelope.version != 1
        || envelope.kdf != "argon2id-v1"
        || envelope.cipher != "xchacha20poly1305"
        || envelope.ciphertext.len() > 2 * (MAX_PLAINTEXT + 16)
    {
        return Err(WorkspaceError::InvalidBackup);
    }
    let salt =
        crate::decode_array::<16>(&envelope.salt).map_err(|_| WorkspaceError::InvalidBackup)?;
    let nonce =
        crate::decode_array::<24>(&envelope.nonce).map_err(|_| WorkspaceError::InvalidBackup)?;
    let ciphertext =
        hex::decode(&envelope.ciphertext).map_err(|_| WorkspaceError::InvalidBackup)?;
    let key = crate::passphrase_cipher_key(passphrase, &salt)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| WorkspaceError::Storage)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &ciphertext,
                    aad: AAD,
                },
            )
            .map_err(|_| WorkspaceError::InvalidBackupPassword)?,
    );
    if plaintext.len() > MAX_PLAINTEXT {
        return Err(WorkspaceError::InvalidBackup);
    }
    parse(&plaintext)
}

fn create(
    connection: &Connection,
    directory: &Path,
    passphrase: &str,
) -> WorkspaceResult<SavedFile> {
    let snapshot = capture(connection)?;
    let record_count =
        u32::try_from(snapshot.transactions.len()).map_err(|_| WorkspaceError::DataLimit)?;
    let bytes = encrypt(&snapshot, passphrase)?;
    let path = private_file(directory, "private-backups", "ppbackup", &bytes)?;
    Ok(SavedFile { path, record_count })
}

fn restore(
    connection: &Connection,
    directory: &Path,
    path: &Path,
    passphrase: &str,
    confirmation: &str,
) -> WorkspaceResult<RestoreResult> {
    if confirmation != "RESTORE" {
        return Err(WorkspaceError::DisclosureConfirmation);
    }
    if !path.is_absolute() {
        return Err(WorkspaceError::InvalidBackup);
    }
    let metadata = fs::metadata(path).map_err(|_| WorkspaceError::Storage)?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES as u64 {
        return Err(WorkspaceError::InvalidBackup);
    }
    let file = fs::File::open(path).map_err(|_| WorkspaceError::Storage)?;
    if !file
        .metadata()
        .map_err(|_| WorkspaceError::Storage)?
        .is_file()
    {
        return Err(WorkspaceError::InvalidBackup);
    }
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| WorkspaceError::Storage)?;
    let snapshot = decrypt(&bytes, passphrase)?;
    validate_snapshot(&snapshot)?;
    let safety = create(connection, directory, passphrase)?;
    replace(connection, &snapshot)?;
    Ok(RestoreResult {
        safety_backup_path: safety.path,
        record_count: u32::try_from(snapshot.transactions.len())
            .map_err(|_| WorkspaceError::DataLimit)?,
    })
}

#[tauri::command]
pub(crate) fn create_private_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    passphrase: String,
) -> Result<SavedFile, String> {
    let passphrase = Zeroizing::new(passphrase);
    let directory = crate::app_data_dir(&app).map_err(|error| error.to_string())?;
    with_connection(&state, |connection| {
        create(connection, &directory, &passphrase)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn restore_private_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
    confirmation: String,
) -> Result<RestoreResult, String> {
    let passphrase = Zeroizing::new(passphrase);
    let directory = crate::app_data_dir(&app).map_err(|error| error.to_string())?;
    with_connection(&state, |connection| {
        restore(
            connection,
            &directory,
            &PathBuf::from(path),
            &passphrase,
            &confirmation,
        )
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::super::tests::finance_db;
    use super::*;
    const PASSWORD: &str = "fictional backup passphrase only";

    fn fixture(connection: &Connection) {
        let dining: i64 = connection
            .query_row("SELECT id FROM categories WHERE name='Dining'", [], |row| {
                row.get(0)
            })
            .expect("category");
        create_transaction_from(
            connection,
            &TransactionInput {
                source_id: Some("fictional-source".to_owned()),
                manual_category: true,
                account_id: 1,
                category_id: Some(dining),
                amount_pence: 1234,
                kind: "expense".to_owned(),
                transaction_date: "2024-02-29".to_owned(),
                description: "Fictional café purchase".to_owned(),
                merchant: Some("NORTH*MARKET".to_owned()),
            },
        )
        .expect("transaction");
        budgets::save(
            connection,
            &budgets::BudgetInput {
                month: "2024-02".to_owned(),
                category_id: dining,
                limit_pence: 12_345,
            },
        )
        .expect("budget");
        savings::save(
            connection,
            &savings::Goal {
                id: None,
                name: "Fictional emergency goal".to_owned(),
                target_pence: 100_001,
                progress_pence: 120_002,
                target_date: Some("2028-02-29".to_owned()),
                notes: "Explicit fictional progress".to_owned(),
            },
        )
        .expect("goal");
        connection
            .execute(
                "UPDATE budget_preferences SET comparison_mode='full_month' WHERE id=1",
                [],
            )
            .expect("preference");
    }

    #[test]
    fn encrypted_backup_round_trip_preserves_records_rules_overrides_budgets_goals_and_preferences()
    {
        let connection = finance_db();
        fixture(&connection);
        let directory = tempfile::tempdir().expect("directory");
        let original = capture(&connection).expect("snapshot");
        let saved = create(&connection, directory.path(), PASSWORD).expect("backup");
        let bytes = fs::read(&saved.path).expect("file");
        let text = String::from_utf8(bytes.clone()).expect("encoding");
        assert!(!text.contains("Fictional café"));
        assert!(!text.contains(PASSWORD));
        assert!(!text.contains("wrapped_key"));
        assert_eq!(saved.record_count, 1);
        connection
            .execute("DELETE FROM transactions", [])
            .expect("change");
        connection
            .execute("UPDATE savings_goals SET progress_pence=0", [])
            .expect("change goal");
        let result = restore(
            &connection,
            directory.path(),
            Path::new(&saved.path),
            PASSWORD,
            "RESTORE",
        )
        .expect("restore");
        assert_eq!(result.record_count, 1);
        let mut restored = capture(&connection).expect("restored");
        restored.created_at = original.created_at.clone();
        assert_eq!(
            serde_json::to_value(&restored).expect("json"),
            serde_json::to_value(&original).expect("json")
        );
        let safety = decrypt(
            &fs::read(&result.safety_backup_path).expect("safety file"),
            PASSWORD,
        )
        .expect("safety");
        assert!(safety.transactions.is_empty());
        assert_eq!(safety.goals[0].progress_pence, 0);
        let again = create_transaction_from(&connection, &original.transactions[0].input)
            .expect("repeat source");
        assert_eq!(again, original.transactions[0].id);
        assert_eq!(
            capture(&connection).expect("persisted").transactions[0].category_source,
            "manual"
        );
    }

    #[test]
    fn corrupt_wrong_password_and_incompatible_backups_leave_existing_data_untouched() {
        let connection = finance_db();
        fixture(&connection);
        let original = capture(&connection).expect("snapshot");
        let bytes = encrypt(&original, PASSWORD).expect("encrypted");
        assert!(matches!(
            decrypt(&bytes, "different fictional passphrase"),
            Err(WorkspaceError::InvalidBackupPassword)
        ));
        let mut envelope: EncryptedBackup = parse(&bytes).expect("envelope");
        let replacement = if envelope.ciphertext.starts_with("00") {
            "ff"
        } else {
            "00"
        };
        envelope.ciphertext.replace_range(0..2, replacement);
        assert!(decrypt(&serde_json::to_vec(&envelope).expect("json"), PASSWORD).is_err());
        envelope.version = 99;
        assert!(matches!(
            decrypt(&serde_json::to_vec(&envelope).expect("json"), PASSWORD),
            Err(WorkspaceError::InvalidBackup)
        ));
        let directory = tempfile::tempdir().expect("directory");
        for invalid in [
            Snapshot {
                schema_version: 99,
                ..capture(&connection).expect("capture")
            },
            Snapshot {
                currency: "USD".to_owned(),
                ..capture(&connection).expect("capture")
            },
        ] {
            let file = private_file(
                directory.path(),
                "private-backups",
                "ppbackup",
                &encrypt(&invalid, PASSWORD).expect("encrypt"),
            )
            .expect("file");
            assert!(restore(
                &connection,
                directory.path(),
                Path::new(&file),
                PASSWORD,
                "RESTORE"
            )
            .is_err());
        }
        let mut invalid = capture(&connection).expect("capture");
        invalid.transactions[0].input.amount_pence = -1;
        let file = private_file(
            directory.path(),
            "private-backups",
            "ppbackup",
            &encrypt(&invalid, PASSWORD).expect("encrypt"),
        )
        .expect("file");
        assert!(restore(
            &connection,
            directory.path(),
            Path::new(&file),
            PASSWORD,
            "RESTORE"
        )
        .is_err());
        let current = capture(&connection).expect("unchanged");
        assert_eq!(
            current.transactions[0].input.amount_pence,
            original.transactions[0].input.amount_pence
        );
        assert_eq!(
            current.goals[0].progress_pence,
            original.goals[0].progress_pence
        );
    }

    #[test]
    fn a_failed_restore_write_rolls_back_deletes_and_preserves_an_encrypted_safety_copy() {
        let connection = finance_db();
        fixture(&connection);
        let directory = tempfile::tempdir().expect("directory");
        let saved = create(&connection, directory.path(), PASSWORD).expect("backup");
        connection.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON savings_goals BEGIN SELECT RAISE(ABORT,'fictional failure'); END;").expect("fault injection");
        assert!(restore(
            &connection,
            directory.path(),
            Path::new(&saved.path),
            PASSWORD,
            "RESTORE"
        )
        .is_err());
        assert_eq!(
            capture(&connection).expect("unchanged").transactions.len(),
            1
        );
        assert_eq!(
            savings::list(&connection).expect("goal")[0].progress_pence,
            120_002
        );
        assert_eq!(
            fs::read_dir(directory.path().join("private-backups"))
                .expect("files")
                .count(),
            2
        );
        assert!(matches!(
            restore(
                &connection,
                directory.path(),
                Path::new(&saved.path),
                PASSWORD,
                ""
            ),
            Err(WorkspaceError::DisclosureConfirmation)
        ));
    }

    #[test]
    fn snapshot_has_no_workspace_secrets_and_invalid_references_are_rejected_before_replace() {
        let connection = finance_db();
        fixture(&connection);
        connection.execute_batch("CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO app_metadata VALUES('fictional-private-key','fictional secret marker not for backup');").expect("private metadata fixture");
        let mut snapshot = capture(&connection).expect("snapshot");
        let json = serde_json::to_value(&snapshot).expect("json");
        assert!(json.get("appMetadata").is_none());
        assert!(json.get("keys").is_none());
        assert!(json.get("recovery").is_none());
        assert!(!json.to_string().contains("fictional secret marker"));
        snapshot.transactions[0].input.account_id = 999;
        assert!(validate_snapshot(&snapshot).is_err());
        assert!(backup_passphrase("short").is_err());
        assert!(backup_passphrase(&"x".repeat(1025)).is_err());
        assert!(decrypt(b"not a backup", PASSWORD).is_err());
    }

    #[test]
    fn portable_restore_persists_under_the_destination_database_key_without_replacing_credentials()
    {
        let source = finance_db();
        fixture(&source);
        let source_dir = tempfile::tempdir().expect("source directory");
        let saved = create(&source, source_dir.path(), PASSWORD).expect("portable backup");
        let destination = tempfile::tempdir().expect("destination directory");
        let database_path = crate::database_file(destination.path());
        let destination_key = crate::random_bytes::<32>().expect("new device key");
        let connection = Connection::open(&database_path).expect("encrypted db");
        crate::configure_database(&connection, &destination_key).expect("cipher");
        crate::initialize_database(&connection).expect("schema");
        let key_path = crate::key_file(destination.path());
        fs::write(&key_path, b"fictional credential envelope marker").expect("marker");
        restore(
            &connection,
            destination.path(),
            Path::new(&saved.path),
            PASSWORD,
            "RESTORE",
        )
        .expect("cross-device restore");
        assert_eq!(
            fs::read(&key_path).expect("unchanged keys"),
            b"fictional credential envelope marker"
        );
        drop(connection);
        assert!(!fs::read(&database_path)
            .expect("db file")
            .starts_with(b"SQLite format 3"));
        let reopened = Connection::open(database_path).expect("reopen");
        crate::configure_database(&reopened, &destination_key).expect("original destination key");
        crate::initialize_database(&reopened).expect("schema");
        assert_eq!(
            capture(&reopened).expect("persisted").transactions[0]
                .input
                .amount_pence,
            1234
        );
        assert_eq!(
            savings::list(&reopened).expect("persisted goal")[0].progress_pence,
            120_002
        );
    }

    #[test]
    fn duplicate_budgets_and_invalid_provenance_are_not_silently_accepted() {
        let connection = finance_db();
        fixture(&connection);
        let mut snapshot = capture(&connection).expect("snapshot");
        snapshot.budgets.push(snapshot.budgets[0].clone());
        assert!(validate_snapshot(&snapshot).is_err());
        let mut snapshot = capture(&connection).expect("snapshot");
        snapshot.transactions[0].category_source = "rule".to_owned();
        assert!(validate_snapshot(&snapshot).is_err());
        let directory = tempfile::tempdir().expect("directory");
        assert!(matches!(
            restore(
                &connection,
                directory.path(),
                directory.path(),
                PASSWORD,
                "RESTORE"
            ),
            Err(WorkspaceError::InvalidBackup)
        ));
    }

    #[test]
    fn commit_failure_rolls_back_restore_on_the_live_connection() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("fictional.db");
        let connection = Connection::open(&path).expect("writer");
        connection
            .busy_timeout(std::time::Duration::ZERO)
            .expect("no busy wait");
        crate::initialize_database(&connection).expect("schema");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        fixture(&connection);
        let saved = create(&connection, directory.path(), PASSWORD).expect("backup");
        connection
            .execute("UPDATE savings_goals SET progress_pence=700", [])
            .expect("current progress");
        let reader = Connection::open(&path).expect("reader");
        reader
            .execute_batch("BEGIN; SELECT count(*) FROM savings_goals;")
            .expect("hold read lock");
        assert!(matches!(
            restore(
                &connection,
                directory.path(),
                Path::new(&saved.path),
                PASSWORD,
                "RESTORE"
            ),
            Err(WorkspaceError::Storage)
        ));
        assert!(
            connection.is_autocommit(),
            "a failed commit must not leave a pending replacement"
        );
        assert_eq!(
            savings::list(&connection).expect("live unchanged")[0].progress_pence,
            700
        );
        reader.execute_batch("ROLLBACK").expect("release reader");
        drop(connection);
        let reopened = Connection::open(path).expect("reopen");
        assert_eq!(
            savings::list(&reopened).expect("persisted unchanged")[0].progress_pence,
            700
        );
    }
}
