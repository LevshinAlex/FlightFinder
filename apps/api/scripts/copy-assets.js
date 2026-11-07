// Copies non-TS assets (airport directory JSON) into dist.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src', 'airports', 'data');
const dst = path.join(__dirname, '..', 'dist', 'airports', 'data');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
