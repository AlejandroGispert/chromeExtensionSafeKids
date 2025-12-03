/* eslint-env node */

const express = require("express");
const cors = require("cors");
const { dbHelpers } = require("./database");
const { jsonParser, jsonErrorHandler, errorHandler } = require("./middleware");
const { analyzeRoute } = require("./routes/analyze");
const { rootRoute, healthRoute, notFoundRoute } = require("./routes/index");

/** @type {import('express').Express} */
const app = express();
app.use(cors());
app.use(jsonParser());
app.use(jsonErrorHandler);

// Routes
app.post("/analyze", analyzeRoute);
app.get("/", rootRoute);
app.get("/health", healthRoute);
app.use(notFoundRoute);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = 4000;
app.listen(PORT, () => {
	console.log(`✅ Kidsafe backend running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down gracefully...");
	dbHelpers
		.close()
		.then(() => {
			process.exit(0);
		})
		.catch((err) => {
			console.error("❌ Error closing database:", err.message);
			process.exit(1);
		});
});
