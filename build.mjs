import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/ort', { recursive: true });

cpSync('static', 'dist', { recursive: true });
// ONNX Runtime WebAssembly files ship inside the extension: MV3 forbids remote code.
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/@huggingface/transformers/dist/${f}`, `dist/ort/${f}`);
}
// pdf.js worker and data files for the PDF viewer.
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdfjs/pdf.worker.mjs');
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(`node_modules/pdfjs-dist/${d}`, `dist/pdfjs/${d}`, { recursive: true });
cpSync('node_modules/pdfjs-dist/web/pdf_viewer.css', 'dist/pdf.css');

const common = { bundle: true, platform: 'browser', target: 'chrome128', logLevel: 'info', legalComments: 'none' };
const builds = [
  {
    ...common,
    format: 'esm',
    outdir: 'dist',
    entryNames: '[name]',
    entryPoints: {
      sw: 'src/background/sw.ts',
      host: 'src/host/host.ts',
      worker: 'src/engine/worker.ts',
      popup: 'src/popup/popup.ts',
      diag: 'src/diag/diag.ts',
      pdf: 'src/pdf/viewer.ts',
      welcome: 'src/welcome/welcome.ts',
      docs: 'src/docs/viewer.ts',
    },
  },
  { ...common, format: 'iife', outdir: 'dist', entryPoints: { content: 'src/content/index.ts' } },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
