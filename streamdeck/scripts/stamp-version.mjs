// Usage: node scripts/stamp-version.mjs 2026.10.27.42
// Stream Deck manifests need a four-part numeric version.
import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`Expected a version like 2026.10.27.42, got "${version}"`);
  process.exit(1);
}
const file = new URL('../com.github.m8i-51.genaiusage.sdPlugin/manifest.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.Version = version;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest Version = ${version}`);
