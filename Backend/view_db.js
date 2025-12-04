/* eslint-env node */

const { dbHelpers } = require("./database");

async function viewDatabase() {
	try {
		console.log("📊 Fetching database contents...\n");
		
		// For Postgres, dbHelpers.get is not ideal for multi-row queries, so we use run().
		// For SQLite, run() doesn't return rows; we fall back to direct db.all().
		let rows = [];
		try {
			// Try Postgres-style: use dbHelpers.run with a SELECT
			const { db } = require("./database");

			if (db && typeof db.all === "function") {
				// SQLite path
				rows = await new Promise((resolve, reject) => {
					db.all(
						"SELECT * FROM videos ORDER BY scannedAt DESC",
						[],
						(err, resultRows) => {
							if (err) reject(err);
							else resolve(resultRows);
						}
					);
				});
			} else {
				// Postgres path: use dbHelpers.get with JSON aggregation
				const allRows = await dbHelpers
					.get(
						"SELECT json_agg(v) AS rows FROM (SELECT * FROM videos ORDER BY scannedAt DESC LIMIT 1000) v",
						[]
					)
					.catch(() => null);
				if (allRows && allRows.rows) {
					rows = allRows.rows;
				} else {
					rows = [];
				}
			}
		} catch (e) {
			console.error("⚠️ Failed to read videos from database:", e.message);
			rows = [];
		}
		
		if (rows.length === 0) {
			console.log("📭 Database is empty (no records found).");
		} else {
			console.log(`📝 Found ${rows.length} record(s):\n`);
			console.log("=".repeat(80));

			rows.forEach((row, index) => {
				console.log(`\n${index + 1}. Video ID: ${row.videoId}`);
				if (row.title) {
					console.log(`   Title: ${row.title}`);
				}
				console.log(`   Safe: ${row.safe === 1 ? "✅ YES" : "❌ NO"}`);
				console.log(`   Scan Status: ${row.scanStatus || "unknown"}`);
				console.log(`   Scanned At: ${row.scannedAt || "N/A"}`);

				if (row.reasons) {
					try {
						const reasons = JSON.parse(row.reasons);
						if (reasons.length > 0) {
							console.log(`   Reasons (${reasons.length}):`);
							reasons.forEach((reason, i) => {
								console.log(`      ${i + 1}. ${reason}`);
							});
						} else {
							console.log("   Reasons: None (safe content)");
						}
					} catch (e) {
						console.log(`   Reasons: ${row.reasons}`);
					}
				} else {
					console.log("   Reasons: None");
				}

				console.log("-".repeat(80));
			});
		}
		
		await dbHelpers.close();
		process.exit(0);
	} catch (err) {
		console.error("❌ Error viewing database:", err.message);
		process.exit(1);
	}
}

viewDatabase();

