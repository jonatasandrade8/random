'use strict';

// ============================================================
// CONSTANTES
// ============================================================
const GITHUB_URL = "https://raw.githubusercontent.com/jonatasandrade8/DATASUS/main/lotofacil-download-resultados.csv";
const ALPHA = 1.0;
const MIN_GATILHO = 30;
const BET_VALUE = 3.5;
const PRIZE_TABLE = { 11: 6, 12: 14, 13: 30, 14: 2000, 15: 1700000 };

// Quadrantes (1-5, 6-10, ...)
const QUADRANTS = [
  { id: 'q1', label: 'Q1 (1–5)',   nums: [1, 2, 3, 4, 5] },
  { id: 'q2', label: 'Q2 (6–10)',  nums: [6, 7, 8, 9, 10] },
  { id: 'q3', label: 'Q3 (11–15)', nums: [11, 12, 13, 14, 15] },
  { id: 'q4', label: 'Q4 (16–20)', nums: [16, 17, 18, 19, 20] },
  { id: 'q5', label: 'Q5 (21–25)', nums: [21, 22, 23, 24, 25] },
];

const SCALES_TO_TEST = [1, 2, 3, 5, 10, 20, 50];
const STRATEGY_KEYS = ['condicional', 'marginal', 'balanceada', 'aleatorio'];
const STRATEGY_NAMES = {
  condicional: 'Condicional (Q1 do último jogo)',
  marginal: 'Frequência histórica',
  balanceada: 'Cobertura balanceada',
  aleatorio: 'Aleatória (baseline)',
};

// ============================================================
// ESTADO
// ============================================================
const state = {
  draws: [],
  lastGame: new Set(),
  trigger: 'q1',
  nPick: 15,
  analysis: null,
  bitsets: null,
  marg: null,
  generatedGames: null,
  simulation: null,
  backtest: null,
  scaleTest: null,
  quadrantHeat: null,
};

// ============================================================
// PARSER UNIVERSAL
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
  if (!/^\s*\d+\s*[,;\t ]/.test(first)) start = 1;

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
// BITSETS E MARGINAIS
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
// MODELO PROBABILÍSTICO
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

function condicionalFast(A, x, alpha = ALPHA, bitsets = null, marg = null) {
  const bits = bitsets || state.bitsets;
  const m = marg || state.marg;

  if (A.length === 0) {
    const nA = bits.length;
    const c = m[x];
    const e = 15 / 25;
    const p_obs = c / nA;
    const p = (c + alpha * e) / (nA + alpha);
    return { nA, c, p_obs, p, lift: p / e, e };
  }

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

function computeProbsForTraining(trainDraws, A, alpha = ALPHA) {
  const bits = buildBitsets(trainDraws);
  const marg = buildMarginal(trainDraws);
  const probs = {};
  for (let x = 1; x <= 25; x++) {
    probs[x] = condicionalFast(A, x, alpha, bits, marg).p;
  }
  return probs;
}

// ============================================================
// RNG
// ============================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// POISSON-BINOMIAL
// ============================================================
function poissonBinomial(pList) {
  let dist = [1];
  for (const p of pList) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

// ============================================================
// GERAÇÃO DE JOGOS DIVERSIFICADOS
// ============================================================
function generateGames(X, scores, nPick = 15, maxOverlap = 10, seed = 42) {
  const rng = mulberry32(seed);
  const sortedScores = [...scores].sort((a, b) => b.p - a.p);
  const weights = sortedScores.map(s => Math.max(s.p, 1e-6));
  const games = [];
  const seen = new Set();

  const overlap = (a, b) => {
    const sb = new Set(b);
    let c = 0;
    for (const x of a) if (sb.has(x)) c++;
    return c;
  };

  let attempts = 0;
  const maxAttempts = X * 500;

  while (games.length < X && attempts < maxAttempts) {
    attempts++;
    const keyed = sortedScores.map((s, i) => ({
      x: s.x,
      key: Math.pow(rng(), 1 / weights[i]),
    }));
    keyed.sort((a, b) => b.key - a.key);
    const game = keyed.slice(0, nPick).map(k => k.x).sort((a, b) => a - b);
    const key = game.join(',');
    if (seen.has(key)) continue;
    if (games.some(g => overlap(g, game) > maxOverlap)) continue;
    seen.add(key);
    games.push(game);
  }

  if (games.length < X) {
    const relaxed = generateGamesRelaxed(X - games.length, scores, nPick, seed + 1, seen);
    games.push(...relaxed);
  }
  return games;
}

function generateGamesRelaxed(X, scores, nPick, seed, seen) {
  const rng = mulberry32(seed);
  const sortedScores = [...scores].sort((a, b) => b.p - a.p);
  const weights = sortedScores.map(s => Math.max(s.p, 1e-6));
  const games = [];
  let attempts = 0;
  while (games.length < X && attempts < X * 200) {
    attempts++;
    const keyed = sortedScores.map((s, i) => ({
      x: s.x,
      key: Math.pow(rng(), 1 / weights[i]),
    }));
    keyed.sort((a, b) => b.key - a.key);
    const game = keyed.slice(0, nPick).map(k => k.x).sort((a, b) => a - b);
    const key = game.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(game);
  }
  return games;
}

// ============================================================
// SIMULAÇÃO CONSECUTIVA
// ============================================================
function simulateConsecutive(games, M, probsByNum, betValue = BET_VALUE) {
  const gameDists = games.map(g => poissonBinomial(g.map(x => probsByNum[x])));
  let pNonePerDraw = 1;
  let evPerDraw = 0;
  const evByGame = [];
  for (const d of gameDists) {
    const pWin = d.slice(11).reduce((a, b) => a + b, 0);
    pNonePerDraw *= (1 - pWin);
    let ev = 0;
    for (let k = 11; k <= 15; k++) ev += (d[k] || 0) * (PRIZE_TABLE[k] || 0);
    evByGame.push(ev);
    evPerDraw += ev;
  }
  const pWinPerDraw = 1 - pNonePerDraw;
  const pWinM = 1 - Math.pow(1 - pWinPerDraw, M);
  return {
    pWinPerDraw, pWinM, evPerDraw, evTotal: evPerDraw * M,
    costTotal: games.length * M * betValue, gameDists, evByGame,
  };
}

// ============================================================
// ESTRATÉGIAS
// ============================================================
function strategyConditional(trainDraws, lastDraw, nGames, seed) {
  const A = lastDraw.nums.filter(x => x <= 5);
  const probs = computeProbsForTraining(trainDraws, A);
  const scores = Object.entries(probs).map(([x, p]) => ({ x: +x, p }));
  return { games: generateGames(nGames, scores, 15, 10, seed), A, probs };
}

function strategyMarginal(trainDraws, lastDraw, nGames, seed) {
  const probs = computeProbsForTraining(trainDraws, []);
  const scores = Object.entries(probs).map(([x, p]) => ({ x: +x, p }));
  return { games: generateGames(nGames, scores, 15, 10, seed), A: [], probs };
}

function strategyBalanced(trainDraws, lastDraw, nGames, seed) {
  const probs = computeProbsForTraining(trainDraws, []);
  const rng = mulberry32(seed);
  const games = [];
  const all = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let g = 0; g < nGames; g++) {
    const start = (g * 7) % 25;
    const rotated = [];
    for (let i = 0; i < 15; i++) rotated.push(all[(start + i) % 25]);
    games.push(rotated.sort((a, b) => a - b));
  }
  const scores = Object.entries(probs).map(([x, p]) => ({ x: +x, p }));
  const extra = generateGames(Math.max(0, nGames - games.length), scores, 15, 8, seed + 100);
  games.push(...extra.slice(0, nGames - games.length));
  return { games: games.slice(0, nGames), A: [], probs };
}

function strategyRandom(trainDraws, lastDraw, nGames, seed) {
  const rng = mulberry32(seed);
  const games = [];
  const seen = new Set();
  const all = Array.from({ length: 25 }, (_, i) => i + 1);
  let attempts = 0;
  while (games.length < nGames && attempts < nGames * 200) {
    attempts++;
    const g = shuffle(all, rng).slice(0, 15).sort((a, b) => a - b);
    const key = g.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(g);
  }
  const probs = {};
  for (let x = 1; x <= 25; x++) probs[x] = 15 / 25;
  return { games, A: [], probs };
}

const STRATEGIES = {
  condicional: strategyConditional,
  marginal: strategyMarginal,
  balanceada: strategyBalanced,
  aleatorio: strategyRandom,
};

// ============================================================
// ESTATÍSTICA — funções auxiliares
// ============================================================
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1 || 1));
}

// p-valor bilateral aproximado para t-test (normal para N grande)
function tTestPValue(t, df) {
  // Aproximação via normal padrão (df grande)
  const z = Math.abs(t);
  // erf aproximada
  const erf = (x) => {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t1 = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t1 + a4) * t1) + a3) * t1 + a2) * t1 + a1) * t1 * Math.exp(-x * x);
    return sign * y;
  };
  const p = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
  return 2 * p;
}

// Cohen's d
function cohensD(a, b) {
  const ma = mean(a), mb = mean(b);
  const sa = std(a), sb = std(b);
  const pooled = Math.sqrt((sa * sa + sb * sb) / 2) || 1e-9;
  return (ma - mb) / pooled;
}

// Correção de Bonferroni
function bonferroni(pValues, alpha = 0.05) {
  const m = pValues.length;
  return pValues.map(p => Math.min(1, p * m));
}

// Correção FDR (Benjamini-Hochberg)
function fdrBH(pValues, alpha = 0.05) {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const val = Math.min(prev, indexed[k].p * m / (k + 1));
    adjusted[indexed[k].i] = val;
    prev = val;
  }
  return adjusted;
}

// ============================================================
// MAPA DE CALOR POR QUADRANTES
// ============================================================
// Para cada quadrante, conta quantas dezenas dele saíram em cada sorteio.
// Acumula distribuição (0..5) e média histórica.
function computeQuadrantHeat(draws) {
  const result = {};
  for (const q of QUADRANTS) {
    const dist = [0, 0, 0, 0, 0, 0];
    let sum = 0;
    for (const d of draws) {
      const set = new Set(d.nums);
      let c = 0;
      for (const x of q.nums) if (set.has(x)) c++;
      dist[c]++;
      sum += c;
    }
    result[q.id] = {
      label: q.label,
      nums: q.nums,
      dist,
      mean: sum / draws.length,
      totalDraws: draws.length,
      pAny: 1 - dist[0] / draws.length,
      p2plus: 1 - (dist[0] + dist[1]) / draws.length,
      p3plus: 1 - (dist[0] + dist[1] + dist[2]) / draws.length,
      p4plus: 1 - (dist[0] + dist[1] + dist[2] + dist[3]) / draws.length,
      p5: dist[5] / draws.length,
    };
  }
  // Referência teórica: hipergeométrica(15, 5, 25)
  // P(X=k) = C(5,k)*C(20,15-k)/C(25,15)
  const hyper = (k) => {
    const C = (n, r) => {
      if (r < 0 || r > n) return 0;
      let v = 1;
      for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1);
      return v;
    };
    return C(5, k) * C(20, 15 - k) / C(25, 15);
  };
  const theoretical = [0, 1, 2, 3, 4, 5].map(hyper);
  const theoreticalMean = theoretical.reduce((a, p, k) => a + k * p, 0);

  return { quadrants: result, theoretical, theoreticalMean };
}

// ============================================================
// TESTE "JOGO SUGERIDO × JOGO REALIZADO"
// ============================================================
// Walk-forward pareado: para cada concurso, gera X jogos com S e X jogos
// aleatórios (mesma semente), compara médias pareadas.
function runScaleTest(strategyName, scales, startFrom, seed = 42, doShuffle = false) {
  const draws = state.draws;
  if (doShuffle) {
    // Controle negativo: embaralha os números DENTRO de cada sorteio
    // (preserva contagem de pares/primos mas destrói estrutura temporal)
    const rng = mulberry32(seed + 999);
    const shuffled = draws.map(d => ({ concurso: d.concurso, nums: shuffle(d.nums, rng) }));
    return runScaleTestInternal(strategyName, scales, startFrom, seed, shuffled);
  }
  return runScaleTestInternal(strategyName, scales, startFrom, seed, draws);
}

function runScaleTestInternal(strategyName, scales, startFrom, seed, draws) {
  const strat = STRATEGIES[strategyName];
  if (!strat) return { error: 'Estratégia desconhecida: ' + strategyName };
  if (draws.length < startFrom + 10) return { error: 'Base insuficiente' };

  const maxX = Math.max(...scales);
  // Coleta pareada: para cada t, para cada X (que varia), acumula deltas
  const resultsByX = {};
  for (const X of scales) {
    resultsByX[X] = {
      X,
      avgHitsS: [], avgHitsR: [],
      bestHitsS: [], bestHitsR: [],
      anyPrizeS: [], anyPrizeR: [],
      deltas: [],
      prizeS: 0, prizeR: 0, costS: 0, costR: 0,
    };
  }

  for (let t = startFrom; t < draws.length; t++) {
    const trainDraws = draws.slice(0, t);
    const lastDraw = trainDraws[trainDraws.length - 1];
    const target = draws[t];
    const targetSet = new Set(target.nums);

    // Gera uma vez maxX jogos; para cada X ≤ maxX usa prefixo
    const seedT = seed + t;
    let outS;
    try { outS = strat(trainDraws, lastDraw, maxX, seedT); }
    catch (e) { continue; }

    // Random pareado (mesma semente → reprodutível)
    const outR = strategyRandom(trainDraws, lastDraw, maxX, seedT);

    for (const X of scales) {
      const gamesS = outS.games.slice(0, X);
      const gamesR = outR.games.slice(0, X);
      const hitsS = gamesS.map(g => { let h = 0; for (const x of g) if (targetSet.has(x)) h++; return h; });
      const hitsR = gamesR.map(g => { let h = 0; for (const x of g) if (targetSet.has(x)) h++; return h; });
      const avgS = mean(hitsS), avgR = mean(hitsR);
      const bestS = Math.max(...hitsS), bestR = Math.max(...hitsR);
      const anyS = hitsS.some(h => h >= 11) ? 1 : 0;
      const anyR = hitsR.some(h => h >= 11) ? 1 : 0;

      resultsByX[X].avgHitsS.push(avgS);
      resultsByX[X].avgHitsR.push(avgR);
      resultsByX[X].bestHitsS.push(bestS);
      resultsByX[X].bestHitsR.push(bestR);
      resultsByX[X].anyPrizeS.push(anyS);
      resultsByX[X].anyPrizeR.push(anyR);
      resultsByX[X].deltas.push(avgS - avgR);
      resultsByX[X].prizeS += hitsS.reduce((a, h) => a + (PRIZE_TABLE[h] || 0), 0);
      resultsByX[X].prizeR += hitsR.reduce((a, h) => a + (PRIZE_TABLE[h] || 0), 0);
      resultsByX[X].costS += X * BET_VALUE;
      resultsByX[X].costR += X * BET_VALUE;
    }
  }

  // Agrega por X
  const summaries = [];
  const rawPValues = [];
  for (const X of scales) {
    const r = resultsByX[X];
    const N = r.deltas.length;
    if (N < 10) continue;
    const meanDelta = mean(r.deltas);
    const sdDelta = std(r.deltas);
    const se = sdDelta / Math.sqrt(N);
    const tStat = se > 0 ? meanDelta / se : 0;
    const pValue = tTestPValue(tStat, N - 1);
    const d = cohensD(r.avgHitsS, r.avgHitsR);
    const diffCI95 = [meanDelta - 1.96 * se, meanDelta + 1.96 * se];
    const pAnyS = mean(r.anyPrizeS);
    const pAnyR = mean(r.anyPrizeR);
    const roiS = r.costS > 0 ? (r.prizeS - r.costS) / r.costS : 0;

    summaries.push({
      X, N,
      avgHitsS: mean(r.avgHitsS),
      avgHitsR: mean(r.avgHitsR),
      meanDelta,
      diffCI95,
      tStat, pValue,
      cohensD: d,
      bestHitsS: mean(r.bestHitsS),
      bestHitsR: mean(r.bestHitsR),
      pAnyPrizeS: pAnyS,
      pAnyPrizeR: pAnyR,
      prizeS: r.prizeS,
      costS: r.costS,
      roiS,
    });
    rawPValues.push(pValue);
  }

  // Correções
  const bonf = bonferroni(rawPValues);
  const fdr = fdrBH(rawPValues);
  summaries.forEach((s, i) => {
    s.pBonf = bonf[i] !== undefined ? bonf[i] : 1;
    s.pFDR = fdr[i] !== undefined ? fdr[i] : 1;
  });

  return { strategy: strategyName, summaries, startFrom, endFrom: draws.length - 1, N: draws.length };
}

// Executa todas as estratégias em todas as escalas e compara
function runFullScaleTest(startFrom, seed = 42, doShuffle = false) {
  const out = { strategies: {}, shuffle: doShuffle };
  for (const s of STRATEGY_KEYS) {
    out.strategies[s] = runScaleTest(s, SCALES_TO_TEST, startFrom, seed, doShuffle);
  }
  return out;
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
    setStatus(`✓ ${draws.length} concursos carregados do GitHub (último: ${draws[draws.length - 1].concurso}).`, 'success');
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
  state.bitsets = buildBitsets(state.draws);
  state.marg = buildMarginal(state.draws);

  const last = state.draws[state.draws.length - 1];
  state.lastGame = new Set(last.nums);
  renderLastGameGrid();

  // Mapa de calor por quadrantes (sempre calculado após carregar)
  state.quadrantHeat = computeQuadrantHeat(state.draws);
  renderQuadrantHeat();

  document.getElementById('analyze').disabled = false;
  document.getElementById('generate-games').disabled = false;
  document.getElementById('run-scale-test').disabled = false;

  const perfNote = document.getElementById('perf-note');
  perfNote.style.display = state.draws.length > 1000 ? 'block' : 'none';
}

function setStatus(msg, type) {
  const el = document.getElementById('data-status');
  el.textContent = msg;
  el.className = 'status ' + (type || '');
}

// ============================================================
// ANÁLISE (top-N)
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
      x, p: s.p, p_obs: s.p_obs, nA: s.nA, c: s.c, lift: s.lift,
      conf: s.nA >= MIN_GATILHO ? 'OK' : 'BAIXA',
      inTrigger: A.includes(x),
    });
  }
  const sorted = [...scores].sort((a, b) => b.p - a.p);
  const top = sorted.slice(0, state.nPick);
  const topSet = new Set(top.map(s => s.x));
  const expected = top.reduce((acc, s) => acc + s.p, 0);

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
    nA, dist, totalHist, e: probEsperada(A.length),
    p11: pGE(11), p12: pGE(12), p13: pGE(13),
  };
  renderResults();
}

// ============================================================
// GERAÇÃO DE JOGOS (UI)
// ============================================================
function generateGamesUI() {
  if (!state.draws.length) return;
  const nGames = parseInt(document.getElementById('n-games').value, 10) || 5;
  const strategy = document.getElementById('strategy-select').value;
  const seed = parseInt(document.getElementById('seed').value, 10) || 42;
  const lastDraw = state.draws[state.draws.length - 1];
  const trainDraws = state.draws.slice(0, -1);

  let out;
  try { out = STRATEGIES[strategy](trainDraws, lastDraw, nGames, seed); }
  catch (e) { alert('Erro ao gerar jogos: ' + e.message); return; }

  state.generatedGames = out;
  renderGeneratedGames(out, strategy);

  const M = parseInt(document.getElementById('n-draws').value, 10) || 10;
  state.simulation = simulateConsecutive(out.games, M, out.probs, BET_VALUE);
  renderSimulation(state.simulation, M);
}

function renderGeneratedGames(out, strategyKey) {
  document.getElementById('games-section').style.display = 'block';
  document.getElementById('games-summary').innerHTML = `
    <div><strong>Estratégia:</strong> ${STRATEGY_NAMES[strategyKey] || strategyKey}</div>
    <div><strong>Jogos gerados:</strong> ${out.games.length}</div>
    ${out.A && out.A.length ? `<div><strong>Gatilho:</strong> ${out.A.map(n => String(n).padStart(2, '0')).join(', ')}</div>` : ''}
  `;
  const list = document.getElementById('games-list');
  list.innerHTML = '';
  out.games.forEach((g, i) => {
    const div = document.createElement('div');
    div.className = 'game-card';
    div.innerHTML = `<div class="game-header">Jogo ${i + 1}</div>
      <div class="game-nums">${g.map(x => `<span class="gnum">${String(x).padStart(2, '0')}</span>`).join('')}</div>`;
    list.appendChild(div);
  });
  const allNums = new Set();
  for (const g of out.games) for (const x of g) allNums.add(x);
  document.getElementById('games-coverage').textContent = `${allNums.size}/25 dezenas cobertas`;
}

function renderSimulation(sim, M) {
  document.getElementById('sim-p1').textContent = `${(sim.pWinPerDraw * 100).toFixed(2)}%`;
  document.getElementById('sim-pM').textContent = `${(sim.pWinM * 100).toFixed(2)}%`;
  document.getElementById('sim-ev').textContent = `R$ ${sim.evPerDraw.toFixed(2)}`;
  document.getElementById('sim-cost').textContent = `R$ ${sim.costTotal.toFixed(2)}`;
  const avgDist = new Array(16).fill(0);
  for (const d of sim.gameDists) for (let k = 0; k < d.length; k++) avgDist[k] += d[k] / sim.gameDists.length;
  let m = 0;
  for (let k = 0; k <= 15; k++) m += k * avgDist[k];
  document.getElementById('sim-mean').textContent = m.toFixed(2);
  document.getElementById('sim-m').textContent = M;

  const distEl = document.getElementById('sim-dist');
  distEl.innerHTML = '';
  const maxD = Math.max(...avgDist);
  for (let k = 0; k <= 15; k++) {
    const v = avgDist[k];
    if (v < 1e-6) continue;
    const row = document.createElement('div');
    row.className = 'dist-row';
    row.innerHTML = `
      <div class="dist-label">${k}</div>
      <div class="dist-track"><div class="dist-fill" style="width:${(v / maxD) * 100}%"></div></div>
      <div class="dist-val">${(v * 100).toFixed(2)}%</div>`;
    distEl.appendChild(row);
  }
}

// ============================================================
// MAPA DE CALOR POR QUADRANTES
// ============================================================
function renderQuadrantHeat() {
  const data = state.quadrantHeat;
  if (!data) return;

  const section = document.getElementById('quadrant-section');
  section.style.display = 'block';
  const grid = document.getElementById('quadrant-grid');
  grid.innerHTML = '';

  // Cores quentes = maior média (mais dezenas saindo)
  const means = Object.values(data.quadrants).map(q => q.mean);
  const minM = Math.min(...means);
  const maxM = Math.max(...means);
  const range = maxM - minM || 0.01;

  for (const q of QUADRANTS) {
    const qd = data.quadrants[q.id];
    const t = (qd.mean - minM) / range;
    const r = Math.round(50 + 205 * t);
    const g = Math.round(120 - 60 * t);
    const b = Math.round(255 - 205 * t);

    const card = document.createElement('div');
    card.className = 'quadrant-card';
    card.style.background = `linear-gradient(135deg, rgba(${r},${g},${b},0.35), rgba(${r},${g},${b},0.15))`;
    card.innerHTML = `
      <div class="quadrant-title">${qd.label}</div>
      <div class="quadrant-nums">${qd.nums.map(n => `<span class="qnum">${String(n).padStart(2, '0')}</span>`).join('')}</div>
      <div class="quadrant-mean">Média: <strong>${qd.mean.toFixed(2)}</strong> dezenas</div>
      <div class="quadrant-p">Saiu ≥ 1: <strong>${(qd.pAny * 100).toFixed(2)}%</strong></div>
      <div class="quadrant-p">Saiu ≥ 2: <strong>${(qd.p2plus * 100).toFixed(2)}%</strong></div>
      <div class="quadrant-p">Saiu ≥ 3: <strong>${(qd.p3plus * 100).toFixed(2)}%</strong></div>
      <div class="quadrant-p">Saiu todas 5: <strong>${(qd.p5 * 100).toFixed(2)}%</strong></div>
    `;
    grid.appendChild(card);
  }

  // Referência teórica
  const thMean = data.theoreticalMean;
  document.getElementById('quadrant-theory').innerHTML = `
    <strong>Referência matemática:</strong> em sorteios aleatórios, cada quadrante contribui
    com média de <strong>${thMean.toFixed(2)}</strong> dezenas por sorteio (esperado 3,00 = 5×15/25).
    P(X=k) teórico: ${[0,1,2,3,4,5].map(k => `${k}: ${(data.theoretical[k]*100).toFixed(1)}%`).join(' · ')}
  `;

  // Mini-tabela de distribuição
  const dist = document.getElementById('quadrant-dist');
  dist.innerHTML = '';
  for (const q of QUADRANTS) {
    const qd = data.quadrants[q.id];
    const row = document.createElement('div');
    row.className = 'quad-dist-row';
    row.innerHTML = `<div class="quad-dist-label">${qd.label}</div>
      <div class="quad-dist-bars">${[0,1,2,3,4,5].map(k => {
        const obs = qd.dist[k] / qd.totalDraws;
        const th = data.theoretical[k];
        const maxV = 0.6;
        return `<div class="quad-bar" title="${k} dezenas: obs ${(obs*100).toFixed(1)}% vs teórico ${(th*100).toFixed(1)}%">
          <div class="quad-bar-obs" style="height:${(obs/maxV)*100}%"></div>
          <div class="quad-bar-th" style="height:${(th/maxV)*100}%"></div>
          <div class="quad-bar-k">${k}</div>
        </div>`;
      }).join('')}</div>`;
    dist.appendChild(row);
  }
}

// ============================================================
// TESTE DE ESCALA (UI)
// ============================================================
function runScaleTestUI() {
  if (!state.draws.length) return;
  const startFrom = parseInt(document.getElementById('st-start').value, 10) || 500;
  const seed = parseInt(document.getElementById('st-seed').value, 10) || 42;
  const doShuffle = document.getElementById('st-shuffle').checked;

  const section = document.getElementById('scale-section');
  section.style.display = 'block';
  const res = document.getElementById('scale-results');
  res.innerHTML = '<p class="small">⏳ Rodando teste de escala… (pode levar 10–30s)</p>';

  setTimeout(() => {
    const t0 = performance.now();
    const out = runFullScaleTest(startFrom, seed, doShuffle);
    out.elapsedMs = performance.now() - t0;
    state.scaleTest = out;
    renderScaleTest(out);
  }, 50);
}

function verdictFor(s) {
  // Veredito em linguagem clara
  if (s.pFDR < 0.05 && s.meanDelta > 0.05) {
    return { label: 'Sinal detectado (verificar)', class: 'warn' };
  }
  if (s.pFDR < 0.05 && s.meanDelta < -0.05) {
    return { label: 'Pior que aleatório', class: 'neg' };
  }
  if (s.meanDelta > 0 && s.meanDelta < 0.05) {
    return { label: 'Sem sinal (ruído)', class: 'neutral' };
  }
  return { label: 'Sem sinal', class: 'neutral' };
}

function renderScaleTest(out) {
  const res = document.getElementById('scale-results');
  const shuffleTag = out.shuffle ? ' <span class="badge-warn">MODO CONTROLE (dados embaralhados)</span>' : '';

  let html = `
    <p class="small">
      Teste pareado: para cada concurso, gera X jogos com a estratégia <em>e</em> X jogos
      aleatórios (mesma semente), e compara as médias de acerto. ${out.shuffle ? '⚠️ Rodando em <strong>dados embaralhados</strong> — se aparecer sinal, é artefato do método.' : ''}
    </p>
    <div class="scale-legend">
      <span><strong>Δ</strong> = diferença média de acertos por jogo (estratégia − aleatório)</span>
      <span>IC 95% mostra a margem de erro</span>
      <span>p-FDR: p-valor corrigido para múltiplas comparações</span>
    </div>
  `;

  for (const key of STRATEGY_KEYS) {
    const r = out.strategies[key];
    if (!r || r.error) continue;
    html += `<div class="scale-strategy"><h3>${STRATEGY_NAMES[key]}</h3>`;
    html += `<table class="scale-table">
      <thead><tr>
        <th>Jogos (X)</th>
        <th>Acertos/jogo (estrat.)</th>
        <th>Acertos/jogo (aleat.)</th>
        <th>Δ (estrat. − aleat.)</th>
        <th>IC 95% do Δ</th>
        <th>p-FDR</th>
        <th>Efeito (d)</th>
        <th>Veredito</th>
      </tr></thead><tbody>`;
    for (const s of r.summaries) {
      const v = verdictFor(s);
      const deltaStr = (s.meanDelta >= 0 ? '+' : '') + s.meanDelta.toFixed(4);
      const ciStr = `[${s.diffCI95[0].toFixed(3)}, ${s.diffCI95[1].toFixed(3)}]`;
      html += `<tr>
        <td><strong>${s.X}</strong></td>
        <td>${s.avgHitsS.toFixed(3)}</td>
        <td>${s.avgHitsR.toFixed(3)}</td>
        <td class="delta-${v.class}">${deltaStr}</td>
        <td class="small">${ciStr}</td>
        <td>${s.pFDR < 0.001 ? '< 0,001' : s.pFDR.toFixed(3)}</td>
        <td>${s.cohensD.toFixed(3)}</td>
        <td><span class="verdict ${v.class}">${v.label}</span></td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Conclusão global
  let anySignal = false;
  let bestDelta = -Infinity;
  let bestS = null;
  for (const key of STRATEGY_KEYS) {
    const r = out.strategies[key];
    if (!r || r.error) continue;
    for (const s of r.summaries) {
      if (s.pFDR < 0.05 && s.meanDelta > 0.05) { anySignal = true; }
      if (s.meanDelta > bestDelta) { bestDelta = s.meanDelta; bestS = { key, s }; }
    }
  }

  html += `<div class="caveat">`;
  if (out.shuffle) {
    html += `<strong>🧪 Modo controle ativo:</strong> os dados foram embaralhados. Qualquer "sinal" aqui é <em>artefato do método</em>, não dos dados. Use como sanidade do teste.`;
  } else if (anySignal) {
    html += `<strong>⚠️ Sinal detectado:</strong> alguma combinação (estratégia × X) superou o aleatório com p-FDR < 0,05 e Δ > 0,05. <strong>Antes de comemorar:</strong> verifique se (1) o efeito persiste em outro período, (2) há mecanismo físico plausível, (3) não é confundimento com era/máquina. Use "Controle (embaralhar)" para descartar p-hacking.`;
  } else {
    html += `<strong>✅ Nenhuma predição funciona em nenhuma escala testada.</strong> A melhor diferença foi de <strong>${bestDelta >= 0 ? '+' : ''}${bestDelta.toFixed(4)}</strong> acertos/jogo (${STRATEGY_NAMES[bestS.key]} com X=${bestS.s.X}), dentro do ruído estatístico.`;
  }
  html += `</div>`;

  // Explicação didática
  html += `<div class="explain">
    <h4>💡 Como ler esta tabela</h4>
    <ul>
      <li><strong>Acertos/jogo (estrat.)</strong>: em média, quantas dezenas do jogo sugerido caíram no sorteio real.</li>
      <li><strong>Acertos/jogo (aleat.)</strong>: o mesmo, mas com jogos gerados ao acaso. Serve de "linha de base".</li>
      <li><strong>Δ</strong>: quanto a estratégia ganha (ou perde) em relação ao acaso. Positivo = melhor.</li>
      <li><strong>IC 95%</strong>: se o intervalo contém 0, a diferença pode ser só sorte.</li>
      <li><strong>p-FDR</strong>: probabilidade de ver essa diferença por acaso, corrigida por testar várias combinações.</li>
      <li><strong>Veredito</strong>: "Sem sinal" = dentro do esperado para loteria uniforme.</li>
    </ul>
    <p><strong>Por que X=1 é o teste mais poderoso:</strong> com mais jogos, tanto a estratégia quanto o aleatório vão eventualmente acertar ≥11 (cobertura). X=1 isola a "qualidade" da seleção sem diluir.</p>
  </div>`;

  res.innerHTML = html;

  // Resumo percentual
  document.getElementById('scale-summary').textContent =
    `${out.shuffle ? '⚠️ CONTROLE' : 'Teste rodado'} — ${STRATEGY_KEYS.length} estratégias × ${SCALES_TO_TEST.length} escalas em ${out.strategies.condicional?.N || 0} concursos. Tempo: ${out.elapsedMs.toFixed(0)}ms.`;
}

// ============================================================
// RENDER (análise)
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

  document.getElementById('rec-count').textContent = state.nPick;
  const rec = document.getElementById('recommendation-grid');
  rec.innerHTML = '';
  for (const s of [...a.top].sort((x, y) => x.x - y.x)) {
    const div = document.createElement('div');
    div.className = 'rec-num';
    div.textContent = String(s.x).padStart(2, '0');
    div.dataset.p = `${(s.p * 100).toFixed(0)}%`;
    div.title = `P=${(s.p * 100).toFixed(2)}%`;
    rec.appendChild(div);
  }

  const avg = a.top.reduce((acc, s) => acc + s.p, 0) / a.top.length;
  document.getElementById('avg-prob').textContent = `${(avg * 100).toFixed(2)}%`;
  document.getElementById('expected-hits').textContent = a.expected.toFixed(2);
  document.getElementById('p11').textContent = a.p11 !== null ? `${(a.p11 * 100).toFixed(2)}%` : '—';
  document.getElementById('p12').textContent = a.p12 !== null ? `${(a.p12 * 100).toFixed(2)}%` : '—';
  document.getElementById('p13').textContent = a.p13 !== null ? `${(a.p13 * 100).toFixed(2)}%` : '—';

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
// DEMO CSV
// ============================================================
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
    document.querySelectorAll('#last-game-grid .num-btn.selected').forEach(b => b.classList.remove('selected'));
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
  document.getElementById('trigger-select').addEventListener('change', e => { state.trigger = e.target.value; });
  document.getElementById('n-pick').addEventListener('input', e => {
    state.nPick = parseInt(e.target.value, 10);
    document.getElementById('n-pick-value').textContent = state.nPick;
    if (state.analysis) analyze();
  });
  document.getElementById('analyze').addEventListener('click', analyze);
  document.getElementById('generate-games').addEventListener('click', generateGamesUI);
  document.getElementById('run-scale-test').addEventListener('click', runScaleTestUI);

  const nGamesEl = document.getElementById('n-games');
  if (nGamesEl) nGamesEl.addEventListener('input', e => {
    document.getElementById('n-games-value').textContent = e.target.value;
  });
  const nDrawsEl = document.getElementById('n-draws');
  if (nDrawsEl) nDrawsEl.addEventListener('input', e => {
    document.getElementById('n-draws-value').textContent = e.target.value;
  });

  renderLastGameGrid();

  const url = document.getElementById('csv-url').value.trim();
  if (url) loadFromURL(url);
  else loadDemo();
});
