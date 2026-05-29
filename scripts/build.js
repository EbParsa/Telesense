#!/usr/bin/env node
/**
 * build.js — zero-dep build pipeline for Telesense
 * Produces:
 *   dist/tele.umd.js      — UMD (browser <script> + CommonJS require)
 *   dist/tele.umd.min.js  — minified UMD
 *   dist/tele.esm.js      — ES module (import)
 *   dist/tele.d.ts        — TypeScript declarations (copied)
 */

const fs   = require('fs');
const path = require('path');

const SRC     = path.join(__dirname, '../src/Telesense');
const TYPES   = path.join(__dirname, '../src/tele.d.ts');
const DIST    = path.join(__dirname, '../dist');

// ── read source ──────────────────────────────────────────────────────────────

const src = fs.readFileSync(SRC, 'utf-8');

// ── UMD (already written as UMD in src) ─────────────────────────────────────

const umd = src;

// ── ESM — strip the UMD wrapper, export the factory result ──────────────────

const esmBody = src
  // Remove the UMD wrapper lines
  .replace(/^\/\*![\s\S]*?\*\/\n/, '')                     // strip banner comment
  .replace(/\(function \(global, factory\) \{[\s\S]*?\}\)\(this, function \(\) \{/, '') // strip UMD header
  .replace(/\}\);?\s*$/, '');                               // strip UMD footer

const esm = `// Telesense v1.0.0 — ESM build
// https://github.com/EbParsa/Telesense  |  MIT License

${esmBody.trim()}

export { createTele };
export default defaultInstance;
`;

// ── minifier — simple but solid: strips comments, collapses whitespace ───────

function minify(code) {
  return code
    // Remove multi-line comments (but not /*! banners)
    .replace(/\/\*(?!!)[^]*?\*\//g, '')
    // Remove single-line comments (not URLs)
    .replace(/(?<!['"https:])\/\/[^\n]*/g, '')
    // Collapse whitespace / newlines
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    // Tighten common patterns
    .replace(/ \{ /g, '{').replace(/ \} /g, '}')
    .replace(/ = /g, '=').replace(/ \+ /g, '+')
    .replace(/; \n/g, ';').replace(/,\n/g, ',')
    .trim();
}

const banner = `/*! Telesense v1.0.0 | MIT | https://github.com/EbParsa/Telesense */\n`;
const umdMin = banner + minify(umd);

// ── write ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'tele.umd.js'),     umd,    'utf-8');
fs.writeFileSync(path.join(DIST, 'tele.umd.min.js'), umdMin, 'utf-8');
fs.writeFileSync(path.join(DIST, 'tele.esm.js'),     esm,    'utf-8');
fs.copyFileSync(TYPES, path.join(DIST, 'tele.d.ts'));

// ── report ───────────────────────────────────────────────────────────────────

const sizes = ['tele.umd.js', 'tele.umd.min.js', 'tele.esm.js'].map(f => {
  const bytes = fs.statSync(path.join(DIST, f)).size;
  return `  ${f.padEnd(22)} ${bytes.toLocaleString().padStart(7)} bytes  (${(bytes/1024).toFixed(1)} kB)`;
});

console.log('\n✅ Build complete:\n' + sizes.join('\n') + '\n');

// ── watch mode ───────────────────────────────────────────────────────────────

if (process.argv.includes('--watch')) {
  console.log('👀 Watching src/Telesense …');
  fs.watch(SRC, () => {
    console.log('  → rebuilding…');
    try {
      const fresh = fs.readFileSync(SRC, 'utf-8');
      fs.writeFileSync(path.join(DIST, 'tele.umd.js'), fresh, 'utf-8');
      fs.writeFileSync(path.join(DIST, 'tele.umd.min.js'), banner + minify(fresh), 'utf-8');
      console.log('  ✓ done');
    } catch (e) {
      console.error('  ✗ build error:', e.message);
    }
  });
}
