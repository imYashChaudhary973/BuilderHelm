use std::cell::{Cell, RefCell};
use std::path::Path;

use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value};

pub type DatabaseValue = Value;
pub type DbRow = Map<String, Value>;

pub struct ZeroDatabase {
    conn: RefCell<Connection>,
    transaction_active: Cell<bool>,
}

fn db_failed(message: &str) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::DatabaseFailed,
        message,
        ZeroErrorOptions::default(),
    )
}

fn to_sql(value: &Value) -> rusqlite::Result<rusqlite::types::Value> {
    Ok(match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(flag) => rusqlite::types::Value::Integer(i64::from(*flag)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(u) = n.as_u64() {
                rusqlite::types::Value::Integer(i64::try_from(u).map_err(|_| {
                    rusqlite::Error::InvalidParameterName("integer overflow".into())
                })?)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        Value::String(text) => rusqlite::types::Value::Text(text.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    })
}

fn from_sql(value: rusqlite::types::Value) -> Value {
    match value {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(i) => Value::Number(Number::from(i)),
        rusqlite::types::Value::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        rusqlite::types::Value::Text(text) => Value::String(text),
        rusqlite::types::Value::Blob(bytes) => {
            Value::Array(bytes.into_iter().map(Value::from).collect())
        }
    }
}

impl ZeroDatabase {
    pub fn execute(&self, sql: &str) {
        self.conn
            .borrow()
            .execute_batch(sql)
            .unwrap_or_else(|err| panic!("{err}"));
    }

    pub fn run(&self, sql: &str, parameters: &[Value]) {
        let conn = self.conn.borrow();
        let mut stmt = conn.prepare(sql).unwrap_or_else(|err| panic!("{err}"));
        let params: Vec<rusqlite::types::Value> =
            parameters.iter().map(|v| to_sql(v).unwrap()).collect();
        stmt.execute(params_from_iter(params.iter()))
            .unwrap_or_else(|err| panic!("{err}"));
    }

    pub fn query_all(&self, sql: &str, parameters: &[Value]) -> Vec<DbRow> {
        let conn = self.conn.borrow();
        let mut stmt = conn.prepare(sql).unwrap_or_else(|err| panic!("{err}"));
        let params: Vec<rusqlite::types::Value> =
            parameters.iter().map(|v| to_sql(v).unwrap()).collect();
        let column_count = stmt.column_count();
        let names: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap().to_string())
            .collect();
        let mut rows = stmt
            .query(params_from_iter(params.iter()))
            .unwrap_or_else(|err| panic!("{err}"));
        let mut out = Vec::new();
        while let Some(row) = rows.next().unwrap_or_else(|err| panic!("{err}")) {
            let mut map = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value: rusqlite::types::Value =
                    row.get(i).unwrap_or_else(|err| panic!("{err}"));
                map.insert(name.clone(), from_sql(value));
            }
            out.push(map);
        }
        out
    }

    pub fn query_one(&self, sql: &str, parameters: &[Value]) -> Option<DbRow> {
        self.query_all(sql, parameters).into_iter().next()
    }

    pub fn transaction<T>(&self, operation: impl FnOnce() -> T) -> T {
        if self.transaction_active.get() {
            panic!(
                "{}",
                db_failed("Nested database transactions are not supported")
            );
        }
        self.transaction_active.set(true);
        self.conn
            .borrow()
            .execute_batch("BEGIN IMMEDIATE;")
            .unwrap_or_else(|err| panic!("{err}"));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation));
        match result {
            Ok(value) => {
                self.conn
                    .borrow()
                    .execute_batch("COMMIT;")
                    .unwrap_or_else(|err| panic!("{err}"));
                self.transaction_active.set(false);
                value
            }
            Err(payload) => {
                let _ = self.conn.borrow().execute_batch("ROLLBACK;");
                self.transaction_active.set(false);
                std::panic::resume_unwind(payload);
            }
        }
    }

    pub fn close(self) {
        let conn = self.conn.into_inner();
        drop(conn);
    }
}

pub fn open_database(location: &str) -> Result<ZeroDatabase, ZeroError> {
    if location != ":memory:" {
        if let Some(parent) = Path::new(location).parent() {
            std::fs::create_dir_all(parent).map_err(|cause| {
                db_failed("Failed to open the Zero database")
                    .with_metadata("cause", cause.to_string())
            })?;
        }
    }
    let conn = Connection::open(location).map_err(|cause| {
        let mut options = ZeroErrorOptions::default();
        options.metadata.insert(
            "location".into(),
            if location == ":memory:" {
                ":memory:".into()
            } else {
                "[LOCAL_PATH]".into()
            },
        );
        ZeroError::new(
            ZeroErrorCode::DatabaseFailed,
            format!("Failed to open the Zero database: {cause}"),
            options,
        )
    })?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;")
        .map_err(|cause| db_failed(&format!("Failed to open the Zero database: {cause}")))?;
    Ok(ZeroDatabase {
        conn: RefCell::new(conn),
        transaction_active: Cell::new(false),
    })
}

pub fn open_database_unchecked(location: &str) -> ZeroDatabase {
    open_database(location).unwrap_or_else(|err| panic!("{}", err.message()))
}
