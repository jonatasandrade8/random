'use strict';

// ============================================================
// CONSTANTES
// ============================================================
const GITHUB_URL = "https://raw.githubusercontent.com/jonatasandrade8/DATASUS/main/lotofacil-download-resultados.csv";
const ALPHA = 1.0;          // suavização bayesiana
const MIN_GATILHO = 30;     // nA mínimo para marcar como OK

// Demo com os últimos 100 concursos (3717–3816)
const DEMO_CSV = `Concurso,Data,Números
3717,22/06/2026,01,02,04,05,06,07,09,10,11,14,15,17,18,20,25
3718,23/06/2026,01,05,07,09,11,12,14,16,17,18,19,20,21,22,25
3719,25/06/2026,02,03,04,08,10,11,12,14,15,18,19,21,22,23,25
3720,26/06/2026,01,05,07,08,09,10,11,13,15,16,17,18,20,22,24
3721,27/06/2026,01,03,04,05,07,08,10,11,12,14,15,20,21,23,24
3722,29/06/2026,02,03,05,06,09,10,11,12,13,14,15,17,19,20,23
3723,30/06/2026,02,04,05,06,07,10,12,15,17,18,19,20,22,23,25
3724,01/07/2026,01,02,03,05,06,07,12,15,16,17,19,21,22,24,25
3725,02/07/2026,01,02,04,05,06,08,11,13,14,16,17,19,21,24,25
3726,03/07/2026,02,05,06,07,10,13,14,17,18,19,20,21,22,24,25
3727,04/07/2026,01,02,03,04,05,09,10,11,13,14,16,18,19,22,23
3728,06/07/2026,01,02,03,06,07,08,10,11,16,17,19,21,22,23,25
3729,07/07/2026,01,02,03,05,06,11,12,13,14,15,16,18,20,21,22
3730,08/07/2026,02,03,05,06,08,11,12,13,14,15,16,19,20,21,24
3731,09/07/2026,01,02,04,05,06,07,10,11,12,13,16,17,22,23,25
3732,10/07/2026,02,03,07,08,11,13,16,17,18,19,20,22,23,24,25
3733,11/07/2026,01,02,03,05,07,10,11,12,13,14,16,17,19,22,25
3734,13/07/2026,02,03,05,08,10,12,13,14,15,16,17,19,22,23,25
3735,14/07/2026,03,05,07,12,14,15,16,17,18,20,21,22,23,24,25
3736,15/07/2026,03,04,06,07,08,09,11,12,14,17,18,19,21,22,23
3737,16/07/2026,02,03,05,06,08,09,11,12,13,14,15,17,22,23,25
3738,17/07/2026,02,03,04,05,07,08,10,11,13,14,17,18,20,23,24
3739,19/07/2026,01,04,05,06,09,11,13,15,16,18,19,20,23,24,25
3740,20/07/2026,01,02,05,06,08,09,11,12,13,15,16,17,20,21,22
3741,21/07/2026,02,03,04,05,09,11,12,14,15,16,18,20,21,22,23
3742,22/07/2026,01,04,05,06,09,10,12,13,14,15,16,19,20,21,23
3743,23/07/2026,02,03,04,05,09,10,11,13,15,18,19,20,21,23,25
3744,24/07/2026,01,02,03,05,07,10,14,16,17,18,20,21,22,23,24
3745,26/07/2026,01,02,04,05,06,07,08,09,10,12,13,19,21,22,24
3746,27/07/2026,01,03,04,06,07,08,09,10,14,15,17,18,21,22,24
3747,28/07/2026,01,02,04,05,06,08,09,11,12,13,18,19,21,24,25
3748,29/07/2026,01,04,05,06,08,09,11,13,14,15,17,19,20,22,25
3749,30/07/2026,01,02,03,07,08,09,11,12,14,17,19,21,23,24,25
3750,31/07/2026,01,02,05,06,07,11,12,13,15,18,19,20,22,24,25
3751,02/08/2026,01,02,04,07,08,09,11,12,16,17,18,19,21,23,24
3752,03/08/2026,02,03,06,07,09,10,11,12,13,14,15,16,17,21,24
3753,04/08/2026,01,02,04,06,08,09,14,15,16,17,19,21,22,24,25
3754,05/08/2026,01,03,04,05,07,08,11,12,13,14,16,20,21,23,25
3755,06/08/2026,03,04,05,07,08,09,11,12,16,18,20,22,23,24,25
3756,07/08/2026,02,03,05,06,09,10,11,13,14,15,16,19,20,21,22
3757,09/08/2026,01,02,03,04,06,08,11,12,15,17,20,21,22,23,24
3758,10/08/2026,01,03,04,05,08,09,11,12,13,14,17,18,20,24,25
3759,11/08/2026,01,02,04,05,06,07,09,10,11,12,13,14,17,24,25
3760,12/08/2026,02,04,05,08,09,10,11,13,14,16,19,21,22,24,25
3761,13/08/2026,01,03,06,09,12,13,14,15,16,17,18,21,23,24,25
3762,14/08/2026,01,02,03,04,05,06,09,10,13,16,18,21,22,23,25
3763,16/08/2026,01,02,03,04,05,08,09,14,15,17,20,21,22,23,24
3764,17/08/2026,02,03,04,05,06,07,08,09,12,13,15,18,21,22,25
3765,18/08/2026,01,05,06,10,11,12,13,15,16,17,19,21,22,24,25
3766,19/08/2026,01,02,03,05,08,09,11,13,14,16,17,19,21,23,24
3767,20/08/2026,02,04,06,07,09,10,11,13,14,15,16,20,21,22,23
3768,21/08/2026,02,03,04,05,06,07,10,11,12,14,15,17,20,23,24
3769,23/08/2026,01,02,03,04,05,09,10,11,15,16,17,21,23,24,25
3770,24/08/2026,01,02,04,07,08,12,13,15,16,17,18,19,23,24,25
3771,25/08/2026,02,03,04,05,09,10,11,12,15,16,17,18,21,23,25
3772,26/08/2026,03,05,06,07,08,09,11,12,14,15,18,20,21,23,25
3773,27/08/2026,03,04,07,09,11,13,14,15,17,18,20,21,22,24,25
3774,28/08/2026,01,03,04,05,06,07,09,12,14,15,16,18,19,23,24
3775,30/08/2026,01,04,05,06,08,10,11,12,13,15,17,18,19,23,25
3776,31/08/2026,03,05,07,08,10,14,16,17,18,19,20,21,23,24,25
3777,01/09/2026,03,05,07,08,09,10,12,13,15,19,20,21,22,24,25
3778,02/09/2026,01,02,03,05,06,08,09,10,13,14,16,17,18,20,22
3779,03/09/2026,03,04,05,07,08,10,11,13,14,16,17,19,23,24,25
3780,15/09/2026,01,02,03,04,05,06,07,12,15,16,17,19,21,22,23
3781,16/09/2026,03,05,06,07,08,09,11,12,13,16,19,21,22,24,25
3782,17/09/2026,03,04,05,07,08,11,15,16,17,18,19,20,22,23,25
3783,18/09/2026,01,03,04,05,06,12,14,15,16,17,19,22,23,24,25
3784,20/09/2026,01,02,08,10,11,12,15,16,18,19,20,21,22,24,25
3785,21/09/2026,01,04,07,08,11,12,14,15,17,18,19,22,23,24,25
3786,22/09/2026,01,03,06,07,08,09,12,13,14,16,18,21,23,24,25
3787,23/09/2026,03,04,06,08,10,11,12,13,15,17,19,20,22,23,24
3788,24/09/2026,01,04,05,07,08,09,12,16,17,18,20,21,22,23,24
3789,25/09/2026,06,07,08,09,11,12,13,14,15,16,17,18,19,23,25
3790,27/09/2026,01,03,04,05,06,07,09,11,14,15,16,17,20,21,25
3791,28/09/2026,01,02,04,06,08,09,11,12,13,14,15,16,19,24,25
3792,29/09/2026,02,04,06,07,08,10,11,12,14,15,16,20,23,24,25
3793,30/09/2026,01,03,07,08,10,11,13,14,15,17,19,20,21,24,25
3794,01/10/2026,01,03,04,05,06,08,10,12,13,15,18,19,21,23,24
3795,02/10/2026,01,03,04,05,06,08,10,11,12,13,14,18,19,22,24
3796,03/10/2026,03,04,05,06,07,09,10,11,12,15,16,19,20,21,24
3797,05/10/2026,01,02,03,06,07,08,09,10,13,14,16,18,19,20,23
3798,06/10/2026,01,02,04,05,06,07,08,09,10,11,14,18,19,20,23
3799,07/10/2026,01,03,04,05,07,08,10,12,13,18,19,20,23,24,25
3800,08/10/2026,01,02,03,04,05,07,08,09,10,12,13,14,15,19,21
3801,09/10/2026,03,04,07,08,09,11,12,13,15,17,19,20,21,23,24
3802,11/10/2026,02,03,05,06,09,10,11,12,14,15,19,20,21,23,24
3803,13/10/2026,03,06,07,08,09,11,12,13,15,16,19,20,21,22,23
3804,14/10/2026,01,02,06,07,08,12,14,15,16,17,18,19,21,24,25
3805,15/10/2026,03,05,06,07,08,10,11,13,14,15,19,22,23,24,25
3806,16/10/2026,04,05,06,07,08,09,11,13,16,19,20,21,23,24,25
3807,18/10/2026,01,03,04,07,10,11,13,16,17,19,20,22,23,24,25
3808,19/10/2026,01,04,07,10,12,13,14,15,17,18,19,20,21,22,24
3809,20/10/2026,01,03,04,05,06,08,09,11,17,18,19,20,21,23,25
3810,21/10/2026,01,05,06,07,10,11,14,15,16,17,18,19,20,23,24
3811,22/10/2026,01,03,05,07,08,09,10,11,12,15,16,18,19,23,25
3812,23/10/2026,03,04,05,07,08,11,13,16,17,19,20,21,23,24,25
3813,24/10/2026,04,05,06,08,10,12,13,14,15,16,17,20,22,23,25
3814,26/10/2026,01,04,06,08,09,12,13,15,16,17,18,21,22,24,25
3815,27/10/2026,03,05,06,09,10,11,12,13,14,15,16,17,19,23,25
3816,28/10/2026,01,02,03,04,06,08,13,14,16,17,18,20,22,24,25`;

// ============================================================
// ESTADO
// ============================================================
const state = {
  draws: [],
  lastGame: new Set(),
  trigger: 'q1',
  nPick: 15,
  analysis: null,
  bitsets: null,      // Uint32Array para cálculos rápidos
  marg: null,         // frequências marginais {x: count}
};

// ============================================================
// PARSER UNIVERSAL (CSV / TSV / ; / espaço)
// ============================================================
function parseAnyDelimited(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];

  const first = lines[0];
  let sep;
  if (first.includes('\t')) sep = /\t+/;
  else if (first.includes(';')) sep = /\s*;\s*/;
  else if (first.includes(',')) sep = /\s*,\s*/;
  else sep = /\s+/;

  let start = 0;
  if (!/^\s*\d+/.test(first)) start = 1;

  const draws = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(s => s.trim());
    if (parts.length < 3) continue;

    const conc = parseInt(parts[0], 10);
    if (isNaN(conc)) continue;

    const nums = [];
    for (let j = 1; j < parts.length; j++) {
      const v = parseInt(parts[j], 10);
      if (!isNaN(v) && v >= 1 && v <= 25) nums.push(v);
    }
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    if (uniq.length === 15) draws.push({ concurso: conc, nums: uniq });
  }
  draws.sort((a, b) => a.concurso - b.concurso);
  return draws;
}

// ============================================================
// BITSETS PARA PERFORMANCE
// ============================================================
function buildBitsets(draws) {
  const bits = new Uint32Array(draws.length);
  for (let i = 0; i < draws.length; i++) {
    let b = 0;
    for (const x of draws[i].nums) b |= (1 << (x - 1));
    bits[i] = b;
  }
  return bits;
}

function buildMarginal(draws) {
  const marg = {};
  for (let x = 1; x <= 25; x++) marg[x] = 0;
  for (const d of draws) for (const x of d.nums) marg[x]++;
  return marg;
}

// ============================================================
// MODELO
// ============================================================
function probEsperada(k) {
  if (k >= 15) return 0;
  return (15 - k) / (25 - k);
}

function maskFromA(A) {
  let m = 0;
  for (const a of A) m |= (1 << (a - 1));
  return m;
}

function condicionalFast(A, x, alpha = ALPHA) {
  const bits = state.bitsets;
  const maskA = maskFromA(A);
  const bitX = 1 << (x - 1);
  let nA = 0, c = 0;
  for (let i = 0; i < bits.length; i++) {
    if ((bits[i] & maskA) === maskA) {
      nA++;
      if (bits[i] & bitX) c++;
    }
  }
  const k = A.length;
  const e = probEsperada(k);
  if (nA === 0) return { nA: 0, c: 0, p_obs: null, p: e, lift: null, e };
  const p_obs = c / nA;
  const p = (c + alpha * e) / (nA + alpha);
  const lift = e > 0 ? p / e : null;
  return { nA, c, p_obs, p, lift, e };
}

// ============================================================
// CARREGAMENTO
// ============================================================
async function loadFromURL(url) {
  setStatus('Carregando dados do GitHub…', 'info');
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} (verifique se a URL é raw)`);
    const text = await r.text();
    const draws = parseAnyDelimited(text);
    if (!draws.length) throw new Error('CSV sem sorteios válidos');
    state.draws = draws;
    onDataLoaded();
    setStatus(`✓ ${draws.length} concursos carregados do GitHub.`, 'success');
  } catch (e) {
    setStatus(`Erro ao carregar: ${e.message}. Usando demo local.`, 'error');
    loadDemo();
  }
}

function loadFromFile(file) {
  setStatus('Lendo arquivo…', 'info');
  const reader = new FileReader();
  reader.onload = () => {
    const draws = parseAnyDelimited(reader.result);
    if (!draws.length) { setStatus('Nenhum sorteio válido no arquivo.', 'error'); return; }
    state.draws = draws;
    onDataLoaded();
    setStatus(`✓ ${draws.length} concursos carregados do arquivo.`, 'success');
  };
  reader.onerror = () => setStatus('Erro ao ler arquivo.', 'error');
  reader.readAsText(file, 'utf-8');
}

function loadDemo() {
  const draws = parseAnyDelimited(DEMO_CSV);
  state.draws = draws;
  onDataLoaded();
  setStatus(`✓ ${draws.length} concursos (demo) carregados.`, 'success');
}

function onDataLoaded() {
  // Pré-computa bitsets e marginais
  state.bitsets = buildBitsets(state.draws);
  state.marg = buildMarginal(state.draws);

  const last = state.draws[state.draws.length - 1];
  setStatus(`✓ ${state.draws.length} concursos carregados (último: ${last.concurso}).`, 'success');

  // Auto-preenche o último jogo
  state.lastGame = new Set(last.nums);
  renderLastGameGrid();

  document.getElementById('analyze').disabled = false;

  if (state.draws.length > 1000) {
    document.getElementById('perf-note').style.display = 'block';
  }
}

function setStatus(msg, type) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.className = 'status ' + (type || '');
}

// ============================================================
// ANÁLISE
// ============================================================
function getTriggerNumbers() {
  if (state.trigger === 'q1') {
    return [...state.lastGame].filter(x => x <= 5).sort((a, b) => a - b);
  }
  if (state.trigger === 'none') return [];
  if (state.trigger === 'all-q1') return [1, 2, 3, 4, 5];
  return [];
}

function analyze() {
  if (!state.draws.length) return;

  const A = getTriggerNumbers();

  const scores = [];
  for (let x = 1; x <= 25; x++) {
    const s = condicionalFast(A, x);
    scores.push({
      x,
      p: s.p,
      p_obs: s.p_obs,
      nA: s.nA,
      c: s.c,
      lift: s.lift,
      conf: s.nA >= MIN_GATILHO ? 'OK' : 'BAIXA',
      inTrigger: A.includes(x),
    });
  }

  const sorted = [...scores].sort((a, b) => b.p - a.p);
  const top = sorted.slice(0, state.nPick);
  const topSet = new Set(top.map(s => s.x));
  const expected = top.reduce((acc, s) => acc + s.p, 0);

  // Distribuição histórica condicionada ao gatilho
  const maskA = maskFromA(A);
  let topMask = 0;
  for (const x of topSet) topMask |= (1 << (x - 1));

  const dist = {};
  for (let k = 0; k <= state.nPick; k++) dist[k] = 0;
  let nA = 0;
  const bits = state.bitsets;
  for (let i = 0; i < bits.length; i++) {
    if ((bits[i] & maskA) === maskA) {
      nA++;
      let hits = 0;
      let m = bits[i] & topMask;
      while (m) { m &= m - 1; hits++; }
      dist[hits] = (dist[hits] || 0) + 1;
    }
  }

  const totalHist = nA || 1;
  const pGE = (t) => {
    if (!nA) return null;
    let s = 0;
    for (let k = t; k <= state.nPick; k++) s += dist[k] || 0;
    return s / totalHist;
  };

  state.analysis = {
    A, scores: sorted, top, topSet, expected,
    nA, dist, totalHist,
    e: probEsperada(A.length),
    p11: pGE(11), p12: pGE(12), p13: pGE(13),
  };

  renderResults();
}

// ============================================================
// RENDER
// ============================================================
function renderLastGameGrid() {
  const grid = document.getElementById('last-game-grid');
  grid.innerHTML = '';
  for (let x = 1; x <= 25; x++) {
    const btn = document.createElement('button');
    btn.textContent = String(x).padStart(2, '0');
    btn.className = 'num-btn';
    btn.dataset.num = x;
    btn.addEventListener('click', () => toggleLastGame(x, btn));
    if (state.lastGame.has(x)) btn.classList.add('selected');
    grid.appendChild(btn);
  }
  updateSelectedCount();
}

function toggleLastGame(x, btn) {
  if (state.lastGame.has(x)) {
    state.lastGame.delete(x);
    btn.classList.remove('selected');
  } else {
    if (state.lastGame.size >= 15) return;
    state.lastGame.add(x);
    btn.classList.add('selected');
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById('selected-count').textContent = state.lastGame.size;
}

function renderResults() {
  const a = state.analysis;
  document.getElementById('results-section').style.display = 'block';

  document.getElementById('results-summary').innerHTML = `
    <div><strong>Gatilho:</strong> ${a.A.length ? a.A.map(n => String(n).padStart(2, '0')).join(', ') : '—'}</div>
    <div><strong>Nº de dezenas no gatilho:</strong> ${a.A.length}</div>
    <div><strong>Concursos com esse gatilho:</strong> ${a.nA}</div>
    <div><strong>Expectativa base por número:</strong> ${(a.e * 100).toFixed(2)}%</div>
  `;

  // Heatmap ordenado por número
  const heat = document.getElementById('heatmap');
  heat.innerHTML = '';
  const byNum = [...a.scores].sort((x, y) => x.x - y.x);
  const maxP = Math.max(...a.scores.map(s => s.p));
  const minP = Math.min(...a.scores.map(s => s.p));
  const range = maxP - minP || 0.01;

  for (const s of byNum) {
    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    const t = (s.p - minP) / range;
    const r = Math.round(50 + 205 * t);
    const g = Math.round(120 - 60 * t);
    const b = Math.round(255 - 205 * t);
    cell.style.backgroundColor = `rgb(${r},${g},${b})`;
    cell.innerHTML = `<div class="heat-num">${String(s.x).padStart(2, '0')}</div>
                      <div class="heat-p">${(s.p * 100).toFixed(1)}%</div>`;
    cell.title = `Dezena ${s.x}: P=${(s.p * 100).toFixed(2)}% (nA=${s.nA}, lift=${s.lift?.toFixed(2) ?? '—'})`;
    if (a.topSet.has(s.x)) cell.classList.add('top');
    heat.appendChild(cell);
  }

  // Bar chart top 15
  const bar = document.getElementById('bar-chart');
  bar.innerHTML = '';
  const top15 = a.scores.slice(0, 15);
  const maxBar = Math.max(...top15.map(s => s.p), 0.01);
  for (const s of top15) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label">${String(s.x).padStart(2, '0')}</div>
      <div class="bar-track"><div class="bar-fill ${a.topSet.has(s.x) ? 'in-top' : ''}" style="width:${(s.p / maxBar) * 100}%"></div></div>
      <div class="bar-val">${(s.p * 100).toFixed(1)}%</div>
    `;
    bar.appendChild(row);
  }

  // Recomendação
  document.getElementById('rec-count').textContent = state.nPick;
  const rec = document.getElementById('recommendation-grid');
  rec.innerHTML = '';
  const recSorted = [...a.top].sort((x, y) => x.x - y.x);
  for (const s of recSorted) {
    const div = document.createElement('div');
    div.className = 'rec-num';
    div.textContent = String(s.x).padStart(2, '0');
    div.dataset.p = `${(s.p * 100).toFixed(0)}%`;
    div.title = `P=${(s.p * 100).toFixed(2)}%`;
    rec.appendChild(div);
  }

  // Estatísticas
  const avg = a.top.reduce((acc, s) => acc + s.p, 0) / a.top.length;
  document.getElementById('avg-prob').textContent = `${(avg * 100).toFixed(2)}%`;
  document.getElementById('expected-hits').textContent = a.expected.toFixed(2);
  document.getElementById('p11').textContent = a.p11 !== null ? `${(a.p11 * 100).toFixed(2)}%` : '—';
  document.getElementById('p12').textContent = a.p12 !== null ? `${(a.p12 * 100).toFixed(2)}%` : '—';
  document.getElementById('p13').textContent = a.p13 !== null ? `${(a.p13 * 100).toFixed(2)}%` : '—';

  // Distribuição
  document.getElementById('n-pick-dist').textContent = state.nPick;
  const distEl = document.getElementById('dist-chart');
  distEl.innerHTML = '';
  const maxDist = Math.max(...Object.values(a.dist), 1);
  for (let k = 0; k <= state.nPick; k++) {
    const v = a.dist[k] || 0;
    const pct = (v / a.totalHist) * 100;
    const row = document.createElement('div');
    row.className = 'dist-row';
    row.innerHTML = `
      <div class="dist-label">${k}</div>
      <div class="dist-track"><div class="dist-fill" style="width:${(v / maxDist) * 100}%"></div></div>
      <div class="dist-val">${v} (${pct.toFixed(2)}%)</div>
    `;
    distEl.appendChild(row);
  }

  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
}

// ============================================================
// WIRING
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('load-url').addEventListener('click', () => {
    const url = document.getElementById('csv-url').value.trim();
    if (url) loadFromURL(url);
  });

  document.getElementById('csv-file').addEventListener('change', e => {
    if (e.target.files[0]) loadFromFile(e.target.files[0]);
  });

  document.getElementById('load-demo').addEventListener('click', loadDemo);

  document.getElementById('clear-selection').addEventListener('click', () => {
    state.lastGame.clear();
    document.querySelectorAll('#last-game-grid .num-btn.selected')
      .forEach(b => b.classList.remove('selected'));
    updateSelectedCount();
  });

  document.getElementById('auto-last').addEventListener('click', () => {
    if (!state.draws.length) return;
    const last = state.draws[state.draws.length - 1];
    state.lastGame = new Set(last.nums);
    document.querySelectorAll('#last-game-grid .num-btn').forEach(b => {
      b.classList.toggle('selected', state.lastGame.has(parseInt(b.dataset.num)));
    });
    updateSelectedCount();
  });

  document.getElementById('trigger-select').addEventListener('change', e => {
    state.trigger = e.target.value;
  });

  document.getElementById('n-pick').addEventListener('input', e => {
    state.nPick = parseInt(e.target.value, 10);
    document.getElementById('n-pick-value').textContent = state.nPick;
    if (state.analysis) analyze();
  });

  document.getElementById('analyze').addEventListener('click', analyze);

  renderLastGameGrid();

  // Carregamento automático do GitHub na inicialização
  const url = document.getElementById('csv-url').value.trim();
  if (url) loadFromURL(url);
  else loadDemo();
});