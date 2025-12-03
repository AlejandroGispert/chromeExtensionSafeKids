// Get current YouTube video ID
async function getCurrentVideoId() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab || !tab.url) return null;

	const url = new URL(tab.url);
	if (url.hostname !== "www.youtube.com" && url.hostname !== "youtube.com") {
		return null;
	}

	return url.searchParams.get("v");
}

// Check video safety
async function checkVideo() {
	const videoId = await getCurrentVideoId();

	if (!videoId) {
		showError("Please navigate to a YouTube video page");
		return;
	}

	showLoading();

	try {
		const response = await fetch("http://localhost:4000/analyze", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ videoId }),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		showResults(data, videoId);
	} catch (error) {
		console.error("Kidsafe error:", error);
		showError(error.message);
	}
}

// Show loading state
function showLoading() {
	document.getElementById("status").classList.remove("hidden");
	document.getElementById("details").classList.add("hidden");
	document.getElementById("error").classList.add("hidden");

	const statusIcon = document.querySelector("#status .status-icon");
	const statusText = document.querySelector("#status .status-text");
	statusIcon.textContent = "⏳";
	statusText.textContent = "Checking video safety...";
}

// Show results
function showResults(data, videoId) {
	document.getElementById("status").classList.add("hidden");
	document.getElementById("details").classList.remove("hidden");
	document.getElementById("error").classList.add("hidden");

	const safetyStatus = document.getElementById("safety-status");
	const reasonsSection = document.getElementById("reasons-section");
	const reasonsList = document.getElementById("reasons-list");
	const videoInfo = document.getElementById("video-info");

	// Safety status
	if (data.safe) {
		safetyStatus.innerHTML = `
			<div class="status-safe">
				<span class="status-icon-large">✅</span>
				<span class="status-label">SAFE FOR KIDS</span>
			</div>
		`;
		safetyStatus.className = "safety-status safe";
	} else {
		safetyStatus.innerHTML = `
			<div class="status-unsafe">
				<span class="status-icon-large">⚠️</span>
				<span class="status-label">NOT SAFE FOR KIDS</span>
			</div>
		`;
		safetyStatus.className = "safety-status unsafe";
	}

	// Reasons
	if (data.reasons && data.reasons.length > 0) {
		reasonsSection.classList.remove("hidden");
		reasonsList.innerHTML = data.reasons.map((reason) => `<li>${reason}</li>`).join("");
	} else {
		reasonsSection.classList.add("hidden");
	}

	// Video info
	videoInfo.innerHTML = `
		<div class="info-item">
			<strong>Video ID:</strong> ${videoId}
		</div>
		<div class="info-item">
			<strong>Status:</strong> ${data.cached ? "Cached" : "Fresh Scan"}
		</div>
	`;
}

// Show error
function showError(message) {
	document.getElementById("status").classList.add("hidden");
	document.getElementById("details").classList.add("hidden");
	document.getElementById("error").classList.remove("hidden");

	const errorText = document.querySelector("#error .error-text");
	errorText.textContent = message;
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
	checkVideo();

	// Refresh button
	document.getElementById("refresh-btn").addEventListener("click", () => {
		checkVideo();
	});
});

