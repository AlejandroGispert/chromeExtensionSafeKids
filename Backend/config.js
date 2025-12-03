/* eslint-env node */

const fs = require("fs-extra");
const path = require("path");

// Determine Python command (use venv if available, otherwise system python)
const pythonCmd = fs.existsSync(path.join(__dirname, "venv", "bin", "python"))
	? path.join(__dirname, "venv", "bin", "python")
	: "python3";

// Paths
const TMP_DIR = path.join(__dirname, "tmp");
const DB_PATH = path.join(__dirname, "videos.db");
const AUDIO_PATH = path.join(__dirname, "tmp", "audio.wav");
const VIDEO_PATH = path.join(__dirname, "tmp", "preview.mp4");

// Timeouts (in milliseconds)
const TIMEOUTS = {
	AUDIO_DOWNLOAD: 300000, // 5 minutes
	VIDEO_DOWNLOAD: 600000, // 10 minutes
	FRAME_EXTRACTION: 60000, // 1 minute
	QUICK_AUDIO_SCAN: 120000, // 2 minutes
	IMAGE_SCAN: 120000, // 2 minutes
	FULL_AUDIO_SCAN: 600000, // 10 minutes
	TRANSCRIPTION_ANALYSIS: 600000, // 10 minutes
};

// YouTube download commands (fallback strategies)
const AUDIO_DOWNLOAD_COMMANDS = (videoId) => [
	`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=android" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=ios" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=web" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings https://www.youtube.com/watch?v=${videoId}`,
];

const VIDEO_DOWNLOAD_COMMANDS = (videoId) => [
	`yt-dlp -f "bv*[height<=360]/bv*" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=android" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -f "bv*[height<=360]/bv*" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=ios" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -f "best[height<=360]/worst" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=web" https://www.youtube.com/watch?v=${videoId}`,
	`yt-dlp -f "best[height<=360]/worst" -o tmp/preview.mp4 --no-warnings https://www.youtube.com/watch?v=${videoId}`,
];

module.exports = {
	pythonCmd,
	TMP_DIR,
	DB_PATH,
	AUDIO_PATH,
	VIDEO_PATH,
	TIMEOUTS,
	AUDIO_DOWNLOAD_COMMANDS,
	VIDEO_DOWNLOAD_COMMANDS,
};

