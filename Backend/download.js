/* eslint-env node */

const { execSync } = require("child_process");
const fs = require("fs-extra");
const { AUDIO_DOWNLOAD_COMMANDS, VIDEO_DOWNLOAD_COMMANDS, TIMEOUTS, AUDIO_PATH, VIDEO_PATH } = require("./config");

// Download audio from YouTube
async function downloadAudio(videoId) {
	console.log("✅ Downloading audio...");
	let audioDownloaded = false;
	const commands = AUDIO_DOWNLOAD_COMMANDS(videoId);

	for (const cmd of commands) {
		try {
			execSync(cmd, {
				stdio: "inherit",
				timeout: TIMEOUTS.AUDIO_DOWNLOAD,
			});
			if (fs.existsSync(AUDIO_PATH)) {
				audioDownloaded = true;
				break;
			}
		} catch (downloadErr) {
			console.warn("⚠️ Audio download attempt failed, trying next method...");
			continue;
		}
	}

	if (!audioDownloaded) {
		throw new Error(
			"Audio download failed: YouTube may be blocking downloads for this video. Try updating yt-dlp with: yt-dlp -U"
		);
	}

	// Verify audio file exists
	if (!fs.existsSync(AUDIO_PATH)) {
		throw new Error("Audio file was not created after download");
	}

	return true;
}

// Download video from YouTube
async function downloadVideo(videoId) {
	console.log("✅ Downloading lowest quality video...");
	let videoDownloaded = false;
	const commands = VIDEO_DOWNLOAD_COMMANDS(videoId);

	for (const cmd of commands) {
		try {
			execSync(cmd, {
				stdio: "inherit",
				timeout: TIMEOUTS.VIDEO_DOWNLOAD,
			});
			if (fs.existsSync(VIDEO_PATH)) {
				videoDownloaded = true;
				break;
			}
		} catch (downloadErr) {
			console.warn("⚠️ Video download attempt failed, trying next method...");
			continue;
		}
	}

	if (!videoDownloaded) {
		throw new Error(
			"Video download failed: YouTube may be blocking downloads for this video. Try updating yt-dlp with: yt-dlp -U"
		);
	}

	// Verify video file exists and has reasonable size
	if (!fs.existsSync(VIDEO_PATH)) {
		throw new Error("Video file was not created after download");
	}
	
	const stats = fs.statSync(VIDEO_PATH);
	if (stats.size === 0) {
		throw new Error("Video file is empty (0 bytes) - download may have failed");
	}
	
	if (stats.size < 10000) {
		// Less than 10KB is suspicious for a video file
		console.warn(`⚠️ Video file is very small (${stats.size} bytes), may be corrupted`);
	}

	return true;
}

// Extract frames from video
function extractFrames() {
	console.log("✅ Extracting frames (optimized: max 30 frames, every 15s)...");
	
	// Verify video file exists and is not empty
	const fs = require("fs-extra");
	const { VIDEO_PATH } = require("./config");
	
	if (!fs.existsSync(VIDEO_PATH)) {
		throw new Error("Video file does not exist");
	}
	
	const stats = fs.statSync(VIDEO_PATH);
	if (stats.size === 0) {
		throw new Error("Video file is empty (0 bytes)");
	}
	
	if (stats.size < 1000) {
		// Less than 1KB is suspicious
		throw new Error(`Video file appears corrupted (only ${stats.size} bytes)`);
	}
	
	try {
		// OPTIMIZATION: Extract 1 frame every 15 seconds, max 30 frames (was 10s/50 frames)
		// This is 3x faster while still providing good coverage
		// Use -err_detect ignore_err to continue even if file has minor issues
		execSync(
			"ffmpeg -err_detect ignore_err -i tmp/preview.mp4 -vf \"fps=1/15\" -frames:v 30 tmp/frame_%03d.jpg -y",
			{
				stdio: "inherit",
				timeout: TIMEOUTS.FRAME_EXTRACTION,
			}
		);
		
		// Verify at least one frame was extracted
		const tmpDir = require("./config").TMP_DIR;
		const frameFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith("frame_") && f.endsWith(".jpg"));
		if (frameFiles.length === 0) {
			throw new Error("No frames were extracted from video (file may be corrupted)");
		}
		
		console.log(`✅ Extracted ${frameFiles.length} frames`);
	} catch (ffmpegErr) {
		// Check if it's a partial file error
		if (ffmpegErr.message && ffmpegErr.message.includes("partial file")) {
			throw new Error("Video file is incomplete or corrupted. Try downloading again.");
		}
		throw new Error(
			`Frame extraction failed: ${ffmpegErr.message || "Unknown error"}`
		);
	}
}

module.exports = {
	downloadAudio,
	downloadVideo,
	extractFrames,
};

