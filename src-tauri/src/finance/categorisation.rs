use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CategoryRule {
    pub id: Option<i64>,
    pub pattern: String,
    pub match_type: String,
    pub category_id: i64,
    pub priority: i32,
    pub enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CategoryInput {
    pub id: Option<i64>,
    pub name: String,
    pub category_type: String,
    pub color: String,
}

pub(super) struct Decision {
    pub category_id: Option<i64>,
    pub source: &'static str,
    pub explanation: String,
}

impl Decision {
    pub(super) fn manual(category_id: Option<i64>) -> Self {
        Self {
            category_id,
            source: "manual",
            explanation: "Manual choice. Rules cannot overwrite this category.".to_owned(),
        }
    }
}

fn atomic<T>(
    connection: &Connection,
    operation: impl FnOnce() -> WorkspaceResult<T>,
) -> WorkspaceResult<T> {
    connection
        .execute_batch("SAVEPOINT categorisation")
        .map_err(|_| WorkspaceError::Storage)?;
    match operation() {
        Ok(result) => {
            connection
                .execute_batch("RELEASE categorisation")
                .map_err(|_| WorkspaceError::Storage)?;
            Ok(result)
        }
        Err(error) => {
            connection
                .execute_batch("ROLLBACK TO categorisation; RELEASE categorisation")
                .map_err(|_| WorkspaceError::Storage)?;
            Err(error)
        }
    }
}

pub(super) fn migrate(connection: &Connection) -> WorkspaceResult<()> {
    let applied = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 3)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if applied {
        return Ok(());
    }
    atomic(connection, || {
        connection
            .execute_batch(
                "ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'manual'
                 CHECK(category_source IN ('manual', 'rule', 'uncategorised', 'transfer'));
             ALTER TABLE transactions ADD COLUMN category_explanation TEXT NOT NULL
                 DEFAULT 'Existing choice preserved. Rules cannot overwrite this category.';
             ALTER TABLE transactions ADD COLUMN source_id TEXT;
             CREATE UNIQUE INDEX idx_transactions_source ON transactions(account_id, source_id)
                 WHERE source_id IS NOT NULL;
             CREATE TABLE category_rules (
                 id INTEGER PRIMARY KEY,
                 pattern TEXT NOT NULL CHECK(length(pattern) BETWEEN 1 AND 120),
                 match_type TEXT NOT NULL CHECK(match_type IN ('exact', 'contains')),
                 category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
                 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 1000),
                 enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
             );
             UPDATE transactions SET category_source = 'transfer',
                 category_explanation = 'Transfers are excluded from categorisation.'
                 WHERE kind = 'transfer';",
            )
            .map_err(|_| WorkspaceError::Storage)?;
        for (pattern, category) in [
            ("north market", "Groceries"),
            ("grocery store", "Groceries"),
            ("coffee shop", "Dining"),
            ("cafe corner", "Dining"),
            ("streaming service", "Bills"),
            ("electricity bill", "Bills"),
            ("gym membership", "Health"),
            ("salary payment", "Salary"),
        ] {
            connection.execute(
                "INSERT INTO category_rules (pattern, match_type, category_id, priority, enabled)
                 SELECT ?1, 'contains', id, 10, 1 FROM categories WHERE name = ?2",
                params![pattern, category],
            ).map_err(|_| WorkspaceError::Storage)?;
        }
        let mut statement = connection
            .prepare("SELECT id, merchant FROM transactions")
            .map_err(|_| WorkspaceError::Storage)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|_| WorkspaceError::Storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| WorkspaceError::Storage)?;
        for (id, merchant) in rows {
            connection
                .execute(
                    "UPDATE transactions SET merchant_normalized = ?1 WHERE id = ?2",
                    params![normalize_merchant(merchant.as_deref()), id],
                )
                .map_err(|_| WorkspaceError::Storage)?;
        }
        connection
            .execute("INSERT INTO schema_migrations(version) VALUES (3)", [])
            .map_err(|_| WorkspaceError::Storage)?;
        Ok(())
    })
}

fn rules(connection: &Connection) -> WorkspaceResult<Vec<CategoryRule>> {
    Ok(matching_rules(connection)?
        .into_iter()
        .map(|item| item.rule)
        .collect())
}

struct MatchingRule {
    rule: CategoryRule,
    category_name: String,
    category_type: String,
}

fn matching_rules(connection: &Connection) -> WorkspaceResult<Vec<MatchingRule>> {
    let mut statement = connection
        .prepare(
            "SELECT r.id, r.pattern, r.match_type, r.category_id, r.priority, r.enabled,
                    c.name, c.category_type
             FROM category_rules r JOIN categories c ON c.id=r.category_id
             ORDER BY r.priority DESC, r.id ASC",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let rows = statement
        .query_map([], |row| {
            Ok(MatchingRule {
                rule: CategoryRule {
                    id: Some(row.get(0)?),
                    pattern: row.get(1)?,
                    match_type: row.get(2)?,
                    category_id: row.get(3)?,
                    priority: row.get(4)?,
                    enabled: row.get(5)?,
                },
                category_name: row.get(6)?,
                category_type: row.get(7)?,
            })
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(rows)
}

pub(super) fn classify(
    connection: &Connection,
    kind: &str,
    merchant: Option<&str>,
) -> WorkspaceResult<Decision> {
    Ok(classify_with(&matching_rules(connection)?, kind, merchant))
}

fn classify_with(rules: &[MatchingRule], kind: &str, merchant: Option<&str>) -> Decision {
    if kind == "transfer" {
        return Decision {
            category_id: None,
            source: "transfer",
            explanation: "Transfers are excluded from categorisation.".to_owned(),
        };
    }
    let normalized = normalize_merchant(merchant).unwrap_or_default();
    let expected_type = if kind == "income" {
        "income"
    } else {
        "expense"
    };
    let mut matches = Vec::new();
    for item in rules
        .iter()
        .filter(|item| item.rule.enabled && item.category_type == expected_type)
    {
        let rule = &item.rule;
        let matched = if rule.match_type == "exact" {
            normalized == rule.pattern
        } else {
            format!(" {normalized} ").contains(&format!(" {} ", rule.pattern))
        };
        if !matched {
            continue;
        }
        matches.push((rule, &item.category_name));
    }
    if matches.is_empty() {
        return Decision {
            category_id: None,
            source: "uncategorised",
            explanation: "No compatible merchant rule matched. Choose a category or add a rule."
                .to_owned(),
        };
    }
    let (winner, _) = &matches[0];
    let details = matches
        .iter()
        .map(|(rule, name)| {
            format!(
                "\"{}\" -> {} (priority {})",
                rule.pattern, name, rule.priority
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let conflict = matches.iter().any(|(rule, _)| {
        rule.priority == winner.priority && rule.category_id != winner.category_id
    });
    if conflict {
        Decision { category_id: None, source: "uncategorised",
            explanation: format!("Conflict: equal highest priority targets different categories. No category assigned. Matches: {details}.") }
    } else {
        Decision {
            category_id: Some(winner.category_id),
            source: "rule",
            explanation: format!(
                "Highest priority wins; same-category ties agree. Matches: {details}."
            ),
        }
    }
}

fn save_rule(connection: &Connection, input: &CategoryRule) -> WorkspaceResult<i64> {
    let pattern =
        normalize_merchant(Some(&input.pattern)).ok_or(WorkspaceError::InvalidFinancialInput)?;
    if input.pattern.chars().count() > 120
        || pattern.chars().count() > 120
        || !(0..=1000).contains(&input.priority)
        || !matches!(input.match_type.as_str(), "exact" | "contains")
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1)",
            [input.category_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if !exists {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    if let Some(id) = input.id {
        let changed = connection.execute(
            "UPDATE category_rules SET pattern=?1, match_type=?2, category_id=?3, priority=?4, enabled=?5 WHERE id=?6",
            params![pattern, input.match_type, input.category_id, input.priority, input.enabled, id],
        ).map_err(|_| WorkspaceError::Storage)?;
        if changed == 0 {
            return Err(WorkspaceError::RecordNotFound);
        }
        Ok(id)
    } else {
        let count: i64 = connection
            .query_row("SELECT count(*) FROM category_rules", [], |row| row.get(0))
            .map_err(|_| WorkspaceError::Storage)?;
        if count >= 200 {
            return Err(WorkspaceError::RuleLimit);
        }
        connection.execute(
            "INSERT INTO category_rules(pattern, match_type, category_id, priority, enabled) VALUES (?1,?2,?3,?4,?5)",
            params![pattern, input.match_type, input.category_id, input.priority, input.enabled],
        ).map_err(|_| WorkspaceError::Storage)?;
        Ok(connection.last_insert_rowid())
    }
}

fn save_category_from(connection: &Connection, input: &CategoryInput) -> WorkspaceResult<i64> {
    let name = input.name.trim();
    if name.is_empty()
        || name.chars().count() > 60
        || !matches!(input.category_type.as_str(), "income" | "expense")
        || input.color.len() != 7
        || !input.color.starts_with('#')
        || !input.color.as_bytes()[1..]
            .iter()
            .all(u8::is_ascii_hexdigit)
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let duplicate: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM categories WHERE lower(name)=lower(?1) AND category_type=?2 AND (?3 IS NULL OR id != ?3))",
        params![name, input.category_type, input.id], |row| row.get(0),
    ).map_err(|_| WorkspaceError::Storage)?;
    if duplicate {
        return Err(WorkspaceError::CategoryNameExists);
    }
    if let Some(id) = input.id {
        let changed = connection
            .execute(
                "UPDATE categories SET name=?1, color=?2 WHERE id=?3 AND category_type=?4",
                params![name, input.color, id, input.category_type],
            )
            .map_err(|_| WorkspaceError::Storage)?;
        if changed == 0 {
            return Err(WorkspaceError::InvalidFinancialInput);
        }
        Ok(id)
    } else {
        connection
            .execute(
                "INSERT INTO categories(name,category_type,color) VALUES (?1,?2,?3)",
                params![name, input.category_type, input.color],
            )
            .map_err(|_| WorkspaceError::Storage)?;
        Ok(connection.last_insert_rowid())
    }
}

fn reclassify(connection: &Connection, only_id: Option<i64>) -> WorkspaceResult<u32> {
    atomic(connection, || {
        let rules = matching_rules(connection)?;
        let mut statement = connection
            .prepare(
                "SELECT id, kind, merchant FROM transactions
             WHERE (?1 IS NOT NULL AND id = ?1) OR (?1 IS NULL AND category_source != 'manual')",
            )
            .map_err(|_| WorkspaceError::Storage)?;
        let rows = statement
            .query_map([only_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|_| WorkspaceError::Storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| WorkspaceError::Storage)?;
        if only_id.is_some() && rows.is_empty() {
            return Err(WorkspaceError::RecordNotFound);
        }
        for (id, kind, merchant) in &rows {
            let decision = classify_with(&rules, kind, merchant.as_deref());
            connection.execute(
                "UPDATE transactions SET category_id=?1, category_source=?2, category_explanation=?3,
                 merchant_normalized=?4 WHERE id=?5",
                params![decision.category_id, decision.source, decision.explanation,
                    normalize_merchant(merchant.as_deref()), id],
            ).map_err(|_| WorkspaceError::Storage)?;
        }
        u32::try_from(rows.len()).map_err(|_| WorkspaceError::Storage)
    })
}

fn delete_rule(connection: &Connection, rule_id: i64) -> WorkspaceResult<()> {
    let changed = connection
        .execute("DELETE FROM category_rules WHERE id=?1", [rule_id])
        .map_err(|_| WorkspaceError::Storage)?;
    if changed == 0 {
        return Err(WorkspaceError::RecordNotFound);
    }
    Ok(())
}

fn delete_category_from(connection: &Connection, category_id: i64) -> WorkspaceResult<()> {
    let used: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM transactions WHERE category_id=?1)
             OR EXISTS(SELECT 1 FROM category_rules WHERE category_id=?1)",
            [category_id],
            |row| row.get(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if used {
        return Err(WorkspaceError::CategoryInUse);
    }
    let changed = connection
        .execute("DELETE FROM categories WHERE id=?1", [category_id])
        .map_err(|_| WorkspaceError::Storage)?;
    if changed == 0 {
        return Err(WorkspaceError::RecordNotFound);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_category_rules(state: State<'_, AppState>) -> Result<Vec<CategoryRule>, String> {
    with_connection(&state, rules).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_category_rule(
    state: State<'_, AppState>,
    input: CategoryRule,
) -> Result<i64, String> {
    with_connection(&state, |connection| save_rule(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_category_rule(state: State<'_, AppState>, rule_id: i64) -> Result<(), String> {
    with_connection(&state, |connection| delete_rule(connection, rule_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_category(
    state: State<'_, AppState>,
    input: CategoryInput,
) -> Result<i64, String> {
    with_connection(&state, |connection| save_category_from(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_category(state: State<'_, AppState>, category_id: i64) -> Result<(), String> {
    with_connection(&state, |connection| {
        delete_category_from(connection, category_id)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reclassify_transactions(state: State<'_, AppState>) -> Result<u32, String> {
    with_connection(&state, |connection| reclassify(connection, None))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reset_transaction_category(
    state: State<'_, AppState>,
    transaction_id: i64,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        reclassify(connection, Some(transaction_id)).map(|_| ())
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::tests::finance_db;
    use super::*;

    fn category_id(connection: &Connection, name: &str) -> i64 {
        connection
            .query_row("SELECT id FROM categories WHERE name=?1", [name], |row| {
                row.get(0)
            })
            .expect("fixture category")
    }

    fn input(connection: &Connection, merchant: &str, kind: &str) -> TransactionInput {
        TransactionInput {
            source_id: None,
            manual_category: false,
            account_id: connection
                .query_row("SELECT id FROM accounts LIMIT 1", [], |row| row.get(0))
                .expect("account"),
            category_id: None,
            amount_pence: 2_000,
            kind: kind.to_owned(),
            transaction_date: "2026-10-08".to_owned(),
            description: "Fictional fixture".to_owned(),
            merchant: Some(merchant.to_owned()),
        }
    }

    fn rule(connection: &Connection, pattern: &str, category: &str, priority: i32) -> CategoryRule {
        CategoryRule {
            id: None,
            pattern: pattern.to_owned(),
            match_type: "contains".to_owned(),
            category_id: category_id(connection, category),
            priority,
            enabled: true,
        }
    }

    #[test]
    fn normalisation_and_default_rules_handle_variations_without_guessing() {
        let connection = finance_db();
        let groceries = category_id(&connection, "Groceries");
        for merchant in [
            " North MARKET ",
            "NORTH**MARKET",
            "north---market 0042",
            "NORTH\tMARKET",
        ] {
            let decision = classify(&connection, "expense", Some(merchant)).expect("classify");
            assert_eq!(decision.category_id, Some(groceries));
            assert_eq!(decision.source, "rule");
            let normalized = normalize_merchant(Some(merchant)).expect("normalized");
            assert_eq!(normalize_merchant(Some(&normalized)), Some(normalized));
        }
        assert_eq!(
            classify(&connection, "expense", Some("North Marketplace"))
                .expect("whole phrase")
                .category_id,
            None
        );
        assert_eq!(
            classify(&connection, "income", Some("North Market"))
                .expect("type incompatible")
                .category_id,
            None
        );
        assert_eq!(
            classify(&connection, "refund", Some("North Market"))
                .expect("refund")
                .category_id,
            Some(groceries)
        );
        assert_eq!(
            classify(&connection, "transfer", Some("North Market"))
                .expect("transfer")
                .source,
            "transfer"
        );
        assert_eq!(
            classify(&connection, "expense", None)
                .expect("no merchant")
                .category_id,
            None
        );
        assert_eq!(normalize_merchant(Some("***")), None);
        assert_eq!(
            normalize_merchant(Some("  Café*Corner  ")),
            Some("café corner".to_owned())
        );
    }

    #[test]
    fn overlap_explains_priority_and_ambiguous_top_matches() {
        let connection = finance_db();
        let dining = rule(&connection, "market", "Dining", 30);
        let dining_id = save_rule(&connection, &dining).expect("save rule");
        let winner = classify(&connection, "expense", Some("North Market")).expect("classify");
        assert_eq!(winner.category_id, Some(dining.category_id));
        assert!(winner.explanation.contains("priority 30"));
        assert!(winner.explanation.contains("priority 10"));
        save_rule(&connection, &rule(&connection, "north", "Dining", 30))
            .expect("same category tie");
        assert_eq!(
            classify(&connection, "expense", Some("North Market"))
                .expect("agreeing tie")
                .category_id,
            Some(dining.category_id)
        );
        let grocery = rule(&connection, "north market", "Groceries", 30);
        let grocery_rule_id = save_rule(&connection, &grocery).expect("save conflict");
        let conflict = classify(&connection, "expense", Some("North Market")).expect("conflict");
        assert_eq!(conflict.category_id, None);
        assert!(conflict.explanation.starts_with("Conflict:"));
        assert!(conflict.explanation.contains("Dining"));
        assert!(conflict.explanation.contains("Groceries"));
        save_rule(
            &connection,
            &CategoryRule {
                id: Some(grocery_rule_id),
                priority: 40,
                ..grocery
            },
        )
        .expect("raise priority");
        assert_eq!(
            classify(&connection, "expense", Some("North Market"))
                .expect("resolved")
                .category_id,
            Some(category_id(&connection, "Groceries"))
        );
        save_rule(
            &connection,
            &CategoryRule {
                id: Some(dining_id),
                enabled: false,
                ..dining
            },
        )
        .expect("disable");
        let mut exact = rule(&connection, "coffee shop", "Shopping", 100);
        exact.match_type = "exact".to_owned();
        save_rule(&connection, &exact).expect("exact rule");
        assert_eq!(
            classify(&connection, "expense", Some("COFFEE*SHOP"))
                .expect("exact")
                .category_id,
            Some(exact.category_id)
        );
        assert_eq!(
            classify(&connection, "expense", Some("Coffee shop 123"))
                .expect("phrase")
                .category_id,
            Some(category_id(&connection, "Dining"))
        );
    }

    #[test]
    fn manual_choices_and_manual_uncategorised_survive_reimport_and_reclassification() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("fictional.db");
        let connection = Connection::open(&path).expect("fixture database");
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);")
            .expect("migration table");
        super::super::initialize_schema(&connection).expect("schema");
        let mut transaction = input(&connection, "North Market", "expense");
        transaction.source_id = Some("fictional-source-001".to_owned());
        let id = create_transaction_from(&connection, &transaction).expect("ingest");
        update_category_from(&connection, id, Some(category_id(&connection, "Dining")))
            .expect("manual choice");
        drop(connection);
        let connection = Connection::open(&path).expect("reopen persisted decisions");
        super::super::initialize_schema(&connection).expect("reopen schema");
        save_rule(
            &connection,
            &rule(&connection, "north market", "Shopping", 100),
        )
        .expect("new rule");
        let repeat = TransactionInput {
            category_id: Some(category_id(&connection, "Groceries")),
            ..transaction.clone()
        };
        assert_eq!(
            create_transaction_from(&connection, &repeat).expect("repeat"),
            id
        );
        assert!(matches!(
            create_transaction_from(
                &connection,
                &TransactionInput {
                    amount_pence: 1,
                    ..repeat.clone()
                }
            ),
            Err(WorkspaceError::SourceTransactionChanged)
        ));
        reclassify(&connection, None).expect("reclassify");
        let choice: (Option<i64>, String) = connection
            .query_row(
                "SELECT category_id, category_source FROM transactions WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("choice");
        assert_eq!(
            choice,
            (
                Some(category_id(&connection, "Dining")),
                "manual".to_owned()
            )
        );
        update_category_from(&connection, id, None).expect("manual uncategorised");
        create_transaction_from(&connection, &transaction).expect("repeat uncategorised");
        reclassify(&connection, None).expect("reclassify");
        assert_eq!(
            connection
                .query_row(
                    "SELECT category_id FROM transactions WHERE id=?1",
                    [id],
                    |row| row.get::<_, Option<i64>>(0)
                )
                .expect("category"),
            None
        );
        reclassify(&connection, Some(id)).expect("explicit use rules");
        assert_eq!(
            connection
                .query_row(
                    "SELECT category_id FROM transactions WHERE id=?1",
                    [id],
                    |row| row.get::<_, Option<i64>>(0)
                )
                .expect("category"),
            Some(category_id(&connection, "Shopping"))
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM transactions", [], |row| row
                    .get::<_, i64>(0))
                .expect("dedup"),
            1
        );
        let manual_empty = TransactionInput {
            source_id: None,
            manual_category: true,
            ..transaction
        };
        let manual_id =
            create_transaction_from(&connection, &manual_empty).expect("manual null creation");
        reclassify(&connection, None).expect("reclassify");
        assert_eq!(
            connection
                .query_row(
                    "SELECT category_source FROM transactions WHERE id=?1",
                    [manual_id],
                    |row| row.get::<_, String>(0)
                )
                .expect("source"),
            "manual"
        );
    }

    #[test]
    fn reclassification_recalculates_dashboard_without_changing_cash_flow() {
        let connection = finance_db();
        create_transaction_from(&connection, &input(&connection, "North Market", "expense"))
            .expect("expense");
        let mut refund = input(&connection, "North Market", "refund");
        refund.amount_pence = 500;
        create_transaction_from(&connection, &refund).expect("refund");
        let transfer_id =
            create_transaction_from(&connection, &input(&connection, "North Market", "transfer"))
                .expect("transfer");
        update_category_from(&connection, transfer_id, None).expect("transfer remains excluded");
        assert_eq!(
            connection
                .query_row(
                    "SELECT category_source FROM transactions WHERE id=?1",
                    [transfer_id],
                    |row| row.get::<_, String>(0)
                )
                .expect("transfer provenance"),
            "transfer"
        );
        let before = dashboard_data(&connection, "2026-10").expect("before");
        assert_eq!(before.category_spending[0].category_name, "Groceries");
        assert_eq!(before.category_spending[0].amount_pence, 1_500);
        save_rule(
            &connection,
            &rule(&connection, "north market", "Dining", 50),
        )
        .expect("rule");
        reclassify(&connection, None).expect("apply");
        let after = dashboard_data(&connection, "2026-10").expect("after");
        assert_eq!(after.category_spending.len(), 1);
        assert_eq!(after.category_spending[0].category_name, "Dining");
        assert_eq!(after.category_spending[0].amount_pence, 1_500);
        assert_eq!(
            after.summary.net_cash_flow_pence,
            before.summary.net_cash_flow_pence
        );
        assert_eq!(after.summary.expense_pence, 1_500);
    }

    #[test]
    fn category_edits_and_rule_changes_persist_without_reseeding() {
        let connection = finance_db();
        let groceries = category_id(&connection, "Groceries");
        save_category_from(
            &connection,
            &CategoryInput {
                id: Some(groceries),
                name: "Food".to_owned(),
                category_type: "expense".to_owned(),
                color: "#123456".to_owned(),
            },
        )
        .expect("rename");
        let rule_id: i64 = connection
            .query_row(
                "SELECT id FROM category_rules WHERE pattern='north market'",
                [],
                |row| row.get(0),
            )
            .expect("rule");
        delete_rule(&connection, rule_id).expect("delete");
        super::super::initialize_schema(&connection).expect("reopen migration");
        assert_eq!(category_id(&connection, "Food"), groceries);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM categories WHERE name='Groceries'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("not reseeded"),
            0
        );
        assert_eq!(
            classify(&connection, "expense", Some("North Market"))
                .expect("deleted rule")
                .category_id,
            None
        );
        assert!(save_category_from(
            &connection,
            &CategoryInput {
                id: Some(groceries),
                name: "Food".to_owned(),
                category_type: "income".to_owned(),
                color: "#123456".to_owned()
            }
        )
        .is_err());
        let invalid = CategoryInput {
            id: None,
            name: "Invalid".to_owned(),
            category_type: "expense".to_owned(),
            color: "#XYZ123".to_owned(),
        };
        assert!(save_category_from(&connection, &invalid).is_err());
        assert!(save_rule(
            &connection,
            &CategoryRule {
                pattern: "***".to_owned(),
                ..rule(&connection, "valid", "Dining", 10)
            }
        )
        .is_err());
    }

    #[test]
    fn category_management_validates_references_and_disabled_rules() {
        let connection = finance_db();
        let category = CategoryInput {
            id: None,
            name: "Fictional Travel".to_owned(),
            category_type: "expense".to_owned(),
            color: "#123456".to_owned(),
        };
        let category_id = save_category_from(&connection, &category).expect("create category");
        assert!(matches!(
            save_category_from(&connection, &category),
            Err(WorkspaceError::CategoryNameExists)
        ));
        let rule = CategoryRule {
            id: None,
            pattern: "fictional train".to_owned(),
            match_type: "contains".to_owned(),
            category_id,
            priority: 100,
            enabled: false,
        };
        let rule_id = save_rule(&connection, &rule).expect("disabled rule");
        assert_eq!(
            classify(&connection, "expense", Some("Fictional Train"))
                .expect("disabled ignored")
                .category_id,
            None
        );
        assert!(matches!(
            delete_category_from(&connection, category_id),
            Err(WorkspaceError::CategoryInUse)
        ));
        save_rule(
            &connection,
            &CategoryRule {
                id: Some(rule_id),
                enabled: true,
                ..rule.clone()
            },
        )
        .expect("enable");
        assert_eq!(
            classify(&connection, "expense", Some("Fictional Train"))
                .expect("enabled")
                .category_id,
            Some(category_id)
        );
        let transaction_id = create_transaction_from(
            &connection,
            &input(&connection, "Fictional Train", "expense"),
        )
        .expect("transaction");
        delete_rule(&connection, rule_id).expect("delete rule");
        assert!(matches!(
            delete_category_from(&connection, category_id),
            Err(WorkspaceError::CategoryInUse)
        ));
        reclassify(&connection, None).expect("deleted rule fallback");
        assert_eq!(
            connection
                .query_row(
                    "SELECT category_id FROM transactions WHERE id=?1",
                    [transaction_id],
                    |row| row.get::<_, Option<i64>>(0)
                )
                .expect("fallback"),
            None
        );
        delete_category_from(&connection, category_id).expect("unreferenced category");
        assert!(matches!(
            delete_category_from(&connection, category_id),
            Err(WorkspaceError::RecordNotFound)
        ));
        assert!(matches!(
            delete_rule(&connection, rule_id),
            Err(WorkspaceError::RecordNotFound)
        ));
        assert!(matches!(
            save_rule(
                &connection,
                &CategoryRule {
                    priority: 1001,
                    ..rule
                }
            ),
            Err(WorkspaceError::InvalidFinancialInput)
        ));
    }

    #[test]
    fn migration_protects_existing_choices_including_null_categories() {
        let connection = Connection::open_in_memory().expect("db");
        connection.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES (2);
             CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT, category_type TEXT, color TEXT);
             CREATE TABLE transactions(id INTEGER PRIMARY KEY, account_id INTEGER, category_id INTEGER,
                 kind TEXT, merchant TEXT, merchant_normalized TEXT);
             INSERT INTO transactions VALUES(1, 1, NULL, 'expense', 'NORTH*MARKET', NULL);"
        ).expect("legacy");
        migrate(&connection).expect("migration");
        migrate(&connection).expect("idempotent");
        let state: (String, String) = connection
            .query_row(
                "SELECT category_source, merchant_normalized FROM transactions WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("preserved");
        assert_eq!(state, ("manual".to_owned(), "north market".to_owned()));
    }
}
