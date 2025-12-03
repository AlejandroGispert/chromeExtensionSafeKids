/* eslint-env node */

const { dbHelpers } = require("./database");

async function removeSafeVideos() {
	try {
		console.log("🗑️  Removing all safe videos from database...");
		
		const result = await dbHelpers.run("DELETE FROM videos WHERE safe = 1", []);
		
		console.log(`✅ Removed ${result.changes} safe video(s) from database.`);
		
		await dbHelpers.close();
		process.exit(0);
	} catch (err) {
		console.error("❌ Error removing safe videos:", err.message);
		process.exit(1);
	}
}

removeSafeVideos();

