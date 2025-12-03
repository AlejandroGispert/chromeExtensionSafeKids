/* eslint-env node */

const { execSync } = require("child_process");
const { pythonCmd, TIMEOUTS } = require("./config");

// Process quick audio (first 2 minutes)
function processAudioQuick() {
	return new Promise((resolve) => {
		let transcript = "[]";
		try {
			const audioOutput = execSync(`"${pythonCmd}" whisper_scan.py`, {
				stdio: "pipe",
				timeout: TIMEOUTS.QUICK_AUDIO_SCAN,
				cwd: __dirname,
			}).toString();
			transcript = audioOutput;
			console.log(
				"📝 Quick Audio AI output (first 200 chars):",
				audioOutput.substring(0, 200)
			);
		} catch (aiErr) {
			console.error("⚠️ Quick Audio AI error:", aiErr.message);
			if (aiErr.stdout) {
				console.error(
					"⚠️ Quick Audio AI stdout:",
					aiErr.stdout.toString().substring(0, 200)
				);
			}
			transcript = "[]"; // Default to empty if AI fails
		}
		resolve(transcript);
	});
}

// Process images
function processImages() {
	return new Promise((resolve) => {
		let imageResult = "[]";
		try {
			const output = execSync(`"${pythonCmd}" image_scan.py`, {
				stdio: "pipe",
				timeout: TIMEOUTS.IMAGE_SCAN,
				cwd: __dirname,
			}).toString();

			console.log(
				"📝 Image AI raw output (first 500 chars):",
				output.substring(0, 500)
			);

			// Extract JSON from output (YOLO may print progress messages)
			const lines = output.trim().split("\n");
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i].trim();
				if (
					(line.startsWith("[") && line.endsWith("]")) ||
					(line.startsWith("{") && line.endsWith("}"))
				) {
					imageResult = line;
					console.log(`✅ Found JSON in line ${i + 1}:`, line);
					break;
				}
			}

			if (imageResult === "[]" && lines.length > 0) {
				console.warn(
					"⚠️ No valid JSON found in image AI output. Last line:",
					lines[lines.length - 1]
				);
			}
		} catch (aiErr) {
			console.error("⚠️ Image AI error:", aiErr.message);
			if (aiErr.stdout) {
				console.error(
					"⚠️ Image AI stdout:",
					aiErr.stdout.toString().substring(0, 500)
				);
			}
			imageResult = "[]"; // Default to empty if AI fails
		}
		resolve(imageResult);
	});
}

// Process full audio (entire file)
function processAudioFull(videoId) {
	return new Promise((resolve) => {
		let transcript = "[]";
		try {
			console.log(`🔄 Phase 2: Starting full audio scan for ${videoId}...`);
			const audioOutput = execSync(`"${pythonCmd}" whisper_scan_full.py`, {
				stdio: "pipe",
				timeout: TIMEOUTS.FULL_AUDIO_SCAN,
				cwd: __dirname,
			}).toString();
			transcript = audioOutput;
			console.log(
				"📝 Full Audio AI output (first 200 chars):",
				audioOutput.substring(0, 200)
			);
		} catch (aiErr) {
			console.error("⚠️ Full Audio AI error:", aiErr.message);
			if (aiErr.stdout) {
				console.error(
					"⚠️ Full Audio AI stdout:",
					aiErr.stdout.toString().substring(0, 200)
				);
			}
			transcript = "[]"; // Default to empty if AI fails
		}
		resolve(transcript);
	});
}

// Analyze transcription for screams, horror, and weapons
function analyzeTranscription() {
	return new Promise((resolve) => {
		let analysisResult = "[]";
		try {
			console.log(
				"🔍 Final check: Analyzing transcription for screams, horror, and weapons..."
			);
			const analysisOutput = execSync(`"${pythonCmd}" transcription_analyzer.py`, {
				stdio: "pipe",
				timeout: TIMEOUTS.TRANSCRIPTION_ANALYSIS,
				cwd: __dirname,
			}).toString();
			analysisResult = analysisOutput;
			console.log(
				"📊 Transcription analysis output (first 200 chars):",
				analysisOutput.substring(0, 200)
			);
		} catch (analysisErr) {
			console.error("⚠️ Transcription analysis error:", analysisErr.message);
			if (analysisErr.stdout) {
				console.error(
					"⚠️ Transcription analysis stdout:",
					analysisErr.stdout.toString().substring(0, 200)
				);
			}
			analysisResult = "[]"; // Default to empty if analysis fails
		}
		resolve(analysisResult);
	});
}

module.exports = {
	processAudioQuick,
	processImages,
	processAudioFull,
	analyzeTranscription,
};

