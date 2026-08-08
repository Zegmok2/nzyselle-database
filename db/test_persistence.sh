#!/usr/bin/env bash
# Persistence acceptance test.
#
# Exercises the same SQL path src-tauri/src/commands.rs and db.rs use,
# without requiring a compiled Tauri binary (which this dev environment
# can't produce -- see README.md). Every statement here matches what the
# Rust commands actually execute; if this script passes, the underlying
# database layer is sound. It does NOT substitute for actually running
# the compiled .exe, which is why the handoff also has manual steps.
#
# Usage: bash db/test_persistence.sh
set -euo pipefail

DB=$(mktemp --suffix=.sqlite)
trap 'rm -f "$DB"' EXIT

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"

apply_migrations() {
    sqlite3 "$DB" < "$MIGRATIONS_DIR/0001_init.sql" 2>/dev/null || true
    sqlite3 "$DB" "INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('0001','init')" 2>/dev/null || true
    if ! sqlite3 "$DB" "SELECT 1 FROM schema_migrations WHERE version='0002'" | grep -q 1; then
        sqlite3 "$DB" < "$MIGRATIONS_DIR/0002_seed_platform_registry.sql"
        sqlite3 "$DB" "INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('0002','seed')"
    fi
}

echo "--- Step 1-2: open temp db, run all migrations ---"
apply_migrations
[ -f "$DB" ] || fail "database file was not created"
pass "migrations applied"

echo "--- Step 3: create a workspace named Nzyselle (same INSERT commands.rs::create_workspace runs) ---"
sqlite3 "$DB" "INSERT INTO workspace (id, name, accent_color) VALUES ('ws_test_1', 'Nzyselle', '#A98BFF');"
pass "workspace created"

echo "--- Step 4-6: 'close' and reopen (SQLite files are already durable; simulate by re-migrating) ---"
apply_migrations

echo "--- Step 6-7: list workspaces, confirm Nzyselle still exists ---"
COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM workspace WHERE name='Nzyselle';")
[ "$COUNT" = "1" ] || fail "expected exactly 1 'Nzyselle' workspace, found $COUNT"
pass "Nzyselle workspace persisted across reopen"

echo "--- Step 8: update a workspace setting ---"
sqlite3 "$DB" "UPDATE workspace SET description = 'Main creator identity' WHERE id = 'ws_test_1';"

echo "--- Step 9-10: reopen again, confirm the setting remains saved ---"
apply_migrations
DESC=$(sqlite3 "$DB" "SELECT description FROM workspace WHERE id='ws_test_1';")
[ "$DESC" = "Main creator identity" ] || fail "expected description to persist, got '$DESC'"
pass "workspace setting update persisted across reopen"

echo "--- Step 11-12: confirm migration 0002 is not reapplied destructively, seed counts stable ---"
PLATFORM_COUNT_BEFORE=$(sqlite3 "$DB" "SELECT COUNT(*) FROM platform_definition;")
apply_migrations
apply_migrations
PLATFORM_COUNT_AFTER=$(sqlite3 "$DB" "SELECT COUNT(*) FROM platform_definition;")
[ "$PLATFORM_COUNT_BEFORE" = "$PLATFORM_COUNT_AFTER" ] || fail "platform seed count changed across repeated migration runs: $PLATFORM_COUNT_BEFORE -> $PLATFORM_COUNT_AFTER"
[ "$PLATFORM_COUNT_AFTER" = "5" ] || fail "expected exactly 5 seeded platforms, found $PLATFORM_COUNT_AFTER"
pass "platform registry count stable ($PLATFORM_COUNT_AFTER) across repeated launches"

echo "--- Bonus: confirm the workspace created in step 3 is STILL the only one (no duplicate created by reruns) ---"
WS_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM workspace;")
[ "$WS_COUNT" = "1" ] || fail "expected exactly 1 workspace total, found $WS_COUNT"
pass "no duplicate workspace rows introduced by repeated migration runs"

echo ""
echo "ALL PERSISTENCE ACCEPTANCE CHECKS PASSED"
