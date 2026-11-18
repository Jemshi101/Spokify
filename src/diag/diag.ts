const $ = (id: string) => document.getElementById(id)!;
const results: Record<string, any> = { browser: {}, page: {}, host: null, hostEnv: null, benchmarks: [] };
const sw = (msg: object) => chrome.runtime.sendMessage({ target: 'sw', ...msg });
const host = (payload: object) => sw({ type: 'host', payload });

function log(line: string) {
  $('log').textContent += line + '\n';
  $('log').scrollTop = 1e9;
}

const mark = (v: unknown) => (v === true ? '<span class="ok">yes</span>' : v === false ? '<span class="bad">no</span>' : String(v ?? '—'));

function renderEnv() {
  const w = results.hostEnv?.worker;
  const rows: [string, unknown][] = [
    ['Browser', results.browser.brands],
    ['chrome.offscreen API', results.page.offscreenApi],
    ['Audio host', results.host?.kind ?? '—'],
    ['CSS Custom Highlight API', results.page.highlights],
    ['Intl.Segmenter', results.page.segmenter],
    ['Cross-origin isolated (page / host / worker)', [results.page.crossOriginIsolated, results.hostEnv?.host.crossOriginIsolated, w?.crossOriginIsolated].map(mark).join(' / ')],
    ['WebGPU in worker', w ? !!w.adapter && !w.adapter.error : '…'],
    ['GPU adapter', w?.adapter ? [w.adapter.vendor, w.adapter.architecture].filter(Boolean).join(' · ') || 'present' : '—'],
    ['CPU threads', w?.hardwareConcurrency],
  ];
  $('env').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${typeof v === 'string' && v.includes('<span') ? v : mark(v)}</td></tr>`).join('');
}

async function checkEnv() {
  const ua = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } };
  const brands = ua.userAgentData?.brands.map((b) => `${b.brand} ${b.version}`).filter((b) => !/Not.?A.?Brand/i.test(b)).join(', ');
  results.browser = { brands: brands || navigator.userAgent, opera: /OPR\//.test(navigator.userAgent) };
  results.page = {
    offscreenApi: !!chrome.offscreen?.createDocument,
    highlights: 'highlights' in CSS,
    segmenter: typeof Intl.Segmenter === 'function',
    crossOriginIsolated: self.crossOriginIsolated,
  };
  renderEnv();
  try {
    const info = await sw({ type: 'hostInfo' });
    if (info?.error) throw new Error(info.error);
    results.host = info.host;
    log(`Audio host started as: ${info.host.kind}`);
    results.hostEnv = await host({ type: 'env' });
    if (results.hostEnv?.error) throw new Error(results.hostEnv.error);
  } catch (e) {
    log('Host error: ' + (e as Error).message);
  }
  renderEnv();
}

async function bench(engine: string, btn: HTMLButtonElement) {
  btn.disabled = true;
  log(`Benchmark ${engine}: loading (first run downloads the model)…`);
  const r = await host({ type: 'benchmark', engine });
  btn.disabled = false;
  if (r?.error) {
    log(`Benchmark ${engine} failed: ${r.error}`);
    results.benchmarks.push({ engine, error: r.error });
    return;
  }
  results.benchmarks.push(r);
  log(`Benchmark ${engine}: ${JSON.stringify(r)}`);
  const row = document.createElement('tr');
  row.innerHTML = `<td>${r.engine}${r.fallbackReason ? ' (fallback)' : ''}</td><td>${r.cached ? 'cached' : (r.loadMs / 1000).toFixed(1) + ' s'}</td>
    <td>${(r.genMs / 1000).toFixed(2)} s</td><td>${r.audioSec} s</td>
    <td class="${r.speedVsRealtime >= 1.5 ? 'ok' : 'bad'}">${r.speedVsRealtime}×</td>`;
  $('bench').appendChild(row);
}

document.querySelectorAll<HTMLButtonElement>('[data-engine]').forEach((b) => (b.onclick = () => bench(b.dataset.engine!, b)));

$('speak').onclick = async () => {
  $('speakInfo').textContent = 'Generating…';
  const r = await host({ type: 'speakSample', text: ($('sample') as HTMLTextAreaElement).value });
  $('speakInfo').textContent = r?.error ? 'Error: ' + r.error : `${r.audioSec} s of audio in ${r.genMs} ms (${r.speedVsRealtime}× realtime)`;
};

$('copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
  log('Copied results to clipboard.');
};

checkEnv();
