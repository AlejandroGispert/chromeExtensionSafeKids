/* global chrome */
// Extract video ID from YouTube URL
function getVideoId() {
	const urlParams = new URLSearchParams(window.location.search);
	return urlParams.get("v");
}

// Try to get the video title from the page (fallback to document.title)
function getVideoTitle() {
	// YouTube watch page title element
	const titleElement = document.querySelector(
		"h1.ytd-watch-metadata yt-formatted-string, h1.title, #title h1"
	);
	if (titleElement && titleElement.textContent) {
		return titleElement.textContent.trim();
	}

	// Fallback: document title without the " - YouTube" suffix
	if (document.title) {
		return document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
	}

	return "";
}

// Create full-page blocking overlay for unsafe content
function createBlockingOverlay(reasons) {
	// Remove existing overlay if any
	const existingOverlay = document.getElementById("kidsafe-blocking-overlay");
	if (existingOverlay) {
		existingOverlay.remove();
	}

	const overlay = document.createElement("div");
	overlay.id = "kidsafe-blocking-overlay";
	overlay.className = "kidsafe-blocking-overlay";

	overlay.innerHTML = `
		<div class="kidsafe-blocking-content">
			<div class="kidsafe-blocking-icon">🚫</div>
			<h1 class="kidsafe-blocking-title">Content Blocked</h1>
			<p class="kidsafe-blocking-message">
				This video has been blocked because it contains content that is not safe for children.
			</p>
			${reasons && reasons.length > 0 ? `
				<div class="kidsafe-blocking-reasons">
					<p class="kidsafe-blocking-reasons-title">Detected issues:</p>
					<ul class="kidsafe-blocking-reasons-list">
						${reasons.map(reason => `<li>${reason}</li>`).join("")}
					</ul>
				</div>
			` : ""}
			<button class="kidsafe-blocking-back-btn" id="kidsafe-back-btn">
				← Go Back
			</button>
		</div>
	`;

	// Insert at the very top of body to ensure it's on top
	document.body.insertBefore(overlay, document.body.firstChild);
	
	// Add click handler for back button
	const backBtn = overlay.querySelector("#kidsafe-back-btn");
	if (backBtn) {
		backBtn.addEventListener("click", () => {
			window.history.back();
		});
	}
	
	// Prevent scrolling
	document.body.style.overflow = "hidden";
}

// Remove blocking overlay
function removeBlockingOverlay() {
	const overlay = document.getElementById("kidsafe-blocking-overlay");
	if (overlay) {
		overlay.remove();
	}
	// Restore scrolling
	document.body.style.overflow = "";
}

// Create safety indicator badge
function createSafetyBadge(videoId, status, overlayOnVideo = false) {
	// Remove existing badge if any
	const existingBadge = document.getElementById("kidsafe-badge");
	if (existingBadge) {
		existingBadge.remove();
	}

	if (!videoId) return;

	const badge = document.createElement("div");
	badge.id = "kidsafe-badge";
	badge.className = `kidsafe-badge kidsafe-${status}`;
	
	// Add overlay class if needed
	if (overlayOnVideo) {
		badge.classList.add("kidsafe-overlay");
	}

	let icon, text, color;
	if (status === "safe") {
		icon = "✅";
		text = "Safe for Kids";
		color = "#4CAF50";
	} else if (status === "preliminary") {
		icon = "⏳";
		text = "Preliminary result safe for kids";
		color = "#4CAF50";
	} else if (status === "unsafe") {
		icon = "⚠️";
		text = "Not Safe for Kids";
		color = "#F44336";
	} else if (status === "checking") {
		icon = "⏳";
		text = "Checking...";
		color = "#FF9800";
	} else {
		icon = "❓";
		text = "Unknown";
		color = "#9E9E9E";
	}

	badge.innerHTML = `
		<span class="kidsafe-icon">${icon}</span>
		<span class="kidsafe-text">${text}</span>
	`;
	badge.style.backgroundColor = color;

	// If overlay mode, position over video player
	if (overlayOnVideo) {
		const playerContainer = document.querySelector("#movie_player, ytd-player");
		if (playerContainer) {
			playerContainer.style.position = "relative";
			playerContainer.appendChild(badge);
			return;
		}
	}

	// Normal mode: Try multiple strategies to place badge above video
	// Strategy 1: Insert in video metadata area (above title) - BEST LOCATION
	const metadataContainer = document.querySelector("ytd-watch-metadata");
	if (metadataContainer) {
		// Insert at the very top of metadata container
		metadataContainer.style.position = "relative";
		metadataContainer.insertBefore(badge, metadataContainer.firstChild);
		return;
	}

	// Strategy 2: Insert above video player container
	const playerContainer = document.querySelector("#movie_player, ytd-player");
	if (playerContainer && playerContainer.parentElement) {
		playerContainer.parentElement.insertBefore(badge, playerContainer);
		return;
	}

	// Strategy 3: Insert in primary content area
	const primaryContent = document.querySelector("#primary, #content");
	if (primaryContent) {
		primaryContent.insertBefore(badge, primaryContent.firstChild);
		return;
	}

	// Strategy 4: Insert near video title
	const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.title, #title h1");
	if (titleElement) {
		const container = titleElement.closest("ytd-watch-metadata") || titleElement.parentElement;
		if (container) {
			container.insertBefore(badge, container.firstChild);
			return;
		}
	}

	// Fallback: insert at top of page
	document.body.insertBefore(badge, document.body.firstChild);
}

// Check video safety via background script
async function checkVideoSafety(videoId) {
	if (!videoId) return;

	createSafetyBadge(videoId, "checking");

	try {
		console.log("Kidsafe: Checking video safety for", videoId);
		
		// First check if backend is reachable via background script
		let healthResponse;
		try {
			healthResponse = await chrome.runtime.sendMessage({
				action: "checkHealth",
			});
			console.log("Kidsafe: Health check response", healthResponse);
		} catch (healthErr) {
			console.error("Kidsafe: Health check failed", healthErr);
			throw new Error("Backend not reachable");
		}
		
		if (!healthResponse || !healthResponse.success || !healthResponse.healthy) {
			console.warn("Kidsafe: Backend health check failed", healthResponse);
			throw new Error("Backend not reachable");
		}

		// First, validate the video (check duration, Shorts, playlists)
		console.log("Kidsafe: Validating video", videoId);
		let validateResponse;
		try {
			validateResponse = await chrome.runtime.sendMessage({
				action: "validateVideo",
				videoId: videoId,
				url: window.location.href, // Send current URL to check for Shorts/playlists
			});
			console.log("Kidsafe: Validation response", validateResponse);
		} catch (validateErr) {
			console.error("Kidsafe: Validation failed", validateErr);
			throw new Error("Failed to validate video");
		}
		
		if (!validateResponse || !validateResponse.success) {
			const errorMsg = validateResponse?.error || "Video validation failed";
			createBlockingOverlay([errorMsg]);
			return;
		}
		
		if (!validateResponse.data.valid) {
			// Video is invalid (Short, playlist, or too long)
			const errorMsg = validateResponse.data.details || "Video cannot be analyzed";
			createBlockingOverlay([errorMsg]);
			return;
		}
		
		// Video is valid, proceed with analysis
		const title = getVideoTitle();
		let response;
		try {
			response = await chrome.runtime.sendMessage({
				action: "checkVideo",
				videoId: videoId,
				title,
			});
			console.log("Kidsafe: Video check response", response);
		} catch (msgErr) {
			console.error("Kidsafe: Message to background script failed", msgErr);
			throw new Error("Failed to communicate with extension");
		}

		if (!response || !response.success) {
			throw new Error(response?.error || "Failed to check video");
		}

		const data = response.data;
		
		// Determine status based on scan type
		let status;
		if (!data.safe) {
			status = "unsafe";
		} else if (data.scanType === "preliminary" || data.scanning) {
			status = "preliminary";
		} else {
			status = "safe";
		}

		// If unsafe, block the entire page with overlay
		if (!data.safe) {
			removeBlockingOverlay(); // Remove any existing overlay first
			createBlockingOverlay(data.reasons || []);
			// Don't show badge when blocking - the overlay is enough
		} else {
			// If safe, remove any blocking overlay and show safe badge
			removeBlockingOverlay();
			createSafetyBadge(videoId, status);
			
			// If preliminary scan, start polling for updates
			if (data.scanType === "preliminary" || data.scanning) {
				startPollingForUpdates(videoId);
			}
		}

		// Store result for popup
		chrome.storage.local.set({
			[`video_${videoId}`]: {
				safe: data.safe,
				reasons: data.reasons,
				cached: data.cached,
				scanType: data.scanType,
				scanning: data.scanning,
				timestamp: Date.now(),
			},
		});
	} catch (error) {
		console.error("Kidsafe error:", error);
		createSafetyBadge(videoId, "error");

		// Check if backend is running
		const badge = document.getElementById("kidsafe-badge");
		if (badge) {
			if (
				error.message.includes("Failed to fetch") ||
				error.message.includes("NetworkError") ||
				error.message.includes("Backend not reachable") ||
				error.message.includes("Failed to check video")
			) {
				badge.innerHTML = `
					<span class="kidsafe-icon">❌</span>
					<span class="kidsafe-text">Backend not running</span>
				`;
				badge.style.backgroundColor = "#9E9E9E";
				badge.title =
					"Make sure the Kidsafe backend server is running and reachable from this browser.";
			} else {
				badge.innerHTML = `
					<span class="kidsafe-icon">⚠️</span>
					<span class="kidsafe-text">Error checking video</span>
				`;
				badge.style.backgroundColor = "#FF9800";
				badge.title = error.message;
			}
		}
	}
}

// Listen for URL changes (YouTube SPA navigation)
let currentVideoId = null;

// Polling for scan updates
let pollingInterval = null;
let pollingVideoId = null;

function startPollingForUpdates(videoId) {
	// Stop any existing polling
	stopPolling();
	
	// Only poll if this is still the current video
	if (videoId !== currentVideoId) {
		return;
	}
	
	pollingVideoId = videoId;
	console.log(`🔄 Starting polling for video ${videoId} to check for full scan completion`);
	
	// Poll every 2 seconds for immediate blocking when Phase 2/3 finds unsafe content
	pollingInterval = setInterval(async () => {
		// Check if we're still on the same video
		if (getVideoId() !== pollingVideoId || pollingVideoId !== currentVideoId) {
			console.log("🛑 Stopping polling - video changed");
			stopPolling();
			return;
		}
		
		try {
			console.log(`🔄 Polling for updates on video ${pollingVideoId}...`);
			const response = await chrome.runtime.sendMessage({
				action: "checkVideo",
				videoId: pollingVideoId,
			});
			
			if (response && response.success) {
				const data = response.data;
				
				// If unsafe content found (in any phase), block immediately
				if (!data.safe) {
					console.log(`🚫 Unsafe content detected for ${pollingVideoId}, blocking immediately`);
					stopPolling();
					removeBlockingOverlay();
					createBlockingOverlay(data.reasons || []);
					
					// Update storage
					chrome.storage.local.set({
						[`video_${pollingVideoId}`]: {
							safe: false,
							reasons: data.reasons,
							cached: data.cached,
							scanType: data.scanType,
							timestamp: Date.now(),
						},
					});
					return;
				}
				
				// If scan is complete (not preliminary anymore) and still safe
				if (data.scanType !== "preliminary" && !data.scanning) {
					console.log(`✅ Full scan complete for ${pollingVideoId}`);
					stopPolling();
					
					// Full scan confirms safe
					createSafetyBadge(pollingVideoId, "safe");
					
					// Update storage
					chrome.storage.local.set({
						[`video_${pollingVideoId}`]: {
							safe: true,
							reasons: data.reasons || [],
							cached: data.cached,
							scanType: data.scanType,
							timestamp: Date.now(),
						},
					});
				}
			}
		} catch (error) {
			console.error("Kidsafe polling error:", error);
			// Continue polling on error
		}
	}, 2000); // Poll every 2 seconds for immediate blocking
}

function stopPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
		pollingVideoId = null;
		console.log("🛑 Stopped polling");
	}
}

function handleUrlChange() {
	const videoId = getVideoId();
	if (videoId && videoId !== currentVideoId) {
		// New video - stop any existing polling
		stopPolling();
		currentVideoId = videoId;
		// Remove any existing blocking overlay when navigating
		removeBlockingOverlay();
		// Wait a bit for YouTube's DOM to update
		setTimeout(() => {
			checkVideoSafety(videoId);
		}, 500);
	} else if (videoId && videoId === currentVideoId) {
		// Same video (page reload) - continue checking/polling
		console.log(`🔄 Same video detected (${videoId}), continuing scan check...`);
		setTimeout(() => {
			checkVideoSafety(videoId);
		}, 500);
	} else if (!videoId && currentVideoId) {
		// Navigated away from a video page
		stopPolling();
		currentVideoId = null;
		removeBlockingOverlay();
		const existingBadge = document.getElementById("kidsafe-badge");
		if (existingBadge) {
			existingBadge.remove();
		}
	}
}

// Wait for page to be ready
function init() {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			setTimeout(handleUrlChange, 1000);
		});
	} else {
		setTimeout(handleUrlChange, 1000);
	}
}

init();

// Watch for URL changes (YouTube uses History API)
let lastUrl = location.href;
new MutationObserver(() => {
	const url = location.href;
	if (url !== lastUrl) {
		lastUrl = url;
		handleUrlChange();
	}
}).observe(document, { subtree: true, childList: true });

// Also listen to popstate for back/forward navigation
window.addEventListener("popstate", handleUrlChange);

// Listen for YouTube's navigation events
window.addEventListener("yt-navigate-finish", handleUrlChange);

