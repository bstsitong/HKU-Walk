const { getDefaultConfig } = require('expo/metro-config');
// Direct npx expo start/export must pass the same language gate as npm scripts.
require('./scripts/locale-catalog.cjs').ensureLocales();
module.exports = getDefaultConfig(__dirname);
