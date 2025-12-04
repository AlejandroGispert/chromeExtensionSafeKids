/* eslint-env node */

const fs = require("fs-extra");
const path = require("path");
const { DB_PATH } = require("./config");

// Dual-mode: use Postgres when DATABASE_URL is set, otherwise fallback to SQLite (local dev)
const usePostgres = !!process.env.DATABASE_URL;

let db = null;
let dbHelpers = null;

// Helper to convert SQLite syntax to Postgres syntax
function convertToPostgres(query, params) {
	let pgQuery = query.trim();
	
	// Convert INSERT OR REPLACE to INSERT ... ON CONFLICT
	if (pgQuery.includes("INSERT OR REPLACE")) {
		// More robust regex to match the full INSERT OR REPLACE statement
		const match = pgQuery.match(/INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
		if (match) {
			const table = match[1];
			const columns = match[2].split(",").map((c) => c.trim());
			const valuesStr = match[3];
			
			// Parse placeholders and track which are params vs NOW()
			const placeholders = valuesStr.split(",").map((p) => p.trim());
			
			// Build VALUES clause with correct parameter numbers
			let paramIndex = 1;
			const pgPlaceholders = [];
			const columnValueMap = []; // Track what each column gets: param index or "NOW"
			
			placeholders.forEach((p) => {
				if (p === "?") {
					pgPlaceholders.push(`$${paramIndex}`);
					columnValueMap.push({ type: "param", index: paramIndex - 1 }); // 0-based param index
					paramIndex++;
				} else if (p.includes("datetime('now')")) {
					pgPlaceholders.push("NOW()");
					columnValueMap.push({ type: "now" });
				} else {
					pgPlaceholders.push(p);
					columnValueMap.push({ type: "literal", value: p });
				}
			});
			
			// Assume first column is primary key (videoId)
			const conflictColumn = columns[0];
			const updateColumns = columns.slice(1); // All columns except the conflict column
			
			// Build UPDATE SET clause - map each column to its corresponding value
			const updateSetParts = [];
			const newParams = [...params]; // Start with original params
			let updateParamIndex = paramIndex; // Continue parameter numbering for UPDATE
			
			updateColumns.forEach((col) => {
				const originalIdx = columns.indexOf(col); // Index in original columns array
				const valueInfo = columnValueMap[originalIdx];
				
				if (valueInfo.type === "param") {
					// Use the same parameter value
					updateSetParts.push(`${col} = $${updateParamIndex}`);
					newParams.push(params[valueInfo.index]);
					updateParamIndex++;
				} else if (valueInfo.type === "now") {
					// Use NOW() in UPDATE too
					updateSetParts.push(`${col} = NOW()`);
				} else {
					// Literal value (shouldn't happen in our queries)
					updateSetParts.push(`${col} = ${valueInfo.value}`);
				}
			});
			
			const updateSet = updateSetParts.join(", ");
			
			pgQuery = `
				INSERT INTO ${table} (${columns.join(", ")}) 
				VALUES (${pgPlaceholders.join(", ")})
				ON CONFLICT (${conflictColumn}) 
				DO UPDATE SET ${updateSet}
			`.trim();
			
			return { query: pgQuery, params: newParams };
		}
	}
	
	// Convert datetime('now') to NOW()
	pgQuery = pgQuery.replace(/datetime\('now'\)/gi, "NOW()");
	
	// Convert ? placeholders to $1, $2, ...
	if (params && params.length > 0) {
		let paramIndex = 1;
		pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);
	}
	
	return { query: pgQuery, params: params || [] };
}

// Initialize Postgres connection
async function initPostgres(pool) {
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

if (usePostgres) {
	const { Pool } = require("pg");

	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		ssl:
			process.env.DATABASE_SSL === "false"
				? false
				: { rejectUnauthorized: false },
	});

	// Kick off initialization
	initPostgres(pool);

	dbHelpers = {
		get: (query, params) => {
			const { query: pgQuery, params: pgParams } = convertToPostgres(query, params);
			return pool
				.query(pgQuery, pgParams)
				.then((res) => res.rows[0] || null)
				.catch((err) => {
					throw err;
				});
		},

		run: (query, params) => {
			const { query: pgQuery, params: pgParams } = convertToPostgres(query, params);
			return pool
				.query(pgQuery, pgParams)
				.then((res) => ({ rowCount: res.rowCount }))
				.catch((err) => {
					throw err;
				});
		},

		// Helper for NOW() / datetime('now') - returns SQL string
		now: () => "NOW()",

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


		// Helper for NOW() / datetime('now')
		now: () => "datetime('now')",

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
	usePostgres, // Export so other modules can check DB type if needed
};

