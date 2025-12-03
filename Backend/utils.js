/* eslint-env node */

const fs = require("fs-extra");
const path = require("path");
const { TMP_DIR } = require("./config");

// Helper function to clean up temp files
function cleanupTempFiles() {
	try {
		if (fs.existsSync(TMP_DIR)) {
			const files = fs.readdirSync(TMP_DIR);
			for (const file of files) {
				if (file !== ".gitkeep") {
					fs.removeSync(path.join(TMP_DIR, file));
				}
			}
		}
	} catch (err) {
		console.error("⚠️ Failed to cleanup temp files:", err.message);
	}
}

// Helper function to parse JSON safely
function safeJsonParse(str, defaultValue = []) {
	try {
		const trimmed = str.trim();
		if (!trimmed) {
			console.warn("⚠️ Empty string provided to safeJsonParse");
			return defaultValue;
		}
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) {
			console.warn("⚠️ Parsed JSON is not an array:", typeof parsed);
			return defaultValue;
		}
		return parsed;
	} catch (err) {
		console.error("⚠️ JSON parse error:", err.message);
		console.error("⚠️ Raw input (first 200 chars):", str.substring(0, 200));
		return defaultValue;
	}
}

// Validate videoId format (YouTube IDs are 11 characters)
function isValidVideoId(videoId) {
	return typeof videoId === "string" && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

module.exports = {
	cleanupTempFiles,
	safeJsonParse,
	isValidVideoId,
};

