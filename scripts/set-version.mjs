// Usage: node scripts/set-version.mjs 1.2.3   (a leading "v" is stripped)
// Writes the version into manifest.json and package.json. AMO requires every
// signed upload to have a new, unique version.
import { readFileSync, writeFileSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  console.error(`Invalid version "${process.argv[2] ?? ''}". Expected e.g. 1.2.3`);
  process.exit(1);
}
for (const file of ['manifest.json', 'package.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
console.log(`Version set to ${version}`);
