const { ensureLocales } = require('./locale-catalog.cjs');
try { console.log(JSON.stringify(ensureLocales())); }
catch (error) { console.error(error.message); process.exitCode = 1; }
