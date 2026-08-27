// Flattens the app into one self-contained .html — no imports, no side files.
// Used for the shareable hosted build; `npm run bundle` writes dist/brick-kiosk.html.
//
// three.module.js ends in a single `export { ... }` of plain (unaliased) names,
// so turning it into a namespace object is a one-line rewrite: the export list
// is already valid object-literal shorthand, and `export {` becomes `return {`.
// It goes inside an IIFE rather than straight into the module scope — three has
// ~1500 top-level bindings and some (`clamp`) collide with src/main.js.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFile(join(ROOT, f), 'utf8');

// an inline <script> ends at the first `</script`, wherever it hides
const safe = js => js.replace(/<\/script/gi, '<\\/script');

// The output is one loose file with no <head> of its own to carry a charset —
// whoever hosts it decides the encoding, and a host that omits it renders "90°"
// as "90Â°". So emit pure ASCII and let the escapes carry the characters.
// `\uXXXX` means the same thing in every JS context (string, template, regex,
// comment); `&#N;` is the HTML equivalent.
const NON_ASCII = /[^\x00-\x7F]/g;
const HAS_NON_ASCII = /[^\x00-\x7F]/;   // separate: .test() on a /g regex is stateful
const asciiJS   = s => s.replace(NON_ASCII, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const asciiHTML = s => s.replace(NON_ASCII, c => '&#' + c.codePointAt(0) + ';');

const [three, main, css, html] = await Promise.all(
  ['vendor/three.module.js', 'src/main.js', 'src/style.css', 'index.html'].map(read));

const exportLine = /^export \{/m;
if (!exportLine.test(three)) throw new Error('vendor/three.module.js: no `export {` block to rewrite');
if (/\bas\b/.test(three.match(/^export \{[^\n]*/m)[0])) throw new Error('aliased exports need a real rewrite');

const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/\s*<script[\s\S]*?<\/script>\s*/g, '\n');
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];

// CSS has no universal escape that also works inside comments — but comments
// are the only place this stylesheet keeps non-ASCII, and a build artifact has
// no use for them, so they come out here.
const cssOut = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim();
if (HAS_NON_ASCII.test(cssOut)) throw new Error('style.css has non-ASCII outside a comment — no escape applied');

const out = `<title>${asciiHTML(title)}</title>
<style>
${cssOut}
</style>
${asciiHTML(body.trim())}
<script type="module">
const THREE = (() => {
${asciiJS(safe(three.replace(exportLine, 'return {')))}
})();
${asciiJS(safe(main.replace(/^import \* as THREE from .*$/m, '/* THREE is inlined above */')))}
</script>
`;
if (HAS_NON_ASCII.test(out)) throw new Error('bundle is not pure ASCII');

await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist', 'brick-kiosk.html'), out);
console.log(`dist/brick-kiosk.html  ${(out.length / 1024 / 1024).toFixed(2)} MB`);
