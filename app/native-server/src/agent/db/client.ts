/**
 * Database client singleton for Agent storage.
 *
 * Uses sql.js (SQLite compiled to WebAssembly) instead of better-sqlite3
 * to avoid native C++ addon compilation issues across different Node.js
 * versions, OS platforms, and architectures.
 *
 * Design principles:
 * - Async initialization (WASM must be loaded once) via initDb()
 * - Synchronous access via getDb() after initialization
 * - Singleton pattern - single connection throughout the app lifecycle
 * - Auto-create tables on first run (no migration tool needed)
 * - Auto-save: dirty flag + periodic flush to disk
 * - Configurable path via environment variable
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import * as schema from './schema';
import { getAgentDataDir } from '../storage';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// ============================================================
// Types
// ============================================================

export type DrizzleDB = SQLJsDatabase<typeof schema>;

// ============================================================
// Singleton State
// ============================================================

let dbInstance: DrizzleDB | null = null;
let sqliteInstance: SqlJsDatabase | null = null;
let dbFilePath: string | null = null;

/** Dirty flag — set after any schema init / migration write. */
let dirty = false;

/** Periodic auto-save interval handle. */
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

/** Auto-save interval in milliseconds. */
const AUTO_SAVE_INTERVAL_MS = 5_000;

// ============================================================
// Database Path Resolution
// ============================================================

/**
 * Get the database file path.
 * Environment: CHROME_MCP_AGENT_DB_FILE overrides the default path.
 */
export function getDatabasePath(): string {
  const envPath = process.env.CHROME_MCP_AGENT_DB_FILE;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }
  return path.join(getAgentDataDir(), 'agent.db');
}

// ============================================================
// Schema Initialization SQL
// ============================================================

const CREATE_TABLES_SQL = `
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  root_path TEXT NOT NULL,
  preferred_cli TEXT,
  selected_model TEXT,
  active_claude_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT
);

CREATE INDEX IF NOT EXISTS projects_last_active_idx ON projects(last_active_at);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  engine_name TEXT NOT NULL,
  engine_session_id TEXT,
  name TEXT,
  model TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'bypassPermissions',
  allow_dangerously_skip_permissions TEXT,
  system_prompt_config TEXT,
  options_config TEXT,
  management_info TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_engine_name_idx ON sessions(engine_name);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  conversation_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL,
  metadata TEXT,
  cli_source TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_project_id_idx ON messages(project_id);
CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages(session_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);
CREATE INDEX IF NOT EXISTS messages_request_id_idx ON messages(request_id);

-- Enable foreign key enforcement
PRAGMA foreign_keys = ON;
`;

// ============================================================
// Database Initialization
// ============================================================

/**
 * Check if a column exists in a table.
 * sql.js exec() returns Array<{ columns: string[], values: any[][] }>
 */
function columnExists(sqlite: SqlJsDatabase, tableName: string, columnName: string): boolean {
  const result = sqlite.exec(`PRAGMA table_info(${tableName})`);
  if (result.length === 0) return false;
  // columns: cid, name, type, notnull, dflt_value, pk
  const nameIdx = result[0].columns.indexOf('name');
  return result[0].values.some((row) => row[nameIdx] === columnName);
}

/**
 * Run migrations for existing databases.
 * Adds new columns that may be missing in older database versions.
 */
function runMigrations(sqlite: SqlJsDatabase): void {
  let migrated = false;

  // Migration 1: Add active_claude_session_id column to projects table
  if (!columnExists(sqlite, 'projects', 'active_claude_session_id')) {
    sqlite.run('ALTER TABLE projects ADD COLUMN active_claude_session_id TEXT');
    migrated = true;
  }

  // Migration 2: Add use_ccr column to projects table
  if (!columnExists(sqlite, 'projects', 'use_ccr')) {
    sqlite.run('ALTER TABLE projects ADD COLUMN use_ccr TEXT');
    migrated = true;
  }

  // Migration 3: Add enable_chrome_mcp column to projects table (default enabled)
  if (!columnExists(sqlite, 'projects', 'enable_chrome_mcp')) {
    sqlite.run("ALTER TABLE projects ADD COLUMN enable_chrome_mcp TEXT NOT NULL DEFAULT '1'");
    migrated = true;
  }

  if (migrated) {
    dirty = true;
  }
}

/**
 * Initialize the database schema.
 * Safe to call multiple times - uses IF NOT EXISTS.
 * Also runs migrations for existing databases.
 */
function initializeSchema(sqlite: SqlJsDatabase): void {
  sqlite.run(CREATE_TABLES_SQL);
  runMigrations(sqlite);
  dirty = true;
}

/**
 * Ensure the data directory exists.
 */
function ensureDataDir(): void {
  const dataDir = getAgentDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

// ============================================================
// Persistence Helpers
// ============================================================

/**
 * Save the in-memory database to disk.
 * No-op if database is not initialized.
 */
export function saveDb(): void {
  if (!sqliteInstance || !dbFilePath) return;
  try {
    const data = sqliteInstance.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbFilePath, buffer);
    dirty = false;
  } catch (err) {
    console.error('[db] Failed to save database to disk:', err);
  }
}

/**
 * Mark the database as dirty so the next auto-save flushes it.
 * Called internally; services do NOT need to call this — the
 * auto-save interval handles persistence transparently.
 */
export function markDirty(): void {
  dirty = true;
}

/** Auto-save tick: flush if dirty. */
function autoSaveTick(): void {
  if (dirty) {
    saveDb();
  }
}

/** Start the periodic auto-save timer. */
function startAutoSave(): void {
  if (autoSaveTimer) return;
  autoSaveTimer = setInterval(autoSaveTick, AUTO_SAVE_INTERVAL_MS);
  // Allow the process to exit even if the timer is active
  if (autoSaveTimer && typeof autoSaveTimer === 'object' && 'unref' in autoSaveTimer) {
    autoSaveTimer.unref();
  }
}

/** Stop the periodic auto-save timer. */
function stopAutoSave(): void {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the database asynchronously.
 *
 * Must be called once during server startup (before any getDb() call).
 * Loads the sql.js WASM binary, opens or creates the database file,
 * runs schema initialisation and migrations, and starts the auto-save
 * timer.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initDb(): Promise<void> {
  if (dbInstance) return; // already initialised

  ensureDataDir();
  dbFilePath = getDatabasePath();

  // Initialise sql.js (loads WASM)
  const SQL = await initSqlJs();

  // Open existing database or create a new one
  if (existsSync(dbFilePath)) {
    const fileBuffer = readFileSync(dbFilePath);
    sqliteInstance = new SQL.Database(fileBuffer);
  } else {
    sqliteInstance = new SQL.Database();
  }

  // Enable WAL mode equivalent — sql.js is in-memory so WAL is not
  // applicable, but we still enable foreign keys.
  sqliteInstance.run('PRAGMA foreign_keys = ON');

  // Initialize schema
  initializeSchema(sqliteInstance);

  // Create Drizzle instance
  dbInstance = drizzle(sqliteInstance, { schema });

  // Persist any schema changes immediately
  saveDb();

  // Start periodic auto-save
  startAutoSave();

  // Hook into drizzle to mark dirty on every write operation.
  // We wrap the underlying sql.js Database.run / Database.exec so any
  // INSERT / UPDATE / DELETE executed by drizzle (or raw SQL) triggers
  // a dirty flag automatically — no changes needed in service files.
  const origRun = sqliteInstance.run.bind(sqliteInstance);
  const origExec = sqliteInstance.exec.bind(sqliteInstance);

  sqliteInstance.run = function (...args: Parameters<SqlJsDatabase['run']>) {
    const result = origRun(...args);
    dirty = true;
    return result;
  } as SqlJsDatabase['run'];

  sqliteInstance.exec = function (...args: Parameters<SqlJsDatabase['exec']>) {
    const result = origExec(...args);
    dirty = true;
    return result;
  } as SqlJsDatabase['exec'];
}

/**
 * Get the Drizzle database instance (synchronous).
 *
 * Throws if initDb() has not been called yet.
 */
export function getDb(): DrizzleDB {
  if (!dbInstance) {
    throw new Error(
      'Database not initialised. Call initDb() during server startup before accessing the database.',
    );
  }
  return dbInstance;
}

/**
 * Close the database connection.
 * Saves to disk, stops auto-save, and releases the sql.js instance.
 * Should be called on graceful shutdown.
 */
export function closeDb(): void {
  stopAutoSave();
  if (sqliteInstance) {
    // Final save
    saveDb();
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
    dbFilePath = null;
    dirty = false;
  }
}
