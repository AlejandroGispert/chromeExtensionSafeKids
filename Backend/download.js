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

	// Verify video file exists
	if (!fs.existsSync(VIDEO_PATH)) {
		throw new Error("Video file was not created after download");
	}

	return true;
}

// Extract frames from video
function extractFrames() {
	console.log("✅ Extracting frames (optimized: max 50 frames)...");
	try {
		// Extract 1 frame every 10 seconds, max 50 frames total
		execSync(
			"ffmpeg -i tmp/preview.mp4 -vf \"fps=1/10\" -frames:v 50 tmp/frame_%03d.jpg -y",
			{
				stdio: "inherit",
				timeout: TIMEOUTS.FRAME_EXTRACTION,
			}
		);
	} catch (ffmpegErr) {
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

