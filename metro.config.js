const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Add .cjs extension support
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = true;

// Exclude ONLY the project root "functions" folder (Firebase functions) —
// avoid blocking any "node_modules/*/functions/*" paths like "semver/functions/*".
const functionsDirPattern = new RegExp(
  `${path.resolve(projectRoot, 'functions').replace(/[\\/]/g, '[\\/]')}[\\/].*`
);

// Metro expects a single RegExp here; no need for exclusionList when using one pattern.
config.resolver.blockList = functionsDirPattern;

module.exports = config;