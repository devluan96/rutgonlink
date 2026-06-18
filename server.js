// Legacy compatibility wrapper.
// Keep all runtime logic in api/index.js so redirects, auth, and routing
// cannot drift between two separate entrypoints.

const app = require("./api");

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 http://localhost:${PORT} (compat wrapper -> api/index.js)`);
  });
}
