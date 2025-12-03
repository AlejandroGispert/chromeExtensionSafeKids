/* eslint-env node */

const { dbHelpers } = require("./database");

async function viewDatabase() {
	try {
		console.log("📊 Fetching database contents...\n");
		
		const rows = await new Promise((resolve, reject) => {
			const { db } = require("./database");
			db.all("SELECT * FROM videos ORDER BY scannedAt DESC", [], (err, rows) => {
				if (err) reject(err);
				else resolve(rows);
			});
		});
		
		if (rows.length === 0) {
			console.log("📭 Database is empty (no records found).");
		} else {
			console.log(`📝 Found ${rows.length} record(s):\n`);
			console.log("=".repeat(80));
			
			rows.forEach((row, index) => {
				console.log(`\n${index + 1}. Video ID: ${row.videoId}`);
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
							console.log(`   Reasons: None (safe content)`);
						}
					} catch (e) {
						console.log(`   Reasons: ${row.reasons}`);
					}
				} else {
					console.log(`   Reasons: None`);
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

