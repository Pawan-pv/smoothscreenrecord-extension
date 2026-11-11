import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function searchFiles(dir, pattern) {
  const matches = [];
  function walk(current) {
    for (const item of fs.readdirSync(current)) {
      const full = path.join(current, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (item !== 'node_modules' && item !== '.git') walk(full);
      } else {
        const content = fs.readFileSync(full, 'utf8');
        if (pattern.test(content)) {
          matches.push(full);
        }
      }
    }
  }
  walk(dir);
  return matches;
}

const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const webgpuInSrc = searchFiles(srcDir, /WebGPU/i);
const webgpuInDist = searchFiles(distDir, /WebGPU/i);
const reloaderInDist = searchFiles(distDir, /8989/);

console.log('=== FIX 4 RAW VERIFICATION EVIDENCE ===');
console.log('Occurrences of "WebGPU" in src/:', webgpuInSrc.length, webgpuInSrc);
console.log('Occurrences of "WebGPU" in dist/:', webgpuInDist.length, webgpuInDist);
console.log('Occurrences of "8989" (dev reloader) in dist/:', reloaderInDist.length, reloaderInDist);

if (webgpuInSrc.length === 0 && webgpuInDist.length === 0 && reloaderInDist.length === 0) {
  console.log('\n>>> FIX 4 RESULT: PASS <<<');
} else {
  console.log('\n>>> FIX 4 RESULT: FAIL <<<');
}
