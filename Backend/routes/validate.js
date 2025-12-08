/* eslint-env node */

const { execSync } = require("child_process");
const { isValidVideoId } = require("../utils");

// Get video metadata without downloading
function getVideoInfo(videoId) {
	try {
		// Use yt-dlp to get video info without downloading
		const infoJson = execSync(
			`yt-dlp --dump-json --no-download "https://www.youtube.com/watch?v=${videoId}"`,
			{ timeout: 30000, stdio: "pipe" }
		).toString();
		
		const videoInfo = JSON.parse(infoJson);
		return {
			videoId,
			title: videoInfo.title || "",
			duration: videoInfo.duration || 0, // Duration in seconds
			isShort: videoInfo.duration ? videoInfo.duration <= 60 : false, // YouTube Shorts are typically < 60s
			url: videoInfo.webpage_url || `https://www.youtube.com/watch?v=${videoId}`,
		};
	} catch (err) {
		console.error(`❌ Could not get video info for ${videoId}:`, err.message);
		return null;
	}
}

// Check if URL is a Short or playlist
function checkUrlType(url) {
	if (!url) return { isShort: false, isPlaylist: false };
	
	try {
		const urlObj = new URL(url);
		const isShort = urlObj.pathname.startsWith("/shorts/");
		const isPlaylist = urlObj.searchParams.has("list") || urlObj.pathname.includes("/playlist");
		
		return { isShort, isPlaylist };
	} catch {
		return { isShort: false, isPlaylist: false };
	}
}

async function validateRoute(req, res) {
	try {
		const { videoId, url } = req.body;
		
		// Validate input
		if (!videoId) {
			return res.status(400).json({
				error: "Missing videoId",
				details: "Please provide a videoId in the request body",
			});
		}
		
		if (!isValidVideoId(videoId)) {
			return res.status(400).json({
				error: "Invalid videoId format",
				details: `Expected 11-character YouTube video ID, got: ${videoId}`,
			});
		}
		
		// Check URL type (if provided)
		const urlCheck = checkUrlType(url);
		if (urlCheck.isShort) {
			return res.status(400).json({
				error: "YouTube Shorts not supported",
				details: "YouTube Shorts cannot be analyzed. Please use a regular YouTube video.",
				videoId,
				valid: false,
			});
		}
		
		if (urlCheck.isPlaylist) {
			return res.status(400).json({
				error: "Playlists not supported",
				details: "Playlists cannot be analyzed. Please navigate to an individual video.",
				videoId,
				valid: false,
			});
		}
		
		// Get video metadata
		const videoInfo = getVideoInfo(videoId);
		
		if (!videoInfo) {
			return res.status(500).json({
				error: "Could not fetch video information",
				details: "The video may be private, deleted, or unavailable.",
				videoId,
				valid: false,
			});
		}
		
		// Check duration (3 hours = 10800 seconds)
		const MAX_DURATION_SECONDS = 3 * 60 * 60;
		if (videoInfo.duration > MAX_DURATION_SECONDS) {
			return res.status(400).json({
				error: "Video too long",
				details: `Videos longer than 3 hours cannot be analyzed. This video is ${(videoInfo.duration / 60).toFixed(1)} minutes long.`,
				videoId,
				duration: videoInfo.duration,
				valid: false,
			});
		}
		
		// All checks passed
		return res.json({
			videoId,
			valid: true,
			title: videoInfo.title,
			duration: videoInfo.duration,
			durationFormatted: `${Math.floor(videoInfo.duration / 60)}:${String(Math.floor(videoInfo.duration % 60)).padStart(2, "0")}`,
		});
		
	} catch (error) {
		console.error("❌ Unexpected error in /validate endpoint:", error);
		return res.status(500).json({
			error: "Validation failed",
			details: error.message,
		});
	}
}

module.exports = { validateRoute };

