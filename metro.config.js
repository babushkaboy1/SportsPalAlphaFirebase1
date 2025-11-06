const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add .cjs extension support
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

// Exclude functions folder from Metro bundler
config.resolver.blacklistRE = /functions\/.*/;
config.watchFolders = [__dirname];
config.resolver.blockList = [
  /functions\/.*/,
];

module.exports = config;