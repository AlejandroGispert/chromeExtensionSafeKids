/* eslint-env node */

const fs = require("fs-extra");
const path = require("path");
const { DB_PATH } = require("./config");

// Dual-mode: use Postgres when DATABASE_URL is set, otherwise fallback to SQLite (local dev)
const usePostgres = !!process.env.DATABASE_URL;

let db = null;
let dbHelpers = null;

if (usePostgres) {
	const { Pool } = require("pg");

	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		ssl:
			process.env.DATABASE_SSL === "false"
				? false
				: { rejectUnauthorized: false },
	});

	async function initPostgres() {
		try {
			const client = await pool.connect();
			try {
				await client.query(`
					CREATE TABLE IF NOT EXISTS videos (
						videoId TEXT PRIMARY KEY,
						title TEXT,
						safe INTEGER,
						reasons TEXT,
						scannedAt TIMESTAMP,
						scanStatus TEXT
					)
				`);
				console.log("✅ Postgres videos table ready");
			} finally {
				client.release();
			}
		} catch (err) {
			console.error("❌ Postgres init error:", err.message);
			process.exit(1);
		}
	}

	// Kick off initialization
	initPostgres();

	dbHelpers = {
		get: (query, params) => {
			return pool
				.query(query, params)
				.then((res) => res.rows[0] || null)
				.catch((err) => {
					throw err;
				});
		},

		run: (query, params) => {
			return pool
				.query(query, params)
				.then((res) => ({ rowCount: res.rowCount }))
				.catch((err) => {
					throw err;
				});
		},

		close: () => {
			return pool.end();
		},
	};
} else {
	const sqlite3 = require("sqlite3").verbose();

	// Ensure database directory exists
	const dbDir = path.dirname(DB_PATH);
	if (!fs.existsSync(dbDir)) {
		fs.ensureDirSync(dbDir);
	}

	// Check if database exists, if not create it
	const dbExists = fs.existsSync(DB_PATH);
	if (!dbExists) {
		console.log("📝 Database file not found, creating new database...");
	}

	// Initialize database (OPEN_CREATE ensures it's created if it doesn't exist)
	db = new sqlite3.Database(
		DB_PATH,
		sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
		(err) => {
			if (err) {
				console.error("❌ Database connection error:", err.message);
				process.exit(1);
			}

			if (!dbExists) {
				console.log("✅ New database created");
			} else {
				console.log("✅ Database connected");
			}

			// Ensure database file has write permissions
			try {
				fs.chmodSync(DB_PATH, 0o666);
			} catch (chmodErr) {
				console.warn("⚠️ Could not set database permissions:", chmodErr.message);
			}
		}
	);

	// Create tables
	db.run(
		`
		CREATE TABLE IF NOT EXISTS videos (
			videoId TEXT PRIMARY KEY,
			title TEXT,
			safe INTEGER,
			reasons TEXT,
			scannedAt TEXT,
			scanStatus TEXT
		)
	`,
		(err) => {
			if (err) {
				console.error("❌ Database table creation error:", err.message);
			}
		}
	);

	// Add scanStatus column to existing databases (migration)
	db.run("ALTER TABLE videos ADD COLUMN scanStatus TEXT DEFAULT NULL", (err) => {
		// Ignore error if column already exists
		if (err && !err.message.includes("duplicate column")) {
			console.warn(
				"⚠️ Could not add scanStatus column (may already exist):",
				err.message
			);
		}
	});

	// Add title column to existing databases (migration)
	db.run("ALTER TABLE videos ADD COLUMN title TEXT DEFAULT NULL", (err) => {
		// Ignore error if column already exists
		if (err && !err.message.includes("duplicate column")) {
			console.warn(
				"⚠️ Could not add title column (may already exist):",
				err.message
			);
		}
	});

	// Database helper functions
	dbHelpers = {
		get: (query, params) => {
			return new Promise((resolve, reject) => {
				db.get(query, params, (err, row) => {
					if (err) reject(err);
					else resolve(row);
				});
			});
		},

		run: (query, params) => {
			return new Promise((resolve, reject) => {
				db.run(query, params, function (err) {
					if (err) reject(err);
					else resolve({ lastID: this.lastID, changes: this.changes });
				});
			});
		},

		close: () => {
			return new Promise((resolve, reject) => {
				db.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
	};
}

module.exports = {
	db,
	dbHelpers,
};

