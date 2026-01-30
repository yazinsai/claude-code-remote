#!/usr/bin/env node

/**
 * Postinstall script to fix node-pty spawn-helper permissions on macOS.
 *
 * node-pty's prebuilt binaries for macOS include a spawn-helper executable
 * that sometimes loses its execute permission when installed via npm/npx.
 * This script restores the permission.
 *
 * On Windows/Linux: silently does nothing (no darwin-* prebuilds exist).
 */

const fs = require('fs');
const path = require('path');

// Check both nested (bun/local) and flat (npm/npx) node_modules layouts
const possiblePaths = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds'),
  path.join(__dirname, '..', '..', 'node-pty', 'prebuilds'),
];

for (const prebuildsPath of possiblePaths) {
  try {
    const entries = fs.readdirSync(prebuildsPath);

    for (const entry of entries) {
      // Only process macOS prebuilds
      if (!entry.startsWith('darwin-')) continue;

      const spawnHelper = path.join(prebuildsPath, entry, 'spawn-helper');

      try {
        fs.chmodSync(spawnHelper, 0o755);
      } catch (e) {
        // Ignore errors (file might not exist on some platforms)
      }
    }
  } catch (e) {
    // Directory doesn't exist, skip
  }
}
