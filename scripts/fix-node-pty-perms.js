#!/usr/bin/env node
// node-pty's prebuild ships with a `spawn-helper` binary that some package
// managers copy without the execute bit. Without it, `posix_spawnp` fails
// with a generic "posix_spawnp failed." error and the terminal panel can't
// open. Walk the prebuilds dir and re-add the bit on every spawn-helper.
const fs = require('fs');
const path = require('path');

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(prebuildsDir)) {
  process.exit(0);
}

let fixed = 0;
for (const platform of fs.readdirSync(prebuildsDir)) {
  const helper = path.join(prebuildsDir, platform, 'spawn-helper');
  if (!fs.existsSync(helper)) continue;
  try {
    const st = fs.statSync(helper);
    if (!(st.mode & 0o111)) {
      fs.chmodSync(helper, 0o755);
      fixed += 1;
      console.log(`[fix-node-pty] chmod +x ${path.relative(process.cwd(), helper)}`);
    }
  } catch (err) {
    console.warn(`[fix-node-pty] failed to fix ${helper}: ${err.message}`);
  }
}

if (fixed > 0) {
  console.log(`[fix-node-pty] fixed ${fixed} spawn-helper binary(s)`);
}
