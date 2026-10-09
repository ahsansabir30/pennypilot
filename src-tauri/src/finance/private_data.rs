use super::*;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

pub(crate) mod backup;

const MAX_RECORDS: usize = 100_000;
const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportScope {
    from: String,
    to: String,
    account_id: Option<i64>,
    category_id: Option<i64>,
    kind: Option<String>,
    search: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedFile {
    path: String,
    record_count: u32,
}

fn private_file(
    directory: &Path,
    folder: &str,
    extension: &str,
    bytes: &[u8],
) -> WorkspaceResult<String> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(WorkspaceError::DataLimit);
    }
    let destination = directory.join(folder);
    if destination.is_symlink() {
        return Err(WorkspaceError::Storage);
    }
    fs::create_dir_all(&destination).map_err(|_| WorkspaceError::Storage)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))
            .map_err(|_| WorkspaceError::Storage)?;
    }
    let filename = format!(
        "pennypilot-{}.{}",
        hex::encode(crate::random_bytes::<16>()?),
        extension
    );
    let path = destination.join(filename);
    let mut temporary =
        tempfile::NamedTempFile::new_in(&destination).map_err(|_| WorkspaceError::Storage)?;
    temporary
        .write_all(bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| WorkspaceError::Storage)?;
    temporary
        .persist_noclobber(&path)
        .map_err(|_| WorkspaceError::Storage)?;
    #[cfg(unix)]
    fs::File::open(&destination)
        .and_then(|file| file.sync_all())
        .map_err(|_| WorkspaceError::Storage)?;
    path.to_str()
        .map(str::to_owned)
        .ok_or(WorkspaceError::Storage)
}

fn csv_cell(value: &str) -> String {
    let trimmed =
        value.trim_start_matches(|c: char| c.is_whitespace() || c.is_control() || c == '\u{feff}');
    let dangerous = trimmed.starts_with(['=', '+', '-', '@', '＝', '＋', '－', '＠'])
        || value.starts_with(['\t', '\r', '\n']);
    format!(
        "\"{}{}\"",
        if dangerous { "'" } else { "" },
        value.replace('"', "\"\"")
    )
}

fn transaction_csv(connection: &Connection, scope: &ExportScope) -> WorkspaceResult<(String, u32)> {
    validate_iso_date(&scope.from)?;
    validate_iso_date(&scope.to)?;
    if scope.from > scope.to
        || scope.search.chars().count() > 100
        || scope
            .kind
            .as_deref()
            .is_some_and(|kind| !matches!(kind, "expense" | "refund" | "transfer" | "income"))
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    for (id, table) in [
        (scope.account_id, "accounts"),
        (scope.category_id, "categories"),
    ] {
        if let Some(id) = id {
            let exists: bool = connection
                .query_row(
                    &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
                    [id],
                    |row| row.get(0),
                )
                .map_err(|_| WorkspaceError::Storage)?;
            if !exists {
                return Err(WorkspaceError::InvalidFinancialInput);
            }
        }
    }
    let mut statement=connection.prepare(
        "SELECT t.id,t.transaction_date,a.name,t.kind,t.amount_pence,COALESCE(c.name,'Uncategorised'),
                COALESCE(t.merchant,''),COALESCE(t.merchant_normalized,''),t.description,t.category_source
         FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.transaction_date>=?1 AND t.transaction_date<=?2
           AND (?3 IS NULL OR t.account_id=?3) AND (?4 IS NULL OR t.category_id=?4)
           AND (?5 IS NULL OR t.kind=?5)
           AND (?6='' OR (t.description||' '||COALESCE(t.merchant,'')||' '||COALESCE(t.merchant_normalized,''))
               LIKE ?6 ESCAPE '\\' COLLATE NOCASE)
         ORDER BY t.transaction_date,t.id LIMIT 100001"
    ).map_err(|_|WorkspaceError::Storage)?;
    let mut rows = statement
        .query(params![
            scope.from,
            scope.to,
            scope.account_id,
            scope.category_id,
            scope.kind,
            search_pattern(&scope.search)
        ])
        .map_err(|_| WorkspaceError::Storage)?;
    let mut csv=String::from("\u{feff}transaction_id,source_date,account_name,kind,amount_gbp,amount_pence,currency,category,merchant,merchant_normalized,description,category_source\r\n");
    let mut count = 0_u32;
    while let Some(row) = rows.next().map_err(|_| WorkspaceError::Storage)? {
        count += 1;
        if count > MAX_RECORDS as u32 {
            return Err(WorkspaceError::DataLimit);
        }
        let pence: i64 = row.get(4).map_err(|_| WorkspaceError::Storage)?;
        let mut cells = vec![row
            .get::<_, i64>(0)
            .map_err(|_| WorkspaceError::Storage)?
            .to_string()];
        for column in [1, 2, 3] {
            cells.push(
                row.get::<_, String>(column)
                    .map_err(|_| WorkspaceError::Storage)?,
            );
        }
        cells.push(format!("{}.{:02}", pence / 100, pence % 100));
        cells.push(pence.to_string());
        cells.push("GBP".to_owned());
        for column in [5, 6, 7, 8, 9] {
            cells.push(
                row.get::<_, String>(column)
                    .map_err(|_| WorkspaceError::Storage)?,
            );
        }
        csv.push_str(
            &cells
                .iter()
                .map(|cell| csv_cell(cell))
                .collect::<Vec<_>>()
                .join(","),
        );
        csv.push_str("\r\n");
        if csv.len() > MAX_FILE_BYTES {
            return Err(WorkspaceError::DataLimit);
        }
    }
    Ok((csv, count))
}

#[tauri::command]
pub(crate) fn export_private_transactions(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: ExportScope,
    confirmed: bool,
) -> Result<SavedFile, String> {
    if !confirmed {
        return Err(WorkspaceError::DisclosureConfirmation.to_string());
    }
    let directory = crate::app_data_dir(&app).map_err(|error| error.to_string())?;
    with_connection(&state, |connection| {
        let (csv, record_count) = transaction_csv(connection, &scope)?;
        let path = private_file(&directory, "private-exports", "csv", csv.as_bytes())?;
        Ok(SavedFile { path, record_count })
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn private_data_locations(app: AppHandle) -> Result<Vec<String>, String> {
    let directory = crate::app_data_dir(&app).map_err(|error| error.to_string())?;
    ["private-exports", "private-backups"]
        .into_iter()
        .map(|folder| {
            directory
                .join(folder)
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| WorkspaceError::Storage.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::tests::finance_db;
    use super::*;

    #[test]
    fn csv_quotes_and_neutralises_formula_cells_including_whitespace_and_unicode() {
        for value in [
            "=1+1",
            " +1",
            "-1",
            "@SUM(A1)",
            "\t=1",
            "\r@x",
            "\n-1",
            "\u{feff}=1",
            "  ＝1",
        ] {
            assert!(csv_cell(value).starts_with("\"'"), "unsafe cell: {value:?}");
        }
        assert_eq!(
            csv_cell("Cafe \"Fictional\", £"),
            "\"Cafe \"\"Fictional\"\", £\""
        );
        assert_eq!(csv_cell("Fictional\nnote"), "\"Fictional\nnote\"");
    }

    #[test]
    fn export_is_scoped_and_has_explicit_formats_without_keys_or_extra_records() {
        let connection = finance_db();
        let category: i64 = connection
            .query_row("SELECT id FROM categories WHERE name='Dining'", [], |row| {
                row.get(0)
            })
            .expect("category");
        for (date, description, kind) in [
            ("2024-02-29", "=HYPERLINK(\"fictional\")", "expense"),
            ("2024-03-01", "Out of scope", "expense"),
            ("2024-02-28", "Fictional transfer", "transfer"),
        ] {
            create_transaction_from(
                &connection,
                &TransactionInput {
                    source_id: Some(description.to_owned()),
                    manual_category: true,
                    account_id: 1,
                    category_id: if kind == "transfer" {
                        None
                    } else {
                        Some(category)
                    },
                    amount_pence: 1234,
                    kind: kind.to_owned(),
                    transaction_date: date.to_owned(),
                    description: description.to_owned(),
                    merchant: Some("Fictional Café".to_owned()),
                },
            )
            .expect("record");
        }
        let scope = ExportScope {
            from: "2024-02-01".to_owned(),
            to: "2024-02-29".to_owned(),
            account_id: Some(1),
            category_id: Some(category),
            kind: Some("expense".to_owned()),
            search: "HYPERLINK".to_owned(),
        };
        let (csv, count) = transaction_csv(&connection, &scope).expect("export");
        assert_eq!(count, 1);
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("\"12.34\",\"1234\",\"GBP\""));
        assert!(csv.contains("\"2024-02-29\""));
        assert!(csv.contains("\"'=HYPERLINK(\"\"fictional\"\")\""));
        assert!(!csv.contains("Out of scope"));
        assert!(!csv.contains("Fictional transfer"));
        assert!(!csv.contains("source_id"));
        assert!(!csv.contains("wrapped_key"));
        assert!(!csv.contains("notes"));
        assert!(csv.ends_with("\r\n"));
        let (empty, count) = transaction_csv(
            &connection,
            &ExportScope {
                search: "100%_literal".to_owned(),
                ..scope
            },
        )
        .expect("literal search");
        assert_eq!(count, 0);
        assert_eq!(empty.lines().count(), 1);
    }

    #[test]
    fn files_are_private_unique_and_invalid_scopes_are_rejected() {
        let directory = tempfile::tempdir().expect("directory");
        let first =
            private_file(directory.path(), "private-exports", "csv", b"fictional").expect("file");
        let second = private_file(
            directory.path(),
            "private-exports",
            "csv",
            b"other fictional",
        )
        .expect("file");
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).expect("read"), b"fictional");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first)
                    .expect("permissions")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let connection = finance_db();
        for (from, to) in [("2023-02-29", "2023-03-01"), ("2024-03-01", "2024-02-01")] {
            assert!(transaction_csv(
                &connection,
                &ExportScope {
                    from: from.to_owned(),
                    to: to.to_owned(),
                    account_id: None,
                    category_id: None,
                    kind: None,
                    search: String::new()
                }
            )
            .is_err());
        }
    }

    #[test]
    fn oversized_export_is_rejected_instead_of_returning_a_truncated_csv() {
        let connection = finance_db();
        connection
            .execute_batch(
                "WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<100001)
             INSERT INTO transactions(account_id,amount_pence,kind,transaction_date,description)
             SELECT 1,1,'expense','2026-10-09','Fictional bounded export fixture' FROM rows;",
            )
            .expect("fictional large fixture");
        assert!(matches!(
            transaction_csv(
                &connection,
                &ExportScope {
                    from: "2026-10-01".to_owned(),
                    to: "2026-10-31".to_owned(),
                    account_id: None,
                    category_id: None,
                    kind: None,
                    search: String::new()
                }
            ),
            Err(WorkspaceError::DataLimit)
        ));
    }
}
