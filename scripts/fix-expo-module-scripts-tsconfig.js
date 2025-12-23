const fs = require('fs');
const path = require('path');

function ensureTsconfigBaseShim() {
  const pkgRoot = path.join(__dirname, '..');
  const scriptsPkgDir = path.join(pkgRoot, 'node_modules', 'expo-module-scripts');

  const source = path.join(scriptsPkgDir, 'tsconfig.base.json');
  const target = path.join(scriptsPkgDir, 'tsconfig.base');

  if (!fs.existsSync(scriptsPkgDir)) {
    return;
  }

  // expo-updates (and some other Expo modules) may reference:
  //   "extends": "expo-module-scripts/tsconfig.base"
  // TypeScript doesn't always resolve the implicit .json in this context.
  // Creating this shim file avoids noisy editor diagnostics.
  if (fs.existsSync(target)) {
    return;
  }

  if (!fs.existsSync(source)) {
    return;
  }

  fs.copyFileSync(source, target);
}

try {
  ensureTsconfigBaseShim();
} catch (e) {
  // Never fail install for this convenience shim
}
