use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Goal {
    id: Option<i64>,
    name: String,
    target_pence: i64,
    progress_pence: i64,
    target_date: Option<String>,
    notes: String,
}

pub(super) fn migrate(connection: &Connection) -> WorkspaceResult<()> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
         CREATE TABLE IF NOT EXISTS savings_goals(
             id INTEGER PRIMARY KEY,
             name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
             target_pence INTEGER NOT NULL CHECK(target_pence BETWEEN 1 AND 99999999999),
             progress_pence INTEGER NOT NULL CHECK(progress_pence BETWEEN 0 AND 99999999999),
             target_date TEXT,
             notes TEXT NOT NULL CHECK(length(notes)<=1000));
         INSERT OR IGNORE INTO schema_migrations(version) VALUES(5);
         COMMIT;",
        )
        .map_err(|_| WorkspaceError::Storage)
}

fn validate(input: &Goal) -> WorkspaceResult<()> {
    if input.name.trim().is_empty()
        || input.name.chars().count() > 80
        || input.notes.chars().count() > 1000
        || !(1..=MAX_AMOUNT_PENCE).contains(&input.target_pence)
        || !(0..=MAX_AMOUNT_PENCE).contains(&input.progress_pence)
    {
        return Err(WorkspaceError::InvalidGoal);
    }
    if let Some(date) = &input.target_date {
        validate_iso_date(date).map_err(|_| WorkspaceError::InvalidGoal)?;
    }
    Ok(())
}

fn save(connection: &Connection, input: &Goal) -> WorkspaceResult<i64> {
    validate(input)?;
    if let Some(id) = input.id {
        let count=connection.execute(
            "UPDATE savings_goals SET name=?1,target_pence=?2,progress_pence=?3,target_date=?4,notes=?5 WHERE id=?6",
            params![input.name.trim(),input.target_pence,input.progress_pence,input.target_date,input.notes,id]
        ).map_err(|_| WorkspaceError::Storage)?;
        if count == 0 {
            return Err(WorkspaceError::RecordNotFound);
        }
        Ok(id)
    } else {
        connection.execute(
            "INSERT INTO savings_goals(name,target_pence,progress_pence,target_date,notes) VALUES(?1,?2,?3,?4,?5)",
            params![input.name.trim(),input.target_pence,input.progress_pence,input.target_date,input.notes]
        ).map_err(|_| WorkspaceError::Storage)?;
        Ok(connection.last_insert_rowid())
    }
}

fn list(connection: &Connection) -> WorkspaceResult<Vec<Goal>> {
    let mut statement=connection.prepare(
        "SELECT id,name,target_pence,progress_pence,target_date,notes FROM savings_goals ORDER BY name,id"
    ).map_err(|_| WorkspaceError::Storage)?;
    let goals = statement
        .query_map([], |row| {
            Ok(Goal {
                id: row.get(0)?,
                name: row.get(1)?,
                target_pence: row.get(2)?,
                progress_pence: row.get(3)?,
                target_date: row.get(4)?,
                notes: row.get(5)?,
            })
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(goals)
}

fn remove(connection: &Connection, id: i64) -> WorkspaceResult<()> {
    let count = connection
        .execute("DELETE FROM savings_goals WHERE id=?1", [id])
        .map_err(|_| WorkspaceError::Storage)?;
    if count == 0 {
        return Err(WorkspaceError::RecordNotFound);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_savings_goals(state: State<'_, AppState>) -> Result<Vec<Goal>, String> {
    with_connection(&state, list).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_savings_goal(state: State<'_, AppState>, input: Goal) -> Result<i64, String> {
    with_connection(&state, |connection| save(connection, &input))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_savings_goal(state: State<'_, AppState>, goal_id: i64) -> Result<(), String> {
    with_connection(&state, |connection| remove(connection, goal_id))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::tests::finance_db;
    use super::*;

    fn goal() -> Goal {
        Goal {
            id: None,
            name: "Fictional rainy day".to_owned(),
            target_pence: 100_001,
            progress_pence: 0,
            target_date: Some("2028-02-29".to_owned()),
            notes: "Explicit progress, no inferred balance.".to_owned(),
        }
    }

    #[test]
    fn zero_and_overfunded_progress_are_exact_and_goals_are_editable() {
        let connection = finance_db();
        let id = save(&connection, &goal()).expect("zero goal");
        assert_eq!(list(&connection).expect("list")[0].progress_pence, 0);
        save(
            &connection,
            &Goal {
                id: Some(id),
                name: "Edited fictional goal".to_owned(),
                progress_pence: 120_002,
                notes: "Updated manually".to_owned(),
                target_date: None,
                ..goal()
            },
        )
        .expect("edit");
        let goals = list(&connection).expect("goals");
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].target_pence, 100_001);
        assert_eq!(goals[0].progress_pence, 120_002);
        assert_eq!(goals[0].name, "Edited fictional goal");
        assert_eq!(goals[0].notes, "Updated manually");
        assert!(goals[0].target_date.is_none());
        remove(&connection, id).expect("remove");
        assert!(list(&connection).expect("empty").is_empty());
        assert!(matches!(
            remove(&connection, id),
            Err(WorkspaceError::RecordNotFound)
        ));
        assert!(matches!(
            save(
                &connection,
                &Goal {
                    id: Some(id),
                    ..goal()
                }
            ),
            Err(WorkspaceError::RecordNotFound)
        ));
    }

    #[test]
    fn invalid_values_and_calendar_dates_are_rejected_without_mutating_goals() {
        let connection = finance_db();
        for invalid in [
            Goal {
                target_pence: 0,
                ..goal()
            },
            Goal {
                target_pence: -1,
                ..goal()
            },
            Goal {
                target_pence: MAX_AMOUNT_PENCE + 1,
                ..goal()
            },
            Goal {
                progress_pence: -1,
                ..goal()
            },
            Goal {
                progress_pence: MAX_AMOUNT_PENCE + 1,
                ..goal()
            },
            Goal {
                name: " ".to_owned(),
                ..goal()
            },
            Goal {
                name: "x".repeat(81),
                ..goal()
            },
            Goal {
                notes: "x".repeat(1001),
                ..goal()
            },
            Goal {
                target_date: Some("2027-02-29".to_owned()),
                ..goal()
            },
            Goal {
                target_date: Some("2026-13-01".to_owned()),
                ..goal()
            },
        ] {
            assert!(matches!(
                save(&connection, &invalid),
                Err(WorkspaceError::InvalidGoal)
            ));
        }
        assert!(list(&connection).expect("no mutation").is_empty());
        save(
            &connection,
            &Goal {
                progress_pence: MAX_AMOUNT_PENCE,
                ..goal()
            },
        )
        .expect("max valid progress");
    }

    #[test]
    fn progress_is_persisted_not_derived_from_incomplete_transactions() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("fictional.db");
        let connection = Connection::open(&path).expect("db");
        crate::initialize_database(&connection).expect("schema");
        save(
            &connection,
            &Goal {
                progress_pence: 12_345,
                ..goal()
            },
        )
        .expect("save");
        create_transaction_from(
            &connection,
            &TransactionInput {
                source_id: None,
                manual_category: false,
                account_id: 1,
                category_id: None,
                amount_pence: 500_000,
                kind: "income".to_owned(),
                transaction_date: "2026-10-09".to_owned(),
                description: "Fictional income".to_owned(),
                merchant: None,
            },
        )
        .expect("income");
        drop(connection);
        let connection = Connection::open(path).expect("reopen");
        crate::initialize_database(&connection).expect("schema");
        assert_eq!(
            list(&connection).expect("persisted")[0].progress_pence,
            12_345
        );
    }
}
