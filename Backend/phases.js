/* eslint-env node */

const { dbHelpers } = require("./database");
const { safeJsonParse, cleanupTempFiles } = require("./utils");
const { processAudioFull, analyzeTranscription } = require("./scanner");

// Function to complete only the full scan (when quick scan already done)
function completeFullScanOnly(videoId, existingImageReasons) {
	return new Promise((resolve, reject) => {
		console.log(
			`🔄 Completing full scan for ${videoId} (quick scan already done)`
		);

		// Phase 2 & 3: Run in parallel - Full audio word filtering + Context-aware analysis
		Promise.all([processAudioFull(videoId), analyzeTranscription()])
			.then(([fullAudioResult, transcriptionAnalysisResult]) => {
				const fullAudioReasons = safeJsonParse(fullAudioResult, []);
				const transcriptionReasons = safeJsonParse(transcriptionAnalysisResult, []);

				console.log(
					`📊 Phase 2 - Full Audio Word Filter: ${fullAudioReasons.length} flags`,
					fullAudioReasons
				);
				console.log(
					`📊 Phase 3 - Context Analysis: ${transcriptionReasons.length} flags`,
					transcriptionReasons
				);

				// Combine all reasons from both phases
				const allPhase2And3Reasons = [...fullAudioReasons, ...transcriptionReasons];

				// Combine with existing image reasons
				const allReasons = [...allPhase2And3Reasons, ...existingImageReasons];

				if (allReasons.length > 0) {
					// Either Phase 2 or Phase 3 found unsafe content
					console.log(
						`⚠️ Phase 2/3 found unsafe content for ${videoId}:`,
						allReasons
					);

					return dbHelpers
						.run(
							"UPDATE videos SET safe=0, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
							[JSON.stringify(allReasons), videoId]
						)
						.then(() => {
							console.log(`✅ Updated ${videoId} to UNSAFE after Phase 2 & 3`);
							resolve({ safe: false, reasons: allReasons });
						})
						.catch((err) => {
							console.error("❌ Database update error:", err.message);
							reject(err);
						});
				} else {
					// Both Phase 2 and Phase 3 are clear - final safe confirmation
					console.log(
						`✅ Phase 2 & 3 complete: Both checks confirm SAFE for ${videoId}`
					);

					return dbHelpers
						.run(
							"UPDATE videos SET safe=1, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
							[JSON.stringify([]), videoId]
						)
						.then(() => {
							console.log(
								`✅ Updated ${videoId} with final SAFE confirmation (all phases clear)`
							);
							resolve({ safe: true, reasons: [] });
						})
						.catch((err) => {
							console.error("❌ Database update error:", err.message);
							reject(err);
						});
				}
			})
			.then(() => {
				// Cleanup temp files after all phases complete
				cleanupTempFiles();
			})
			.catch((err) => {
				console.error(`❌ Phase 2/3 failed for ${videoId}:`, err.message);
				// SAFETY: If scan is interrupted, delete the result so it can be rescanned
				dbHelpers
					.run("DELETE FROM videos WHERE videoId=?", [videoId])
					.then(() => {
						console.log(
							`⚠️ Deleted ${videoId} from database due to interrupted scan - will rescan next time`
						);
					})
					.catch((dbErr) => {
						console.error("❌ Database delete error:", dbErr.message);
					});
				reject(err);
				cleanupTempFiles();
			});
	});
}

// Run Phase 3 only (when Phase 2 is already complete)
function runPhase3Only() {
	return new Promise((resolve) => {
		let analysisResult = "[]";
		try {
			console.log("🔍 Phase 3: Analyzing transcription for context...");
			const { execSync } = require("child_process");
			const { pythonCmd, TIMEOUTS } = require("./config");
			const analysisOutput = execSync(`"${pythonCmd}" transcription_analyzer.py`, {
				stdio: "pipe",
				timeout: TIMEOUTS.TRANSCRIPTION_ANALYSIS,
				cwd: __dirname,
			}).toString();
			analysisResult = analysisOutput;
		} catch (analysisErr) {
			console.error("⚠️ Phase 3 error:", analysisErr.message);
			analysisResult = "[]";
		}
		resolve(analysisResult);
	});
}

module.exports = {
	completeFullScanOnly,
	runPhase3Only,
};

