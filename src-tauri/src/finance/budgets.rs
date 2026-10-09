use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetInput {
    pub(super) month: String,
    pub(super) category_id: i64,
    pub(super) limit_pence: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BudgetRow {
    category_id: i64,
    category_name: String,
    limit_pence: i64,
    #[serde(serialize_with = "serialize_pence")]
    used_pence: i64,
    #[serde(serialize_with = "serialize_optional_pence")]
    previous_used_pence: Option<i64>,
    record_count: i64,
    previous_record_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetData {
    month: String,
    as_of: String,
    period_end: Option<String>,
    previous_month: Option<String>,
    previous_end: Option<String>,
    comparison_mode: String,
    rows: Vec<BudgetRow>,
}

fn serialize_optional_pence<S: serde::Serializer>(
    pence: &Option<i64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match pence {
        Some(value) => serializer.serialize_some(&value.to_string()),
        None => serializer.serialize_none(),
    }
}

pub(super) fn migrate(connection: &Connection) -> WorkspaceResult<()> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
         CREATE TABLE IF NOT EXISTS monthly_budgets(
             month TEXT NOT NULL CHECK(length(month)=7),
             category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
             limit_pence INTEGER NOT NULL CHECK(limit_pence BETWEEN 1 AND 99999999999),
             PRIMARY KEY(month, category_id));
         CREATE TABLE IF NOT EXISTS budget_preferences(
             id INTEGER PRIMARY KEY CHECK(id=1),
             comparison_mode TEXT NOT NULL CHECK(comparison_mode IN ('same_day','full_month')));
         INSERT OR IGNORE INTO budget_preferences VALUES(1,'same_day');
         INSERT OR IGNORE INTO schema_migrations(version) VALUES(4);
         COMMIT;",
        )
        .map_err(|_| WorkspaceError::Storage)
}

fn month_end(month: &str) -> WorkspaceResult<String> {
    validate_month(month)?;
    for day in (28..=31).rev() {
        let date = format!("{month}-{day:02}");
        if validate_iso_date(&date).is_ok() {
            return Ok(date);
        }
    }
    Err(WorkspaceError::InvalidFinancialInput)
}

pub(super) fn save(connection: &Connection, input: &BudgetInput) -> WorkspaceResult<()> {
    validate_month(&input.month)?;
    if !(1..=MAX_AMOUNT_PENCE).contains(&input.limit_pence) {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let eligible: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND category_type='expense')",
            [input.category_id],
            |row| row.get(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if !eligible {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    connection
        .execute(
            "INSERT INTO monthly_budgets(month,category_id,limit_pence) VALUES(?1,?2,?3)
         ON CONFLICT(month,category_id) DO UPDATE SET limit_pence=excluded.limit_pence",
            params![input.month, input.category_id, input.limit_pence],
        )
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(())
}

fn preference(connection: &Connection, mode: &str) -> WorkspaceResult<()> {
    if !matches!(mode, "same_day" | "full_month") {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    connection
        .execute(
            "UPDATE budget_preferences SET comparison_mode=?1 WHERE id=1",
            [mode],
        )
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(())
}

fn usage(
    connection: &Connection,
    category: i64,
    month: &str,
    end: Option<&str>,
) -> WorkspaceResult<(i64, i64)> {
    connection.query_row(
        "SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount_pence ELSE amount_pence END),0),count(*)
         FROM transactions WHERE category_id=?1 AND kind IN ('expense','refund')
         AND transaction_date >= ?2 AND transaction_date <= ?3",
        params![category, format!("{month}-01"), end], |row| Ok((row.get(0)?,row.get(1)?))
    ).map_err(|_| WorkspaceError::Storage)
}

fn data(connection: &Connection, month: &str, as_of: &str) -> WorkspaceResult<BudgetData> {
    validate_iso_date(as_of)?;
    let last = month_end(month)?;
    let previous_month = month_offset(month, -1)?;
    let mode: String = connection
        .query_row(
            "SELECT comparison_mode FROM budget_preferences WHERE id=1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let period_end = (as_of >= format!("{month}-01").as_str()).then(|| as_of.min(&last).to_owned());
    let previous_end = match (&period_end, &previous_month) {
        (Some(end), Some(previous_month)) if mode == "same_day" && end != &last => {
            let prior_last = month_end(previous_month)?;
            Some(format!("{}-{}", previous_month, &end[8..10]).min(prior_last))
        }
        (Some(_), Some(previous_month)) => Some(month_end(previous_month)?),
        _ => None,
    };
    let mut statement = connection
        .prepare(
            "SELECT b.category_id,c.name,b.limit_pence FROM monthly_budgets b
         JOIN categories c ON c.id=b.category_id WHERE b.month=?1 ORDER BY c.name,c.id",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let budgets = statement
        .query_map([month], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    let mut rows = Vec::with_capacity(budgets.len());
    for (category_id, category_name, limit_pence) in budgets {
        let (used_pence, record_count) =
            usage(connection, category_id, month, period_end.as_deref())?;
        let (prior, count) = match &previous_month {
            Some(previous_month) => usage(
                connection,
                category_id,
                previous_month,
                previous_end.as_deref(),
            )?,
            None => (0, 0),
        };
        rows.push(BudgetRow {
            category_id,
            category_name,
            limit_pence,
            used_pence,
            record_count,
            previous_used_pence: (count > 0).then_some(prior),
            previous_record_count: count,
        });
    }
    Ok(BudgetData {
        month: month.to_owned(),
        as_of: as_of.to_owned(),
        period_end,
        previous_month,
        previous_end,
        comparison_mode: mode,
        rows,
    })
}

#[tauri::command]
pub(crate) fn list_budgets(
    state: State<'_, AppState>,
    month: String,
    as_of: String,
) -> Result<BudgetData, String> {
    with_connection(&state, |connection| data(connection, &month, &as_of))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_budget(state: State<'_, AppState>, input: BudgetInput) -> Result<(), String> {
    with_connection(&state, |connection| save(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_budget(
    state: State<'_, AppState>,
    month: String,
    category_id: i64,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        validate_month(&month)?;
        let count = connection
            .execute(
                "DELETE FROM monthly_budgets WHERE month=?1 AND category_id=?2",
                params![month, category_id],
            )
            .map_err(|_| WorkspaceError::Storage)?;
        if count == 0 {
            return Err(WorkspaceError::RecordNotFound);
        }
        Ok(())
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_budget_preferences(
    state: State<'_, AppState>,
    comparison_mode: String,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        preference(connection, &comparison_mode)
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::tests::finance_db;
    use super::*;

    fn setup(connection: &Connection, month: &str) -> i64 {
        let id = connection
            .query_row(
                "SELECT id FROM categories WHERE name='Groceries'",
                [],
                |row| row.get(0),
            )
            .expect("category");
        save(
            connection,
            &BudgetInput {
                month: month.to_owned(),
                category_id: id,
                limit_pence: 10_000,
            },
        )
        .expect("budget");
        id
    }

    fn record(connection: &Connection, category: i64, date: &str, kind: &str, amount: i64) -> i64 {
        create_transaction_from(
            connection,
            &TransactionInput {
                source_id: None,
                manual_category: true,
                account_id: 1,
                category_id: if kind == "transfer" {
                    None
                } else {
                    Some(category)
                },
                amount_pence: amount,
                kind: kind.to_owned(),
                transaction_date: date.to_owned(),
                description: "Fictional budget fixture".to_owned(),
                merchant: None,
            },
        )
        .expect("record")
    }

    #[test]
    fn earliest_month_has_no_previous_period_in_either_comparison_mode() {
        let connection = finance_db();
        let id = setup(&connection, "1000-01");
        record(&connection, id, "1000-01-01", "expense", 123);
        for mode in ["same_day", "full_month"] {
            preference(&connection, mode).expect("comparison mode");
            for as_of in ["1000-01-15", "1000-02-01", "9999-12-31"] {
                let result = data(&connection, "1000-01", as_of).expect("earliest budget");
                assert!(result.previous_month.is_none());
                assert!(result.previous_end.is_none());
                assert_eq!(result.rows[0].used_pence, 123);
                assert_eq!(result.rows[0].previous_used_pence, None);
                assert_eq!(result.rows[0].previous_record_count, 0);
            }
            setup(&connection, "1000-02");
            let result = data(&connection, "1000-02", "1000-02-15").expect("next month");
            assert_eq!(result.previous_month.as_deref(), Some("1000-01"));
            assert_eq!(result.rows[0].previous_used_pence, Some(123));
        }
        setup(&connection, "9999-12");
        assert!(data(&connection, "9999-12", "9999-12-31").is_ok());
    }

    #[test]
    fn budget_usage_and_comparison_serialize_exact_large_totals() {
        let connection = finance_db();
        super::super::tests::large_aggregate_fixture(&connection);
        setup(&connection, "2024-02");
        setup(&connection, "2024-03");
        let total = "9007199999909929";
        let result =
            serde_json::to_value(data(&connection, "2024-02", "2024-03-31").expect("usage"))
                .expect("IPC");
        assert_eq!(result["rows"][0]["usedPence"], total);
        assert!(result["rows"][0]["previousUsedPence"].is_null());
        let result =
            serde_json::to_value(data(&connection, "2024-03", "2024-03-31").expect("comparison"))
                .expect("IPC");
        assert_eq!(result["rows"][0]["previousUsedPence"], total);
        connection
            .execute("UPDATE transactions SET kind='refund'", [])
            .expect("refund fixture");
        let result =
            serde_json::to_value(data(&connection, "2024-02", "2024-03-31").expect("refund usage"))
                .expect("IPC");
        assert_eq!(result["rows"][0]["usedPence"], "-9007199999909929");
    }

    #[test]
    fn leap_year_and_calendar_boundaries_use_source_dates() {
        let connection = finance_db();
        let id = setup(&connection, "2024-02");
        record(&connection, id, "2024-01-31", "expense", 99_999);
        record(&connection, id, "2024-02-01", "expense", 1_001);
        record(&connection, id, "2024-02-29", "expense", 2_002);
        record(&connection, id, "2024-03-01", "expense", 99_999);
        let result = data(&connection, "2024-02", "2024-03-10").expect("data");
        assert_eq!(result.period_end.as_deref(), Some("2024-02-29"));
        assert_eq!(result.rows[0].used_pence, 3_003);
        assert_eq!(month_end("2023-02").expect("non leap"), "2023-02-28");
        assert_eq!(month_end("2000-02").expect("century leap"), "2000-02-29");
        assert_eq!(
            month_end("2100-02").expect("century non leap"),
            "2100-02-28"
        );
        assert!(data(&connection, "2024-02", "2023-02-29").is_err());
        assert_eq!(
            data(&connection, "2024-01", "2024-02-01")
                .expect("year boundary")
                .previous_month,
            Some("2023-12".to_owned())
        );
    }

    #[test]
    fn refunds_transfers_and_manual_edits_recalculate_without_changing_budget() {
        let connection = finance_db();
        let id = setup(&connection, "2026-01");
        let transaction = record(&connection, id, "2026-01-31", "expense", 12_000);
        record(&connection, id, "2026-01-15", "refund", 1_000);
        record(&connection, id, "2026-01-15", "transfer", 90_000);
        let result = data(&connection, "2026-01", "2026-02-01").expect("data");
        assert_eq!(result.rows[0].used_pence, 11_000);
        assert_eq!(result.rows[0].record_count, 2);
        connection
            .execute(
                "UPDATE categories SET name='Fictional Food' WHERE id=?1",
                [id],
            )
            .expect("rename");
        update_category_from(&connection, transaction, None).expect("manual override");
        let result = data(&connection, "2026-01", "2026-02-01").expect("updated");
        assert_eq!(result.rows[0].category_name, "Fictional Food");
        assert_eq!(result.rows[0].used_pence, -1_000);
        assert_eq!(result.rows[0].limit_pence, 10_000);
    }

    #[test]
    fn partial_month_comparisons_do_not_invent_missing_history() {
        let connection = finance_db();
        let id = setup(&connection, "2024-03");
        record(&connection, id, "2024-03-09", "expense", 1_500);
        record(&connection, id, "2024-03-10", "expense", 9_000);
        record(&connection, id, "2024-02-09", "expense", 800);
        record(&connection, id, "2024-02-29", "expense", 700);
        let result = data(&connection, "2024-03", "2024-03-09").expect("partial");
        assert_eq!(result.previous_end.as_deref(), Some("2024-02-09"));
        assert_eq!(result.rows[0].used_pence, 1_500);
        assert_eq!(result.rows[0].previous_used_pence, Some(800));
        preference(&connection, "full_month").expect("preference");
        assert_eq!(
            data(&connection, "2024-03", "2024-03-09")
                .expect("full comparison")
                .rows[0]
                .previous_used_pence,
            Some(1_500)
        );
        let future = data(&connection, "2024-03", "2024-01-01").expect("future");
        assert!(future.period_end.is_none());
        assert_eq!(future.rows[0].used_pence, 0);
        assert_eq!(future.rows[0].previous_used_pence, None);
        let empty = data(&connection, "2024-03", "2024-03-01").expect("missing history");
        assert_eq!(empty.rows[0].record_count, 0);
        preference(&connection, "same_day").expect("same day");
        assert_eq!(
            data(&connection, "2024-03", "2024-03-30")
                .expect("clamp")
                .previous_end
                .as_deref(),
            Some("2024-02-29")
        );
    }

    #[test]
    fn limits_and_preferences_survive_reopening_and_validation_is_exact() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("fictional.db");
        let connection = Connection::open(&path).expect("db");
        crate::initialize_database(&connection).expect("schema");
        let id = setup(&connection, "2026-10");
        save(
            &connection,
            &BudgetInput {
                month: "2026-10".to_owned(),
                category_id: id,
                limit_pence: 12_345,
            },
        )
        .expect("edit");
        preference(&connection, "full_month").expect("preference");
        drop(connection);
        let connection = Connection::open(path).expect("reopen");
        crate::initialize_database(&connection).expect("reopen schema");
        let result = data(&connection, "2026-10", "2026-10-09").expect("data");
        assert_eq!(result.rows[0].limit_pence, 12_345);
        assert_eq!(result.comparison_mode, "full_month");
        for amount in [0, -1, MAX_AMOUNT_PENCE + 1] {
            assert!(save(
                &connection,
                &BudgetInput {
                    month: "2026-10".to_owned(),
                    category_id: id,
                    limit_pence: amount
                }
            )
            .is_err());
        }
        let income = connection
            .query_row("SELECT id FROM categories WHERE name='Salary'", [], |row| {
                row.get(0)
            })
            .expect("income");
        assert!(save(
            &connection,
            &BudgetInput {
                month: "2026-10".to_owned(),
                category_id: income,
                limit_pence: 100
            }
        )
        .is_err());
        assert!(preference(&connection, "invalid").is_err());
    }
}
