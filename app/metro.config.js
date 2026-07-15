/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Monorepo: watch shared package
config.watchFolders = [
  path.resolve(__dirname, '..', 'shared'),
  path.resolve(__dirname, '..'),
];

// Monorepo: resolve node_modules from app and root
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
];

// Disable import-export side-effect optimization for monorepo symlinks
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
/* eslint-enable @typescript-eslint/no-require-imports */
