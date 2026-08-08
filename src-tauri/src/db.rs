// Thin wrapper around rusqlite. Migrations live in db/migrations/*.sql
// (the same files verified against the real `sqlite3` CLI during
// development — see db/migrations/README.md) and are embedded at compile
// time so the shipped .exe never depends on loose files next to it.

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

const MIGRATIONS: &[(&str, &str)] = &[
    ("0001", include_str!("../../db/migrations/0001_init.sql")),
    ("0002", include_str!("../../db/migrations/0002_seed_platform_registry.sql")),
    ("0003", include_str!("../../db/migrations/0003_remove_x_platform.sql")),
];

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open_and_migrate(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        let already_applied: Vec<String> = {
            let has_table: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);
            if has_table {
                let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                rows.filter_map(Result::ok).collect()
            } else {
                vec![]
            }
        };

        for (version, sql) in MIGRATIONS {
            if already_applied.contains(&version.to_string()) {
                continue;
            }
            conn.execute_batch(sql)?;
            // Record every migration centrally here, rather than relying on
            // each .sql file remembering to insert its own schema_migrations
            // row. Migration 0001 happens to do that itself; 0002 (a pure
            // seed file) didn't, which is exactly what caused it to rerun on
            // every launch and crash with a UNIQUE constraint violation on
            // the platform registry. INSERT OR IGNORE so this is safe even
            // for a migration that *does* self-register.
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, description) VALUES (?1, ?2)",
                rusqlite::params![version, format!("migration {version}")],
            )?;
        }

        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }
}
