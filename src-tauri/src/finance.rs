use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{AppState, WorkspaceError, WorkspaceResult};

pub(super) mod budgets;
pub(super) mod categorisation;

const MAX_AMOUNT_PENCE: i64 = 99_999_999_999;
const MAX_PAGE_SIZE: u32 = 100;
const MAX_PAGE: u32 = 100_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Account {
    pub id: i64,
    pub name: String,
    pub currency_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Category {
    pub id: i64,
    pub name: String,
    pub category_type: String,
    pub color: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransactionInput {
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    manual_category: bool,
    account_id: i64,
    category_id: Option<i64>,
    amount_pence: i64,
    kind: String,
    transaction_date: String,
    description: String,
    merchant: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransactionFilter {
    month: Option<String>,
    kind: Option<String>,
    category_id: Option<i64>,
    search: Option<String>,
    sort: String,
    page: u32,
    page_size: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Transaction {
    id: i64,
    account_id: i64,
    category_id: Option<i64>,
    category_name: Option<String>,
    amount_pence: i64,
    kind: String,
    transaction_date: String,
    description: String,
    merchant: Option<String>,
    merchant_normalized: Option<String>,
    category_source: String,
    category_explanation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransactionPage {
    transactions: Vec<Transaction>,
    total: u32,
    page: u32,
    page_size: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MonthlySummary {
    month: String,
    income_pence: i64,
    expense_pence: i64,
    refund_pence: i64,
    net_cash_flow_pence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CategorySpending {
    category_id: Option<i64>,
    category_name: String,
    color: String,
    amount_pence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DashboardData {
    summary: MonthlySummary,
    history: Vec<MonthlySummary>,
    category_spending: Vec<CategorySpending>,
    accounts: Vec<Account>,
    categories: Vec<Category>,
}

pub(super) fn initialize_schema(connection: &Connection) -> WorkspaceResult<()> {
    let version = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if version >= 2 {
        return migrate_features(connection);
    }
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS accounts (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
                 currency_code TEXT NOT NULL CHECK(currency_code = 'GBP'),
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS categories (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
                 category_type TEXT NOT NULL CHECK(category_type IN ('income', 'expense')),
                 color TEXT NOT NULL CHECK(length(color) = 7),
                 UNIQUE(name, category_type)
             );
             CREATE TABLE IF NOT EXISTS transactions (
                 id INTEGER PRIMARY KEY,
                 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
                 category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
                 amount_pence INTEGER NOT NULL CHECK(amount_pence > 0 AND amount_pence <= 99999999999),
                 kind TEXT NOT NULL CHECK(kind IN ('income', 'expense', 'refund', 'transfer')),
                 transaction_date TEXT NOT NULL CHECK(length(transaction_date) = 10),
                 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 200),
                 merchant TEXT,
                 merchant_normalized TEXT,
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 CHECK((kind = 'transfer' AND category_id IS NULL)
                    OR kind = 'income'
                    OR kind = 'expense'
                    OR kind = 'refund')
             );
             CREATE INDEX IF NOT EXISTS idx_transactions_date_id
                 ON transactions(transaction_date DESC, id DESC);
             CREATE INDEX IF NOT EXISTS idx_transactions_account_date
                 ON transactions(account_id, transaction_date DESC);
             CREATE INDEX IF NOT EXISTS idx_transactions_merchant
                 ON transactions(merchant_normalized);
             INSERT INTO accounts (name, currency_code)
                 SELECT 'Main account', 'GBP'
                 WHERE NOT EXISTS (
                     SELECT 1 FROM accounts
                     WHERE name = 'Main account' AND currency_code = 'GBP'
                 );
             INSERT OR IGNORE INTO categories (name, category_type, color) VALUES
                 ('Housing', 'expense', '#66896D'),
                 ('Groceries', 'expense', '#D3A348'),
                 ('Transport', 'expense', '#6387A4'),
                 ('Dining', 'expense', '#CF8066'),
                 ('Bills', 'expense', '#8B79A8'),
                 ('Shopping', 'expense', '#C2738A'),
                 ('Health', 'expense', '#62978D'),
                 ('Other spending', 'expense', '#8B918C'),
                 ('Salary', 'income', '#4F8B68'),
                 ('Other income', 'income', '#719DB4');
             INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
             COMMIT;",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    migrate_features(connection)
}

fn migrate_features(connection: &Connection) -> WorkspaceResult<()> {
    categorisation::migrate(connection)?;
    budgets::migrate(connection)
}

fn validate_iso_date(date: &str) -> WorkspaceResult<()> {
    let bytes = date.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..].iter().all(u8::is_ascii_digit)
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let year = date[0..4]
        .parse::<u32>()
        .map_err(|_| WorkspaceError::InvalidFinancialInput)?;
    let month = date[5..7]
        .parse::<u32>()
        .map_err(|_| WorkspaceError::InvalidFinancialInput)?;
    let day = date[8..10]
        .parse::<u32>()
        .map_err(|_| WorkspaceError::InvalidFinancialInput)?;
    if !(1000..=9999).contains(&year) || !(1..=12).contains(&month) {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        2 if leap_year => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if day == 0 || day > days_in_month {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    Ok(())
}

fn validate_month(month: &str) -> WorkspaceResult<()> {
    if month.len() != 7 || month.as_bytes().get(4) != Some(&b'-') {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    validate_iso_date(&format!("{month}-01"))
}

fn month_offset(month: &str, offset: i32) -> WorkspaceResult<String> {
    validate_month(month)?;
    let year = month[0..4]
        .parse::<i32>()
        .map_err(|_| WorkspaceError::InvalidFinancialInput)?;
    let month_number = month[5..7]
        .parse::<i32>()
        .map_err(|_| WorkspaceError::InvalidFinancialInput)?;
    let index = year * 12 + month_number - 1 + offset;
    if index < 1000 * 12 {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    Ok(format!("{:04}-{:02}", index / 12, index % 12 + 1))
}

fn normalize_merchant(merchant: Option<&str>) -> Option<String> {
    let merchant = merchant?;
    let mut normalized = String::new();
    let mut pending_space = false;
    for character in merchant.trim().chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if pending_space && !normalized.is_empty() {
                normalized.push(' ');
            }
            normalized.push(character);
            pending_space = false;
        } else {
            pending_space = true;
        }
    }
    (!normalized.is_empty()).then_some(normalized)
}

fn validate_transaction(connection: &Connection, input: &TransactionInput) -> WorkspaceResult<()> {
    if input.amount_pence <= 0
        || input.amount_pence > MAX_AMOUNT_PENCE
        || input.description.trim().is_empty()
        || input.description.chars().count() > 200
        || input.kind.len() > 8
        || !matches!(
            input.kind.as_str(),
            "income" | "expense" | "refund" | "transfer"
        )
        || input
            .source_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty() || id.chars().count() > 200)
        || input
            .merchant
            .as_ref()
            .is_some_and(|merchant| merchant.chars().count() > 120)
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    validate_iso_date(&input.transaction_date)?;
    let account_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
            [input.account_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    if !account_exists {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    if input.kind == "transfer" {
        if input.category_id.is_some() {
            return Err(WorkspaceError::InvalidFinancialInput);
        }
    } else if let Some(category_id) = input.category_id {
        let category_type = connection
            .query_row(
                "SELECT category_type FROM categories WHERE id = ?1",
                [category_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| WorkspaceError::Storage)?;
        let expected_type = if input.kind == "income" {
            "income"
        } else {
            "expense"
        };
        if category_type.as_deref() != Some(expected_type) {
            return Err(WorkspaceError::InvalidFinancialInput);
        }
    }
    Ok(())
}

fn with_connection<T>(
    state: &AppState,
    operation: impl FnOnce(&Connection) -> WorkspaceResult<T>,
) -> WorkspaceResult<T> {
    let guard = state
        .connection
        .lock()
        .map_err(|_| WorkspaceError::StateUnavailable)?;
    let connection = guard.as_ref().ok_or(WorkspaceError::Locked)?;
    operation(connection)
}

#[tauri::command]
pub(super) fn list_finance_data(
    state: State<'_, AppState>,
    month: String,
) -> Result<DashboardData, String> {
    with_connection(&state, |connection| dashboard_data(connection, &month))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn list_transactions(
    state: State<'_, AppState>,
    filter: TransactionFilter,
) -> Result<TransactionPage, String> {
    with_connection(&state, |connection| {
        list_transactions_from(connection, &filter)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn create_transaction(
    state: State<'_, AppState>,
    input: TransactionInput,
) -> Result<i64, String> {
    with_connection(&state, |connection| {
        create_transaction_from(connection, &input)
    })
    .map_err(|error| error.to_string())
}

fn create_transaction_from(
    connection: &Connection,
    input: &TransactionInput,
) -> WorkspaceResult<i64> {
    validate_transaction(connection, input)?;
    if let Some(source_id) = &input.source_id {
        if let Some((id, amount, kind, date)) = connection
            .query_row(
                "SELECT id, amount_pence, kind, transaction_date FROM transactions
                 WHERE account_id = ?1 AND source_id = ?2",
                params![input.account_id, source_id.trim()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| WorkspaceError::Storage)?
        {
            if amount != input.amount_pence || kind != input.kind || date != input.transaction_date
            {
                return Err(WorkspaceError::SourceTransactionChanged);
            }
            return Ok(id);
        }
    }
    let decision = if input.kind == "transfer" {
        categorisation::classify(connection, &input.kind, input.merchant.as_deref())?
    } else if input.category_id.is_some() || input.manual_category {
        categorisation::Decision::manual(input.category_id)
    } else {
        categorisation::classify(connection, &input.kind, input.merchant.as_deref())?
    };
    connection
        .execute(
            "INSERT INTO transactions
                    (account_id, category_id, amount_pence, kind, transaction_date,
                     description, merchant, merchant_normalized, source_id,
                     category_source, category_explanation)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                input.account_id,
                decision.category_id,
                input.amount_pence,
                input.kind,
                input.transaction_date,
                input.description.trim(),
                input
                    .merchant
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty()),
                normalize_merchant(input.merchant.as_deref()),
                input.source_id.as_deref().map(str::trim),
                decision.source,
                decision.explanation
            ],
        )
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(connection.last_insert_rowid())
}

#[tauri::command]
pub(super) fn update_transaction_category(
    state: State<'_, AppState>,
    transaction_id: i64,
    category_id: Option<i64>,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        update_category_from(connection, transaction_id, category_id)
    })
    .map_err(|error| error.to_string())
}

fn update_category_from(
    connection: &Connection,
    transaction_id: i64,
    category_id: Option<i64>,
) -> WorkspaceResult<()> {
    let input = connection
        .query_row(
            "SELECT account_id, amount_pence, kind, transaction_date, description, merchant
                 FROM transactions WHERE id = ?1",
            [transaction_id],
            |row| {
                Ok(TransactionInput {
                    source_id: None,
                    manual_category: true,
                    account_id: row.get(0)?,
                    category_id,
                    amount_pence: row.get(1)?,
                    kind: row.get(2)?,
                    transaction_date: row.get(3)?,
                    description: row.get(4)?,
                    merchant: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|_| WorkspaceError::Storage)?
        .ok_or(WorkspaceError::RecordNotFound)?;
    validate_transaction(connection, &input)?;
    let decision = if input.kind == "transfer" {
        categorisation::classify(connection, &input.kind, input.merchant.as_deref())?
    } else {
        categorisation::Decision::manual(category_id)
    };
    connection
        .execute(
            "UPDATE transactions SET category_id = ?1, category_source = ?2,
                 category_explanation = ?3 WHERE id = ?4",
            params![
                decision.category_id,
                decision.source,
                decision.explanation,
                transaction_id
            ],
        )
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(())
}

#[tauri::command]
pub(super) fn delete_transaction(
    state: State<'_, AppState>,
    transaction_id: i64,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        let removed = connection
            .execute("DELETE FROM transactions WHERE id = ?1", [transaction_id])
            .map_err(|_| WorkspaceError::Storage)?;
        if removed == 0 {
            return Err(WorkspaceError::RecordNotFound);
        }
        Ok(())
    })
    .map_err(|error| error.to_string())
}

fn list_transactions_from(
    connection: &Connection,
    filter: &TransactionFilter,
) -> WorkspaceResult<TransactionPage> {
    if let Some(month) = filter.month.as_deref() {
        validate_month(month)?;
    }
    if filter.page > MAX_PAGE
        || filter.page_size == 0
        || filter.page_size > MAX_PAGE_SIZE
        || filter
            .search
            .as_ref()
            .is_some_and(|search| search.chars().count() > 100)
        || filter.kind.as_ref().is_some_and(|kind| {
            !matches!(kind.as_str(), "income" | "expense" | "refund" | "transfer")
        })
    {
        return Err(WorkspaceError::InvalidFinancialInput);
    }
    let ordering = match filter.sort.as_str() {
        "date_asc" => "t.transaction_date ASC, t.id ASC",
        "amount_desc" => "t.amount_pence DESC, t.transaction_date DESC, t.id DESC",
        "amount_asc" => "t.amount_pence ASC, t.transaction_date DESC, t.id DESC",
        "merchant_asc" => "COALESCE(t.merchant_normalized, t.description) ASC, t.id DESC",
        _ if filter.sort == "date_desc" => "t.transaction_date DESC, t.id DESC",
        _ => return Err(WorkspaceError::InvalidFinancialInput),
    };
    let query = filter.search.as_deref().unwrap_or("").trim();
    let search_pattern = if query.is_empty() {
        String::new()
    } else {
        format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        )
    };
    let page_size = filter.page_size as i64;
    let offset = (filter.page * filter.page_size) as i64;
    let where_clause = "WHERE (?1 IS NULL OR substr(t.transaction_date, 1, 7) = ?1)
        AND (?2 IS NULL OR t.kind = ?2)
        AND (?3 IS NULL OR t.category_id = ?3)
        AND (?4 = '' OR (COALESCE(t.description, '') || ' ' ||
            COALESCE(t.merchant, '') || ' ' || COALESCE(t.merchant_normalized, ''))
            LIKE ?4 ESCAPE '\\' COLLATE NOCASE)";
    let total = connection
        .query_row(
            &format!("SELECT count(*) FROM transactions t {where_clause}"),
            params![
                filter.month,
                filter.kind,
                filter.category_id,
                search_pattern
            ],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT t.id, t.account_id, t.category_id, c.name, t.amount_pence,
                    t.kind, t.transaction_date, t.description, t.merchant,
                    t.merchant_normalized, t.category_source, t.category_explanation
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             {where_clause}
             ORDER BY {ordering} LIMIT ?5 OFFSET ?6"
        ))
        .map_err(|_| WorkspaceError::Storage)?;
    let transactions = statement
        .query_map(
            params![
                filter.month,
                filter.kind,
                filter.category_id,
                search_pattern,
                page_size,
                offset
            ],
            |row| {
                Ok(Transaction {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    category_id: row.get(2)?,
                    category_name: row.get(3)?,
                    amount_pence: row.get(4)?,
                    kind: row.get(5)?,
                    transaction_date: row.get(6)?,
                    description: row.get(7)?,
                    merchant: row.get(8)?,
                    merchant_normalized: row.get(9)?,
                    category_source: row.get(10)?,
                    category_explanation: row.get(11)?,
                })
            },
        )
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(TransactionPage {
        transactions,
        total,
        page: filter.page,
        page_size: filter.page_size,
    })
}

fn monthly_summary(connection: &Connection, month: &str) -> WorkspaceResult<MonthlySummary> {
    validate_month(month)?;
    let (income_pence, expense_gross_pence, refund_pence) = connection
        .query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_pence ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_pence ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_pence ELSE 0 END), 0)
             FROM transactions
             WHERE substr(transaction_date, 1, 7) = ?1 AND kind != 'transfer'",
            [month],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let expense_pence = expense_gross_pence - refund_pence;
    Ok(MonthlySummary {
        month: month.to_owned(),
        income_pence,
        expense_pence,
        refund_pence,
        net_cash_flow_pence: income_pence - expense_pence,
    })
}

fn dashboard_data(connection: &Connection, month: &str) -> WorkspaceResult<DashboardData> {
    validate_month(month)?;
    let summary = monthly_summary(connection, month)?;
    let mut history = Vec::with_capacity(6);
    for offset in (-5..=0).rev() {
        history.push(monthly_summary(connection, &month_offset(month, offset)?)?);
    }
    let mut category_statement = connection
        .prepare(
            "SELECT t.category_id, COALESCE(c.name, 'Uncategorised'),
                    COALESCE(c.color, '#8B918C'),
                    SUM(CASE WHEN t.kind = 'refund' THEN -t.amount_pence ELSE t.amount_pence END)
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE substr(t.transaction_date, 1, 7) = ?1
                 AND t.kind IN ('expense', 'refund')
             GROUP BY t.category_id, c.name, c.color
             HAVING SUM(CASE WHEN t.kind = 'refund' THEN -t.amount_pence ELSE t.amount_pence END) != 0
             ORDER BY 4 DESC, 2 ASC",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let category_spending = category_statement
        .query_map([month], |row| {
            Ok(CategorySpending {
                category_id: row.get(0)?,
                category_name: row.get(1)?,
                color: row.get(2)?,
                amount_pence: row.get(3)?,
            })
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    let mut account_statement = connection
        .prepare("SELECT id, name, currency_code FROM accounts ORDER BY name, id")
        .map_err(|_| WorkspaceError::Storage)?;
    let accounts = account_statement
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency_code: row.get(2)?,
            })
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    let mut category_statement = connection
        .prepare(
            "SELECT id, name, category_type, color FROM categories ORDER BY category_type, name",
        )
        .map_err(|_| WorkspaceError::Storage)?;
    let categories = category_statement
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                category_type: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|_| WorkspaceError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| WorkspaceError::Storage)?;
    Ok(DashboardData {
        summary,
        history,
        category_spending,
        accounts,
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn finance_db() -> Connection {
        let connection = Connection::open_in_memory().expect("open test database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                     version INTEGER PRIMARY KEY NOT NULL,
                     applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .expect("create migration table");
        initialize_schema(&connection).expect("initialize finance schema");
        connection
    }

    #[test]
    fn opening_a_pre_finance_workspace_applies_the_financial_migration() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let database_key = crate::random_bytes::<32>().expect("database key");
        let connection = Connection::open(super::super::database_file(directory.path()))
            .expect("open legacy workspace");
        super::super::configure_database(&connection, &database_key)
            .expect("configure encrypted database");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE app_metadata (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                 );
                 INSERT INTO schema_migrations (version) VALUES (1);",
            )
            .expect("create legacy schema");
        drop(connection);

        let migrated = super::super::open_database(directory.path(), &database_key)
            .expect("open and migrate legacy workspace");
        let account_count = migrated
            .query_row("SELECT count(*) FROM accounts", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("seeded account");
        let migration_version = migrated
            .query_row("SELECT max(version) FROM schema_migrations", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("latest migration");
        assert_eq!(account_count, 1);
        assert_eq!(migration_version, 4);
        initialize_schema(&migrated).expect("repeat idempotent migration");
        let account_count = migrated
            .query_row("SELECT count(*) FROM accounts", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("single seeded account");
        assert_eq!(account_count, 1);
    }

    fn add_test_transaction(
        connection: &Connection,
        kind: &str,
        date: &str,
        amount_pence: i64,
        category_name: &str,
    ) {
        let account_id = connection
            .query_row("SELECT id FROM accounts LIMIT 1", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("default account");
        let category_id = if kind == "transfer" {
            None
        } else {
            Some(
                connection
                    .query_row(
                        "SELECT id FROM categories WHERE name = ?1 LIMIT 1",
                        [category_name],
                        |row| row.get::<_, i64>(0),
                    )
                    .expect("test category"),
            )
        };
        connection
            .execute(
                "INSERT INTO transactions
                    (account_id, category_id, amount_pence, kind, transaction_date, description)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'Test transaction')",
                params![account_id, category_id, amount_pence, kind, date],
            )
            .expect("insert test transaction");
    }

    #[test]
    fn monthly_totals_offset_refunds_and_exclude_transfers() {
        let connection = finance_db();
        add_test_transaction(&connection, "income", "2025-12-01", 250_000, "Salary");
        add_test_transaction(&connection, "expense", "2025-12-31", 75_000, "Groceries");
        add_test_transaction(&connection, "refund", "2025-12-31", 12_500, "Groceries");
        add_test_transaction(&connection, "transfer", "2025-12-31", 40_000, "");
        add_test_transaction(&connection, "expense", "2026-01-01", 9_999, "Bills");

        let december = monthly_summary(&connection, "2025-12").expect("December totals");
        assert_eq!(december.income_pence, 250_000);
        assert_eq!(december.expense_pence, 62_500);
        assert_eq!(december.refund_pence, 12_500);
        assert_eq!(december.net_cash_flow_pence, 187_500);

        let january = monthly_summary(&connection, "2026-01").expect("January totals");
        assert_eq!(january.income_pence, 0);
        assert_eq!(january.expense_pence, 9_999);
        assert_eq!(january.net_cash_flow_pence, -9_999);
    }

    #[test]
    fn category_totals_apply_refunds_to_their_expense_category() {
        let connection = finance_db();
        add_test_transaction(&connection, "expense", "2025-12-03", 8_000, "Groceries");
        add_test_transaction(&connection, "refund", "2025-12-09", 2_500, "Groceries");
        add_test_transaction(&connection, "expense", "2025-12-11", 3_000, "Dining");
        let dashboard = dashboard_data(&connection, "2025-12").expect("dashboard data");

        let groceries = dashboard
            .category_spending
            .iter()
            .find(|item| item.category_name == "Groceries")
            .expect("grocery category");
        assert_eq!(groceries.amount_pence, 5_500);
        let dining = dashboard
            .category_spending
            .iter()
            .find(|item| item.category_name == "Dining")
            .expect("dining category");
        assert_eq!(dining.amount_pence, 3_000);
    }

    #[test]
    fn transaction_search_filter_sort_and_pagination_are_applied_together() {
        let connection = finance_db();
        add_test_transaction(&connection, "expense", "2025-12-01", 1_200, "Groceries");
        add_test_transaction(&connection, "expense", "2025-12-31", 3_400, "Groceries");
        add_test_transaction(&connection, "expense", "2025-12-30", 2_500, "Dining");
        let account_id = connection
            .query_row("SELECT id FROM accounts LIMIT 1", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("default account");
        let grocery_id = connection
            .query_row(
                "SELECT id FROM categories WHERE name = 'Groceries'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("grocery category");
        connection
            .execute(
                "UPDATE transactions
                 SET merchant = 'North Market', merchant_normalized = 'north market'
                 WHERE transaction_date IN ('2025-12-01', '2025-12-31')",
                [],
            )
            .expect("set test merchants");
        let filter = TransactionFilter {
            month: Some("2025-12".to_owned()),
            kind: Some("expense".to_owned()),
            category_id: Some(grocery_id),
            search: Some("NORTH".to_owned()),
            sort: "date_desc".to_owned(),
            page: 0,
            page_size: 1,
        };

        let first_page = list_transactions_from(&connection, &filter).expect("first page");
        assert_eq!(first_page.total, 2);
        assert_eq!(first_page.transactions.len(), 1);
        assert_eq!(first_page.transactions[0].transaction_date, "2025-12-31");
        assert_eq!(first_page.transactions[0].account_id, account_id);
        assert_eq!(
            first_page.transactions[0].merchant.as_deref(),
            Some("North Market")
        );

        let wildcard_filter = TransactionFilter {
            search: Some("%".to_owned()),
            ..filter.clone()
        };
        let wildcard_page =
            list_transactions_from(&connection, &wildcard_filter).expect("literal wildcard search");
        assert_eq!(wildcard_page.total, 0);

        let second_page =
            list_transactions_from(&connection, &TransactionFilter { page: 1, ..filter })
                .expect("second page");
        assert_eq!(second_page.transactions[0].transaction_date, "2025-12-01");
    }

    #[test]
    fn month_ranges_cross_year_boundaries_and_validate_calendar_dates() {
        assert_eq!(
            month_offset("2026-01", -1).expect("previous month"),
            "2025-12"
        );
        assert_eq!(month_offset("2026-01", 0).expect("same month"), "2026-01");
        assert!(validate_iso_date("2024-02-29").is_ok());
        assert!(validate_iso_date("2025-02-29").is_err());
        assert!(validate_iso_date("2026-04-31").is_err());
        assert!(validate_month("2026-13").is_err());
    }

    #[test]
    fn merchant_normalization_is_stable_and_keeps_unicode_letters() {
        assert_eq!(
            normalize_merchant(Some("  Café*Corner  ")),
            Some("café corner".to_owned())
        );
        assert_eq!(normalize_merchant(Some("***")), None);
    }

    #[test]
    fn transaction_validation_enforces_positive_pence_and_compatible_categories() {
        let connection = finance_db();
        let account_id = connection
            .query_row("SELECT id FROM accounts LIMIT 1", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("default account");
        let groceries_id = connection
            .query_row(
                "SELECT id FROM categories WHERE name = 'Groceries'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("expense category");
        let salary_id = connection
            .query_row(
                "SELECT id FROM categories WHERE name = 'Salary'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("income category");
        let valid_expense = TransactionInput {
            source_id: None,
            manual_category: false,
            account_id,
            category_id: Some(groceries_id),
            amount_pence: 1234,
            kind: "expense".to_owned(),
            transaction_date: "2026-10-08".to_owned(),
            description: "Lunch".to_owned(),
            merchant: Some("Cafe Corner".to_owned()),
        };
        assert!(validate_transaction(&connection, &valid_expense).is_ok());

        let incompatible = TransactionInput {
            category_id: Some(salary_id),
            ..valid_expense.clone()
        };
        assert!(validate_transaction(&connection, &incompatible).is_err());
        let negative = TransactionInput {
            amount_pence: -1,
            ..valid_expense.clone()
        };
        assert!(validate_transaction(&connection, &negative).is_err());
        let invalid_date = TransactionInput {
            transaction_date: "2026-+1-08".to_owned(),
            ..valid_expense
        };
        assert!(validate_transaction(&connection, &invalid_date).is_err());
    }
}
