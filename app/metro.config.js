/* eslint-disable @typescript-eslint/no-require-imports */
// Desde Expo SDK 52, `expo/metro-config` detecta el monorepo (workspaces de npm)
// y configura watchFolders y nodeModulesPaths por sí solo.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
/* eslint-enable @typescript-eslint/no-require-imports */
