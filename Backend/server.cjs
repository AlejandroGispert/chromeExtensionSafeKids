/* eslint-env node */

const express = require("express");
const cors = require("cors");
const { execSync } = require("child_process");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs-extra");
const path = require("path");

// Determine Python command (use venv if available, otherwise system python)
const pythonCmd = fs.existsSync(path.join(__dirname, "venv", "bin", "python"))
	? path.join(__dirname, "venv", "bin", "python")
	: "python3";

/** @type {import('express').Express} */
const app = express();
app.use(cors());

// JSON parser with error handling
app.use(
	express.json({
		limit: "10mb",
		strict: true,
	})
);

// Handle JSON parsing errors
app.use((err, req, res, next) => {
	if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
		console.error("❌ JSON parsing error:", err.message);
		return res.status(400).json({
			error: "Invalid JSON",
			details: "Request body must be valid JSON",
		});
	}
	next(err);
});

// Helper function to clean up temp files
function cleanupTempFiles() {
	try {
		const tmpDir = path.join(__dirname, "tmp");
		if (fs.existsSync(tmpDir)) {
			const files = fs.readdirSync(tmpDir);
			for (const file of files) {
				if (file !== ".gitkeep") {
					fs.removeSync(path.join(tmpDir, file));
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

// DB
const dbPath = path.join(__dirname, "videos.db");
const db = new sqlite3.Database(
	dbPath,
	sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
	(err) => {
		if (err) {
			console.error("❌ Database connection error:", err.message);
			process.exit(1);
		}
		console.log("✅ Database connected");

		// Ensure database file has write permissions
		try {
			fs.chmodSync(dbPath, 0o666);
		} catch (chmodErr) {
			console.warn("⚠️ Could not set database permissions:", chmodErr.message);
		}
	}
);

db.run(
	`
	CREATE TABLE IF NOT EXISTS videos (
		videoId TEXT PRIMARY KEY,
		safe INTEGER,
		reasons TEXT,
		scannedAt TEXT,
		scanStatus TEXT
	)
`,
	(err) => {
		if (err) {
			console.error("❌ Database table creation error:", err.message);
		}
	}
);

// Add scanStatus column to existing databases (migration)
db.run("ALTER TABLE videos ADD COLUMN scanStatus TEXT DEFAULT NULL", (err) => {
	// Ignore error if column already exists
	if (err && !err.message.includes("duplicate column")) {
		console.warn(
			"⚠️ Could not add scanStatus column (may already exist):",
			err.message
		);
	}
});

// Validate videoId format (YouTube IDs are 11 characters)
function isValidVideoId(videoId) {
	return typeof videoId === "string" && /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

// Function to complete only the full scan (when quick scan already done)
function completeFullScanOnly(videoId, existingImageReasons) {
	return new Promise((resolve, reject) => {
		console.log(
			`🔄 Completing full scan for ${videoId} (quick scan already done)`
		);

		// Helper function to process full audio
		const processAudioFull = () => {
			return new Promise((resolve) => {
				let transcript = "[]";
				try {
					console.log(`🔄 Phase 2: Starting full audio scan for ${videoId}...`);
					const audioOutput = execSync(`${pythonCmd} whisper_scan_full.py`, {
						stdio: "pipe",
						timeout: 600000, // 10 minute timeout for full audio
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
		};

		// Process full audio
		processAudioFull()
			.then((fullAudioResult) => {
				const fullAudioReasons = safeJsonParse(fullAudioResult, []);

				console.log(
					`📊 Full Audio scan: ${fullAudioReasons.length} flags`,
					fullAudioReasons
				);

				// Combine with existing image reasons
				const allReasons = [...fullAudioReasons, ...existingImageReasons];

				if (allReasons.length > 0) {
					// Full scan found unsafe content
					console.log(
						`⚠️ Full scan found unsafe content for ${videoId}:`,
						allReasons
					);

					db.run(
						"UPDATE videos SET safe=0, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
						[JSON.stringify(allReasons), videoId],
						(err) => {
							if (err) {
								console.error("❌ Database update error:", err.message);
								reject(err);
							} else {
								console.log(`✅ Updated ${videoId} to UNSAFE after full scan`);
								resolve({ safe: false, reasons: allReasons });
							}
						}
					);
				} else {
					// Full scan confirms safe
					console.log(`✅ Full scan complete: Confirms SAFE for ${videoId}`);

					db.run(
						"UPDATE videos SET safe=1, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
						[JSON.stringify([]), videoId],
						(err) => {
							if (err) {
								console.error("❌ Database update error:", err.message);
								reject(err);
							} else {
								console.log(
									`✅ Updated ${videoId} with final SAFE confirmation`
								);
								resolve({ safe: true, reasons: [] });
							}
						}
					);
				}

				// Cleanup temp files after background scan
				cleanupTempFiles();
			})
			.catch((err) => {
				console.error(
					`❌ Full scan completion failed for ${videoId}:`,
					err.message
				);
				reject(err);
			});
	});
}

app.post("/analyze", async (req, res) => {
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
		db.get(
			"SELECT * FROM videos WHERE videoId = ?",
			[videoId],
			async (err, row) => {
				// Handle database query errors
				if (err) {
					console.error("❌ Database query error:", err.message);
					return res.status(500).json({
						error: "Database error",
						details: "Failed to check cache",
						message: err.message,
					});
				}

				// Check if we have a cached result
				if (row) {
					try {
						const reasons = safeJsonParse(row.reasons, []);
						const scanStatus = row.scanStatus || "unknown";

						// If only quick scan was done and it was safe, complete the full scan
						if (scanStatus === "quick" && row.safe === 1) {
							console.log(
								`🔄 Video ${videoId} has quick scan only, completing full scan...`
							);

							// Check if audio file still exists
							const audioPath = path.join(__dirname, "tmp", "audio.wav");
							if (!fs.existsSync(audioPath)) {
								console.log(
									"⚠️ Audio file not found, need to re-download for full scan"
								);
								// Will fall through to full scan below (will do Phase 1 + Phase 2)
							} else {
								// Audio exists, do full scan only (skip Phase 1)
								completeFullScanOnly(videoId, reasons)
									.then((result) => {
										// Send response when full scan completes
										res.json({
											videoId,
											safe: result.safe,
											reasons: result.reasons,
											cached: false,
											scanType: "full",
											scanStatus: "full",
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

						// If unsafe was found (even in quick scan), return immediately
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

				// Start fresh scan
				try {
					console.log(`🔍 Starting scan for video: ${videoId}`);

					// ✅ Prepare temp directory
					console.log("✅ Preparing temp directory...");
					fs.ensureDirSync("tmp");
					cleanupTempFiles(); // Clean any leftover files

					// ✅ 2️⃣ AUDIO DOWNLOAD (DIRECT WAV — NO FFMPEG)
					console.log("✅ Downloading audio...");
					let audioDownloaded = false;
					const audioFormats = [
						`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=android" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=ios" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings --extractor-args "youtube:player_client=web" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -x --audio-format wav -o tmp/audio.wav --no-warnings https://www.youtube.com/watch?v=${videoId}`,
					];

					for (const cmd of audioFormats) {
						try {
							execSync(cmd, {
								stdio: "inherit",
								timeout: 300000, // 5 minute timeout
							});
							if (fs.existsSync("tmp/audio.wav")) {
								audioDownloaded = true;
								break;
							}
						} catch (downloadErr) {
							console.warn(
								"⚠️ Audio download attempt failed, trying next method..."
							);
							continue;
						}
					}

					if (!audioDownloaded) {
						throw new Error(
							"Audio download failed: YouTube may be blocking downloads for this video. Try updating yt-dlp with: yt-dlp -U"
						);
					}

					// Verify audio file exists
					if (!fs.existsSync("tmp/audio.wav")) {
						throw new Error("Audio file was not created after download");
					}

					// ✅ 3️⃣ LOWEST QUALITY VIDEO DOWNLOAD (FAST & LIGHT)
					console.log("✅ Downloading lowest quality video...");
					let videoDownloaded = false;
					const videoFormats = [
						`yt-dlp -f "bv*[height<=360]/bv*" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=android" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -f "bv*[height<=360]/bv*" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=ios" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -f "best[height<=360]/worst" -o tmp/preview.mp4 --no-warnings --extractor-args "youtube:player_client=web" https://www.youtube.com/watch?v=${videoId}`,
						`yt-dlp -f "best[height<=360]/worst" -o tmp/preview.mp4 --no-warnings https://www.youtube.com/watch?v=${videoId}`,
					];

					for (const cmd of videoFormats) {
						try {
							execSync(cmd, {
								stdio: "inherit",
								timeout: 600000, // 10 minute timeout
							});
							if (fs.existsSync("tmp/preview.mp4")) {
								videoDownloaded = true;
								break;
							}
						} catch (downloadErr) {
							console.warn(
								"⚠️ Video download attempt failed, trying next method..."
							);
							continue;
						}
					}

					if (!videoDownloaded) {
						throw new Error(
							"Video download failed: YouTube may be blocking downloads for this video. Try updating yt-dlp with: yt-dlp -U"
						);
					}

					// Verify video file exists
					if (!fs.existsSync("tmp/preview.mp4")) {
						throw new Error("Video file was not created after download");
					}

					// ✅ 4️⃣ FRAME EXTRACTION (OPTIMIZED: Smart sampling - max 50 frames)
					// Extract frames at regular intervals: every 10 seconds, max 50 frames
					console.log("✅ Extracting frames (optimized: max 50 frames)...");
					try {
						// Extract 1 frame every 10 seconds, max 50 frames total
						// This gives good coverage: first 30s gets 3 frames, then every 10s
						execSync(
							`ffmpeg -i tmp/preview.mp4 -vf "fps=1/10" -frames:v 50 tmp/frame_%03d.jpg -y`,
							{
								stdio: "inherit",
								timeout: 60000, // 1 minute timeout
							}
						);
					} catch (ffmpegErr) {
						throw new Error(
							`Frame extraction failed: ${ffmpegErr.message || "Unknown error"}`
						);
					}

					// ✅ 5️⃣ & 6️⃣ PHASE 1: QUICK SCAN (Audio first 2min + Images in parallel)
					console.log(
						"✅ Phase 1: Running quick scan (Audio first 2min + Images)..."
					);

					// Helper function to process quick audio (first 2 minutes)
					const processAudioQuick = () => {
						return new Promise((resolve) => {
							let transcript = "[]";
							try {
								const audioOutput = execSync(`${pythonCmd} whisper_scan.py`, {
									stdio: "pipe",
									timeout: 120000, // 2 minute timeout
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
					};

					// Helper function to process images
					const processImages = () => {
						return new Promise((resolve) => {
							let imageResult = "[]";
							try {
								const output = execSync(`${pythonCmd} image_scan.py`, {
									stdio: "pipe",
									timeout: 120000, // 2 minute timeout
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
					};

					// Helper function to process full audio (entire file)
					const processAudioFull = () => {
						return new Promise((resolve) => {
							let transcript = "[]";
							try {
								console.log(
									`🔄 Phase 2: Starting full audio scan for ${videoId}...`
								);
								const audioOutput = execSync(
									`${pythonCmd} whisper_scan_full.py`,
									{
										stdio: "pipe",
										timeout: 600000, // 10 minute timeout for full audio
										cwd: __dirname,
									}
								).toString();
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
					};

					// Run Phase 1: Quick scan (audio first 2min + images in parallel)
					const [quickAudioResult, imageResult] = await Promise.all([
						processAudioQuick(),
						processImages(),
					]);

					// Parse Phase 1 results
					const quickAudioReasons = safeJsonParse(quickAudioResult, []);
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
						db.run(
							"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
							[videoId, 0, JSON.stringify(phase1Reasons), "full"],
							(err) => {
								if (err) {
									console.error("❌ Database insert error:", err.message);
								}
							}
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
					db.run(
						"INSERT OR REPLACE INTO videos VALUES (?, ?, ?, datetime('now'), ?)",
						[videoId, 1, JSON.stringify([]), "quick"],
						(err) => {
							if (err) {
								console.error("❌ Database insert error:", err.message);
							}
						}
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

					// Start Phase 2: Full audio scan in background (don't await)
					processAudioFull()
						.then((fullAudioResult) => {
							const fullAudioReasons = safeJsonParse(fullAudioResult, []);

							console.log(
								`📊 Phase 2 - Full Audio: ${fullAudioReasons.length} flags`,
								fullAudioReasons
							);

							if (fullAudioReasons.length > 0) {
								// Full scan found unsafe content - update database
								console.log(
									`⚠️ Phase 2 found unsafe content for ${videoId}:`,
									fullAudioReasons
								);

								// Combine with image reasons (images already checked in Phase 1)
								const allReasons = [...fullAudioReasons, ...imageReasons];

								db.run(
									"UPDATE videos SET safe=0, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
									[JSON.stringify(allReasons), videoId],
									(err) => {
										if (err) {
											console.error("❌ Database update error:", err.message);
										} else {
											console.log(
												`✅ Updated ${videoId} to UNSAFE after full scan`
											);
										}
									}
								);
							} else {
								// Full scan confirms safe - update with final confirmation
								console.log(
									`✅ Phase 2 complete: Full scan confirms SAFE for ${videoId}`
								);

								db.run(
									"UPDATE videos SET safe=1, reasons=?, scannedAt=datetime('now'), scanStatus='full' WHERE videoId=?",
									[JSON.stringify([]), videoId],
									(err) => {
										if (err) {
											console.error("❌ Database update error:", err.message);
										} else {
											console.log(
												`✅ Updated ${videoId} with final SAFE confirmation`
											);
										}
									}
								);
							}

							// Cleanup temp files after background scan
							cleanupTempFiles();
						})
						.catch((err) => {
							console.error(
								`❌ Phase 2 background scan failed for ${videoId}:`,
								err.message
							);
							// Don't update database on error - keep preliminary result
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
			}
		);
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
});

// Error handling middleware (must have 4 parameters: err, req, res, next)
app.use((err, req, res, next) => {
	console.error("❌ Unhandled error:", err);

	// Check if response has already been sent
	if (res.headersSent) {
		return next(err);
	}

	// Ensure we have a valid response object
	if (!res || typeof res.status !== "function") {
		console.error("❌ Invalid response object in error handler");
		return;
	}

	try {
		res.status(500).json({
			error: "Internal server error",
			details: err.message || "Unknown error",
		});
	} catch (handlerErr) {
		console.error("❌ Error in error handler:", handlerErr);
	}
});

// Root endpoint
app.get("/", (req, res) => {
	res.json({
		service: "Kidsafe Backend",
		version: "1.0.0",
		endpoints: {
			"POST /analyze": "Analyze a YouTube video for safety",
			"GET /health": "Health check endpoint",
		},
	});
});

// Health check endpoint for extension
app.get("/health", (req, res) => {
	res.json({ status: "ok", service: "kidsafe-backend" });
});

// Catch-all route for undefined endpoints
app.use((req, res) => {
	res.status(404).json({
		error: "Not Found",
		message: `Cannot ${req.method} ${req.path}`,
		endpoints: {
			"POST /analyze": "Analyze a YouTube video for safety",
			"GET /health": "Health check endpoint",
			"GET /": "API information",
		},
	});
});

app.listen(4000, () => {
	console.log("✅ Kidsafe backend running on http://localhost:4000");
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down gracefully...");
	db.close((err) => {
		if (err) console.error("❌ Error closing database:", err.message);
		process.exit(0);
	});
});
