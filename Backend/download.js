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
	
	// Validate video file with ffprobe to ensure it's not corrupted
	try {
		const { execSync } = require("child_process");
		const probeOutput = execSync(
			`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${VIDEO_PATH}"`,
			{ timeout: 10000, stdio: "pipe" }
		).toString().trim();
		
		const duration = parseFloat(probeOutput);
		if (!duration || duration <= 0 || isNaN(duration)) {
			throw new Error("Video file appears corrupted (invalid duration)");
		}
		
		// Check if file size is reasonable for the duration
		// Minimum ~50KB per minute is reasonable for low quality video
		const minExpectedSize = duration * 50 * 1024; // 50KB per minute
		if (stats.size < minExpectedSize) {
			console.warn(
				`⚠️ Video file is suspiciously small (${(stats.size / 1024).toFixed(1)}KB) for ${duration.toFixed(1)}s duration`
			);
			// Don't throw, but warn - might still work
		}
	} catch (probeErr) {
		// If ffprobe fails, the file is likely corrupted
		throw new Error(`Video file validation failed: ${probeErr.message}. File may be corrupted.`);
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
		// Use -err_detect ignore_err and -fflags +genpts to handle partial/corrupted files better
		execSync(
			"ffmpeg -err_detect ignore_err -fflags +genpts+discardcorrupt -i tmp/preview.mp4 -vf \"fps=1/15\" -frames:v 30 tmp/frame_%03d.jpg -y",
			{
				stdio: "inherit",
				timeout: TIMEOUTS.FRAME_EXTRACTION,
			}
		);
		
		// Verify at least one frame was extracted
		const tmpDir = require("./config").TMP_DIR;
		const frameFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith("frame_") && f.endsWith(".jpg"));
		if (frameFiles.length === 0) {
			// Try alternative extraction method for corrupted files
			console.warn("⚠️ No frames extracted with standard method, trying alternative...");
			try {
				execSync(
					"ffmpeg -err_detect ignore_err -fflags +genpts+discardcorrupt -analyzeduration 10000000 -probesize 10000000 -i tmp/preview.mp4 -vf \"fps=1/15\" -frames:v 30 tmp/frame_%03d.jpg -y",
					{
						stdio: "inherit",
						timeout: TIMEOUTS.FRAME_EXTRACTION,
					}
				);
				const retryFrames = fs.readdirSync(tmpDir).filter(f => f.startsWith("frame_") && f.endsWith(".jpg"));
				if (retryFrames.length === 0) {
					throw new Error("No frames could be extracted - video file is too corrupted");
				}
				console.log(`✅ Extracted ${retryFrames.length} frames (using fallback method)`);
			} catch (retryErr) {
				throw new Error("No frames were extracted from video (file may be corrupted or incomplete)");
			}
		} else {
			console.log(`✅ Extracted ${frameFiles.length} frames`);
		}
	} catch (ffmpegErr) {
		// Check if it's a partial file error
		if (ffmpegErr.message && (ffmpegErr.message.includes("partial file") || ffmpegErr.message.includes("Invalid data"))) {
			throw new Error("Video file is incomplete or corrupted. The download may have failed. Try scanning again.");
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

