/* global chrome */
// Background service worker for Kidsafe extension

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "checkVideo") {
		checkVideoSafety(request.videoId)
			.then((result) => sendResponse({ success: true, data: result }))
			.catch((error) => sendResponse({ success: false, error: error.message }));
		return true; // Keep channel open for async response
	}
	
	if (request.action === "checkHealth") {
		checkBackendHealth()
			.then((isHealthy) => sendResponse({ success: true, healthy: isHealthy }))
			.catch(() => sendResponse({ success: false, healthy: false }));
		return true; // Keep channel open for async response
	}
});

// Check video safety via API
async function checkVideoSafety(videoId) {
	try {
		const response = await fetch("http://localhost:4000/analyze", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ videoId }),
		});

		if (!response.ok) {
			// Try to get error details from response body
			let errorDetails = `HTTP error! status: ${response.status}`;
			try {
				const errorData = await response.json();
				if (errorData.error || errorData.details || errorData.message) {
					errorDetails = `${errorData.error || "Error"}: ${errorData.details || errorData.message || ""}`;
				}
			} catch (parseErr) {
				// If we can't parse the error response, use the status text
				errorDetails = `HTTP error! status: ${response.status} ${response.statusText || ""}`;
			}
			console.error("Kidsafe API error:", errorDetails);
			throw new Error(errorDetails);
		}

		const data = await response.json();
		return data;
	} catch (error) {
		console.error("Kidsafe API error:", error);
		throw error;
	}
}

// Check if backend is reachable
chrome.runtime.onInstalled.addListener(() => {
	checkBackendHealth();
});

async function checkBackendHealth() {
	try {
		const response = await fetch("http://localhost:4000/health", {
			method: "GET",
		});
		if (response.ok) {
			console.log("✅ Kidsafe backend is running");
			return true;
		}
		return false;
	} catch (error) {
		console.warn("⚠️ Kidsafe backend is not reachable. Make sure it's running on http://localhost:4000");
		return false;
	}
}

