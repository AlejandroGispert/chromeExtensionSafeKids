/* eslint-env node */

const fs = require("fs-extra");
const { dbHelpers } = require("../database");
const { safeJsonParse, cleanupTempFiles, isValidVideoId } = require("../utils");
const { downloadAudio, downloadVideo, extractFrames } = require("../download");
const { processAudioQuick, processImages, processAudioFull, analyzeTranscription } = require("../scanner");
const { completeFullScanOnly, runPhase3Only } = require("../phases");
const { AUDIO_PATH } = require("../config");

async function analyzeRoute(req, res) {
	try {
		const { videoId } = req.body;

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

		// ✅ 1️⃣ CACHE CHECK
		try {
			const row = await dbHelpers.get("SELECT * FROM videos WHERE videoId = ?", [videoId]);

			// Check if we have a cached result
			if (row) {
				try {
					const reasons = safeJsonParse(row.reasons, []);
					const scanStatus = row.scanStatus || "unknown";

					// If only quick scan was done and it was safe, complete phases 2 and 3
					if (scanStatus === "quick" && row.safe === 1) {
						console.log(
							`🔄 Video ${videoId} has quick scan only, completing Phase 2 & 3...`
						);

						// Check if audio file still exists
						if (!fs.existsSync(AUDIO_PATH)) {
							console.log(
								"⚠️ Audio file not found, need to re-download for full scan"
							);
							// Will fall through to full scan below (will do Phase 1 + Phase 2 + Phase 3)
						} else {
							// Audio exists, do Phase 2 & 3 only (skip Phase 1)
							completeFullScanOnly(videoId, reasons)
								.then((result) => {
									// Send response when full scan completes
									res.json({
										videoId,
										safe: result.safe,
										reasons: result.reasons,
										cached: false,
										scanType: "full",
										scanStatus: result.safe ? "full" : "phase2",
									});
								})
								.catch((err) => {
									console.error("❌ Error completing full scan:", err);
									// Return preliminary result if full scan fails
									res.json({
										videoId,
										safe: true,
										reasons: [],
										cached: false,
										scanType: "preliminary",
										error: "Full scan failed, using preliminary result",
									});
								});
							return; // Don't continue with normal scan flow
						}
					}

					// If Phase 2 complete but safe, continue to Phase 3
					if (scanStatus === "phase2" && row.safe === 1) {
						console.log(
							`🔄 Video ${videoId} has Phase 2 complete, continuing to Phase 3...`
						);
						if (fs.existsSync(AUDIO_PATH)) {
							// Run only Phase 3 (context analysis)
							runPhase3Only()
								.then((transcriptionResult) => {
									const transcriptionReasons = safeJsonParse(transcriptionResult, []);
									const allReasons = [...transcriptionReasons, ...reasons];
									const safe = allReasons.length === 0;

									dbHelpers
										.run(
											"UPDATE videos SET safe=?, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
											[safe ? 1 : 0, JSON.stringify(allReasons), videoId]
										)
										.catch((err) => {
											console.error("❌ Database update error:", err.message);
										});

									res.json({
										videoId,
										safe,
										reasons: allReasons,
										cached: false,
										scanType: "full",
										scanStatus: "full",
									});
								})
								.catch((err) => {
									console.error("❌ Phase 3 failed:", err);
									res.json({
										videoId,
										safe: true,
										reasons: [],
										cached: true,
										scanStatus: "phase2",
									});
								});
							return;
						}
					}

					// If full scan complete, return cached result
					if (scanStatus === "full") {
						return res.json({
							videoId,
							safe: !!row.safe,
							reasons,
							cached: true,
							scanStatus: scanStatus,
						});
					}

					// If unsafe was found (in any phase), return immediately
					if (row.safe === 0) {
						return res.json({
							videoId,
							safe: false,
							reasons,
							cached: true,
							scanStatus: scanStatus,
						});
					}
				} catch (parseErr) {
					console.error("❌ Error parsing cached reasons:", parseErr.message);
					// Continue to re-scan if cache is corrupted
				}
			}
		} catch (dbErr) {
			console.error("❌ Database query error:", dbErr.message);
			return res.status(500).json({
				error: "Database error",
				details: "Failed to check cache",
				message: dbErr.message,
			});
		}

		// Start fresh scan
		try {
			console.log(`🔍 Starting scan for video: ${videoId}`);

			// ✅ Prepare temp directory
			console.log("✅ Preparing temp directory...");
			fs.ensureDirSync("tmp");
			cleanupTempFiles(); // Clean any leftover files

			// ✅ 2️⃣ AUDIO DOWNLOAD (Priority: Check audio first)
			await downloadAudio(videoId);

			// ✅ 3️⃣ START AUDIO PROCESSING IMMEDIATELY (don't wait for video)
			console.log("✅ Starting audio processing immediately...");
			const audioProcessingPromise = processAudioQuick();

			// ✅ 4️⃣ VIDEO DOWNLOAD (in parallel with audio processing)
			console.log("✅ Downloading video in parallel with audio processing...");
			const videoDownloadPromise = downloadVideo(videoId);

			// Wait for audio processing to complete first (faster path if unsafe)
			const quickAudioResult = await audioProcessingPromise;
			const quickAudioReasons = safeJsonParse(quickAudioResult, []);

			console.log(
				`📊 Quick Audio Scan: ${quickAudioReasons.length} flags`,
				quickAudioReasons
			);

			// ✅ OPTIMIZATION: If audio finds issues, skip video download entirely
			if (quickAudioReasons.length > 0) {
				console.log(
					"⚠️ UNSAFE CONTENT DETECTED in audio - skipping video download"
				);
				
				// Cancel video download if still in progress (we don't need it)
				// Note: We can't actually cancel execSync, but we can skip processing
				
				// Save result and return immediately
				await dbHelpers.run(
					"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
					[videoId, 0, JSON.stringify(quickAudioReasons), "full"]
				);

				cleanupTempFiles();
				return res.json({
					videoId,
					safe: false,
					reasons: quickAudioReasons,
					cached: false,
					scanType: "quick",
				});
			}

			// Audio is safe - wait for video download to complete
			await videoDownloadPromise;

			// ✅ 5️⃣ FRAME EXTRACTION (with error handling)
			try {
				extractFrames();
			} catch (frameErr) {
				// If frame extraction fails due to corrupted video, continue with audio-only scan
				console.warn(`⚠️ Frame extraction failed: ${frameErr.message}`);
				console.warn("⚠️ Continuing with audio-only scan (images will be skipped)");
				// Set empty image results so scan can continue
				const imageResult = "[]";
				const imageReasons = safeJsonParse(imageResult, []);
				
				// Continue with Phase 1 using only audio results
				const phase1Reasons = [...quickAudioReasons, ...imageReasons];
				const phase1Safe = phase1Reasons.length === 0;
				
				if (!phase1Safe) {
					// Still found issues in audio
					await dbHelpers.run(
						"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
						[videoId, 0, JSON.stringify(phase1Reasons), "full"]
					);
					cleanupTempFiles();
					return res.json({
						videoId,
						safe: false,
						reasons: phase1Reasons,
						cached: false,
						scanType: "quick",
					});
				}
				
				// Audio is safe, proceed with Phase 2 & 3 (skip image processing)
				await dbHelpers.run(
					"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
					[videoId, 1, JSON.stringify([]), "quick"]
				);
				
				res.json({
					videoId,
					safe: true,
					reasons: [],
					cached: false,
					scanType: "preliminary",
					scanning: true,
				});
				
				// Start Phase 2 & 3 in background (same as below)
				Promise.all([processAudioFull(videoId), analyzeTranscription()])
					.then(async ([fullAudioResult, transcriptionAnalysisResult]) => {
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
						
						const allPhase2And3Reasons = [...fullAudioReasons, ...transcriptionReasons];
						
						if (allPhase2And3Reasons.length > 0) {
							console.log(
								`⚠️ Phase 2/3 found unsafe content for ${videoId}:`,
								allPhase2And3Reasons
							);
							
							await dbHelpers.run(
								"UPDATE videos SET safe=0, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
								[JSON.stringify(allPhase2And3Reasons), videoId]
							);
							console.log(
								`✅ Updated ${videoId} to UNSAFE after Phase 2 & 3 - PAGE SHOULD BE BLOCKED NOW`
							);
						} else {
							console.log(
								`✅ Phase 2 & 3 complete: Both checks confirm SAFE for ${videoId}`
							);
							
							await dbHelpers.run(
								"UPDATE videos SET safe=1, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
								[JSON.stringify([]), videoId]
							);
							console.log(
								`✅ Updated ${videoId} with final SAFE confirmation (all phases clear)`
							);
						}
						
						cleanupTempFiles();
					})
					.catch((err) => {
						console.error(
							`❌ Phase 2/3 background scan failed for ${videoId}:`,
							err.message
						);
						cleanupTempFiles();
					});
				
				return; // Exit early since we handled everything
			}

			// ✅ 6️⃣ PHASE 1: IMAGE SCAN (audio already done)
			console.log("✅ Phase 1: Processing images...");

			// Process images
			const imageResult = await processImages();

			// Parse Phase 1 results (audio already parsed above)
			const imageReasons = safeJsonParse(imageResult, []);

			console.log(
				`📊 Phase 1 - Quick Audio: ${quickAudioReasons.length} flags`,
				quickAudioReasons
			);
			console.log(
				`📊 Phase 1 - Images: ${imageReasons.length} flags`,
				imageReasons
			);

			const phase1Reasons = [...quickAudioReasons, ...imageReasons];
			const phase1Safe = phase1Reasons.length === 0;

			// If unsafe content found in Phase 1, return immediately
			if (!phase1Safe) {
				console.log(
					"⚠️ UNSAFE CONTENT DETECTED in Phase 1:",
					phase1Reasons
				);

				// Save result and return immediately (mark as full since we found unsafe content)
				await dbHelpers.run(
					"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
					[videoId, 0, JSON.stringify(phase1Reasons), "full"]
				);

				cleanupTempFiles();
				return res.json({
					videoId,
					safe: false,
					reasons: phase1Reasons,
					cached: false,
					scanType: "quick",
				});
			}

			// Phase 1 is safe - return preliminary result and start Phase 2 in background
			console.log(
				"✅ Phase 1 complete: No unsafe content detected (preliminary)"
			);

			// Save preliminary result with scanStatus = "quick"
			await dbHelpers.run(
				"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
				[videoId, 1, JSON.stringify([]), "quick"]
			);

			// Return preliminary safe result immediately
			res.json({
				videoId,
				safe: true,
				reasons: [],
				cached: false,
				scanType: "preliminary",
				scanning: true, // Indicates full scan is still running
			});

			// Start Phase 2 & 3 in parallel: Full audio word filtering + Context-aware analysis
			Promise.all([processAudioFull(videoId), analyzeTranscription()])
				.then(async ([fullAudioResult, transcriptionAnalysisResult]) => {
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

					if (allPhase2And3Reasons.length > 0) {
						// Either Phase 2 or Phase 3 found unsafe content - BLOCK IMMEDIATELY
						console.log(
							`⚠️ Phase 2/3 found unsafe content for ${videoId}:`,
							allPhase2And3Reasons
						);

						// Combine with image reasons (images already checked in Phase 1)
						const allReasons = [...allPhase2And3Reasons, ...imageReasons];

						// Update database IMMEDIATELY so extension can block page right away
						await dbHelpers
							.run(
								"UPDATE videos SET safe=0, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
								[JSON.stringify(allReasons), videoId]
							);
						console.log(
							`✅ Updated ${videoId} to UNSAFE after Phase 2 & 3 - PAGE SHOULD BE BLOCKED NOW`
						);
					} else {
						// Both Phase 2 and Phase 3 are clear - final safe confirmation
						console.log(
							`✅ Phase 2 & 3 complete: Both checks confirm SAFE for ${videoId}`
						);

						dbHelpers
							.run(
								"UPDATE videos SET safe=1, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
								[JSON.stringify([]), videoId]
							)
							.then(() => {
								console.log(
									`✅ Updated ${videoId} with final SAFE confirmation (all phases clear)`
								);
							})
							.catch((err) => {
								console.error("❌ Database update error:", err.message);
							});
					}

					// Cleanup temp files after all phases complete
					cleanupTempFiles();
				})
				.catch((err) => {
					console.error(
						`❌ Phase 2/3 background scan failed for ${videoId}:`,
						err.message
					);
					// Don't update database on error - keep preliminary result
					cleanupTempFiles();
				});
		} catch (e) {
			console.error(`❌ Scan failed for ${videoId}:`, e.message);
			console.error("Stack:", e.stack);

			// Cleanup temp files on error
			cleanupTempFiles();

			// Determine error type and provide helpful message
			let errorMessage = "Scan failed";
			let errorDetails = e.message;

			if (
				e.message.includes("timed out") ||
				e.message.includes("ETIMEDOUT")
			) {
				errorMessage = "Operation timed out";
				errorDetails =
					"The scan took too long to complete. The video may be very long or your connection is slow. Try a shorter video.";
			} else if (e.message.includes("download")) {
				errorMessage = "Download failed";
				errorDetails =
					"Failed to download video content. The video may be unavailable or private.";
			} else if (
				e.message.includes("ffmpeg") ||
				e.message.includes("Frame extraction")
			) {
				errorMessage = "Video processing failed";
				errorDetails = "Failed to extract frames from video.";
			}

			// Ensure response hasn't been sent already
			if (!res.headersSent) {
				res.status(500).json({
					error: errorMessage,
					details: errorDetails,
					message: e.message,
				});
			} else {
				console.error(
					"❌ Response already sent, cannot send error response"
				);
			}
		}
	} catch (outerErr) {
		// Catch any errors outside the database callback
		console.error("❌ Unexpected error in /analyze endpoint:", outerErr);
		if (!res.headersSent) {
			res.status(500).json({
				error: "Internal server error",
				details: "An unexpected error occurred",
				message: outerErr.message,
			});
		}
	}
}

module.exports = { analyzeRoute };

