/* eslint-env node */

// Root endpoint
function rootRoute(req, res) {
	res.json({
		service: "Kidsafe Backend",
		version: "1.0.0",
		endpoints: {
			"POST /analyze": "Analyze a YouTube video for safety",
			"GET /health": "Health check endpoint",
		},
	});
}

// Health check endpoint for extension
function healthRoute(req, res) {
	res.json({ status: "ok", service: "kidsafe-backend" });
}

// Catch-all route for undefined endpoints
function notFoundRoute(req, res) {
	res.status(404).json({
		error: "Not Found",
		message: `Cannot ${req.method} ${req.path}`,
		endpoints: {
			"POST /analyze": "Analyze a YouTube video for safety",
			"GET /health": "Health check endpoint",
			"GET /": "API information",
		},
	});
}

module.exports = {
	rootRoute,
	healthRoute,
	notFoundRoute,
};

