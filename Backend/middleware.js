/* eslint-env node */

// JSON parser with error handling
function jsonParser() {
	const express = require("express");
	return express.json({
		limit: "10mb",
		strict: true,
	});
}

// Handle JSON parsing errors
function jsonErrorHandler(err, req, res, next) {
	if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
		console.error("❌ JSON parsing error:", err.message);
		return res.status(400).json({
			error: "Invalid JSON",
			details: "Request body must be valid JSON",
		});
	}
	next(err);
}

// Error handling middleware (must have 4 parameters: err, req, res, next)
function errorHandler(err, req, res, next) {
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
}

module.exports = {
	jsonParser,
	jsonErrorHandler,
	errorHandler,
};

