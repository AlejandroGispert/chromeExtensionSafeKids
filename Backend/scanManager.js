/* eslint-env node */

// Scan manager to track active scans and handle interruptions
let currentScanVideoId = null;
let currentScanAbortController = null;

const scanManager = {
	/**
	 * Check if a scan should be interrupted (different video requested)
	 * @param {string} videoId - The video ID being requested
	 * @returns {boolean} - True if current scan should be interrupted
	 */
	shouldInterrupt: (videoId) => {
		return currentScanVideoId !== null && currentScanVideoId !== videoId;
	},

	/**
	 * Start tracking a new scan
	 * @param {string} videoId - The video ID being scanned
	 * @returns {AbortController} - AbortController for cancelling the scan
	 */
	startScan: (videoId) => {
		// If different video is being scanned, interrupt it
		if (currentScanVideoId !== null && currentScanVideoId !== videoId) {
			console.log(
				`🛑 Interrupting scan for ${currentScanVideoId} - new video ${videoId} requested`
			);
			scanManager.interruptCurrentScan();
		}

		// Start tracking new scan
		currentScanVideoId = videoId;
		currentScanAbortController = new AbortController();
		console.log(`▶️ Starting scan for ${videoId}`);

		return currentScanAbortController;
	},

	/**
	 * Interrupt the current scan
	 */
	interruptCurrentScan: () => {
		if (currentScanAbortController) {
			currentScanAbortController.abort();
			console.log(`🛑 Scan interrupted for ${currentScanVideoId}`);
		}
		currentScanVideoId = null;
		currentScanAbortController = null;
	},

	/**
	 * Complete the current scan
	 * @param {string} videoId - The video ID that completed
	 */
	completeScan: (videoId) => {
		if (currentScanVideoId === videoId) {
			console.log(`✅ Scan completed for ${videoId}`);
			currentScanVideoId = null;
			currentScanAbortController = null;
		}
	},

	/**
	 * Check if a video is currently being scanned
	 * @param {string} videoId - The video ID to check
	 * @returns {boolean} - True if this video is currently being scanned
	 */
	isScanning: (videoId) => {
		return currentScanVideoId === videoId;
	},

	/**
	 * Get the current scanning video ID
	 * @returns {string|null} - Current video ID being scanned, or null
	 */
	getCurrentScanVideoId: () => {
		return currentScanVideoId;
	},

	/**
	 * Get the abort controller for the current scan
	 * @returns {AbortController|null} - Current abort controller, or null
	 */
	getAbortController: () => {
		return currentScanAbortController;
	},
};

module.exports = { scanManager };

