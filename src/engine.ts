import answerMap from '../data/answerMap.json';
import scriptsData from '../data/scripts.json';
import universeReportData from '../data/universeReport.json';
import type { AnswerKey } from './questions';

export type Dim = 'M' | 'F' | 'A' | 'R' | 'C';

export type Answers = Record<string, AnswerKey>;

export interface Script {
  id: string;
  order: number;
  name: string;
  pairKey: string;
  primaryDimension: string;
  secondaryDimension: string;
  tagline: string;
  identity: {
    yearLabel: string;
    roleLabel: string;
    description: string[];
  };
  dna: {
    profileHint: string;
    shadowDimension: string;
    growthResistance: string;
    futureOpportunity: string;
  };
  timeline: Array<{
    year: number;
    type: string;
    label: string;
    event: string;
  }>;
  report: {
    mainQuest: string;
    maxGrowth: string;
    maxRegret: string;
    universeNote: string;
  };
  shareQuotes: string[];
  poster: { defaultQuoteIndex: number; footer: string };
  parallelContrast: {
    prefix: string;
    targetScriptId: string;
    suffix: string;
  };
}

export interface UniverseReportResult {
  id: string;
  name: string;
  text: string;
  subtext: string;
  tone: string;
}

export interface SessionResult {
  sessionId: string;
  dna: Record<Dim, number>;
  scriptA: Script;
  scriptB: Script;
  universeReport: UniverseReportResult;
  shadowDim: Dim;
  shareQuote: string;
}

const DIMS: Dim[] = ['M', 'F', 'A', 'R', 'C'];
const DIM_LABELS: Record<Dim, string> = {
  M: '人生动能',
  F: '自由驱动',
  A: '行动倾向',
  R: '遗憾敏感',
  C: '创造欲',
};

const scripts = scriptsData.scripts as Script[];
const scriptById = Object.fromEntries(scripts.map((s) => [s.id, s]));
const scriptLookup = scriptsData.scriptLookup as Record<string, string>;
const scriptFallback = answerMap.scriptFallback as Record<string, string>;
const tieBreaker = answerMap.tieBreaker as Dim[];

export function getDimLabel(dim: Dim | string): string {
  return DIM_LABELS[dim as Dim] ?? dim;
}

export function createSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hashSeed(sessionId: string, seed: string): number {
  const str = sessionId + seed;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function calcDNA(answers: Answers): Record<Dim, number> {
  const raw: Record<Dim, number> = { M: 0, F: 0, A: 0, R: 0, C: 0 };
  const maxRaw = answerMap.maxRawScore as Record<Dim, number>;
  const map = answerMap.answers as Record<
    string,
    Record<AnswerKey, Record<Dim, number>>
  >;

  for (const [q, opt] of Object.entries(answers)) {
    const mult = q === 'Q12' ? 3 : 1;
    const score = map[q]?.[opt];
    if (!score) continue;
    for (const d of DIMS) {
      raw[d] += score[d] * mult;
    }
  }

  return Object.fromEntries(
    DIMS.map((d) => [d, Math.round((raw[d] / maxRaw[d]) * 100)])
  ) as Record<Dim, number>;
}

function sortedDims(dna: Record<Dim, number>): [Dim, number][] {
  return (Object.entries(dna) as [Dim, number][]).sort(
    (a, b) =>
      b[1] - a[1] ||
      tieBreaker.indexOf(a[0]) - tieBreaker.indexOf(b[0])
  );
}

export function resolveScriptId(
  dna: Record<Dim, number>,
  rank1?: Dim,
  rank2?: Dim
): string {
  const sorted = sortedDims(dna);
  const p = rank1 ?? sorted[0][0];
  const s = rank2 ?? sorted[1][0];

  const topPair = new Set([sorted[0][0], sorted[1][0]]);
  if (topPair.has('M') && topPair.has('A') && dna.A < 40) {
    return 'fate_observer';
  }

  const key1 = `${p}_${s}`;
  const key2 = `${s}_${p}`;

  if (scriptLookup[key1]) return scriptLookup[key1];
  if (scriptLookup[key2]) return scriptLookup[key2];
  if (scriptFallback[key1]) return scriptFallback[key1];
  if (scriptFallback[key2]) return scriptFallback[key2];

  const byPrimary = scripts.find((script) => script.primaryDimension === p);
  return byPrimary?.id ?? scripts[0].id;
}

function matchDnaCondition(
  dna: Record<Dim, number>,
  cond?: Record<string, { min?: number; max?: number; topDimension?: string }>
): boolean {
  if (!cond) return true;
  const sorted = sortedDims(dna);

  for (const [dim, rule] of Object.entries(cond)) {
    if (dim === 'topDimension') continue;
    const val = dna[dim as Dim];
    if (rule.min !== undefined && val < rule.min) return false;
    if (rule.max !== undefined && val > rule.max) return false;
  }

  const topRule = cond.topDimension;
  if (topRule && sorted[0][0] !== topRule) return false;

  return true;
}

function matchAnswerPatterns(
  answers: Answers,
  patterns?: {
    anyOf: Array<{ question: string; answers: string[] }>;
    minMatch: number;
  }
): boolean {
  if (!patterns) return true;
  let hits = 0;
  for (const p of patterns.anyOf) {
    const ans = answers[p.question];
    if (ans && p.answers.includes(ans)) hits++;
  }
  return hits >= patterns.minMatch;
}

function resolveStatValue(
  spec: { base?: number; variance?: number; seed?: string; value?: number; formula?: string },
  computed: Record<string, number>,
  sessionId: string,
  dna: Record<Dim, number>
): number {
  if (spec.value !== undefined) return spec.value;
  if (spec.formula) {
    if (spec.formula === 'actions / insights') {
      const insights = computed.insights ?? 1;
      const actions = computed.actions ?? 0;
      return actions / insights;
    }
    if (spec.formula === 'pathsTried - committed') {
      return (computed.pathsTried ?? 0) - (computed.committed ?? 0);
    }
    if (spec.formula === 'bets - wins') {
      return (computed.bets ?? 0) - (computed.wins ?? 0);
    }
    if (spec.formula === 'avg(M,F,A,R,C)') {
      return DIMS.reduce((s, d) => s + dna[d], 0) / DIMS.length / 100;
    }
  }
  const base = spec.base ?? 0;
  const variance = spec.variance ?? 0;
  const seed = spec.seed ?? 'x';
  if (variance === 0) return base;
  return base + (hashSeed(sessionId, seed) % (variance + 1));
}

function fillTemplate(
  template: string,
  stats: Record<string, number | string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = stats[key];
    if (val === undefined) return '';
    if (typeof val === 'number') {
      if (key === 'ratio' || key === 'clarity') {
        return `${Math.round(val * 100)}%`;
      }
      return String(Math.round(val));
    }
    return String(val);
  });
}

export function matchUniverseReport(
  dna: Record<Dim, number>,
  answers: Answers,
  scriptId: string,
  sessionId: string
): UniverseReportResult {
  type Rule = (typeof universeReportData.rules)[number];
  const rules = [...universeReportData.rules].sort(
    (a, b) => b.priority - a.priority
  );

  let best: Rule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (rule.conditions.fallback) continue;

    const cond = rule.conditions;
    if (!matchDnaCondition(dna, cond.dna as Parameters<typeof matchDnaCondition>[1])) {
      continue;
    }
    if (cond.scriptIds && !cond.scriptIds.includes(scriptId)) continue;
    if (!matchAnswerPatterns(answers, cond.answerPatterns)) continue;

    let score = 0;
    if (cond.dna) score += Object.keys(cond.dna).length;
    if (cond.answerPatterns) score += 2;
    if (cond.scriptIds) score += 1;

    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  const rule =
    best ?? rules.find((r) => r.conditions.fallback) ?? rules[rules.length - 1];

  const computed: Record<string, number> = {};
  const statSpecs = rule.stats as Record<
    string,
    { base?: number; variance?: number; seed?: string; value?: number; formula?: string; format?: string }
  >;

  for (const [key, spec] of Object.entries(statSpecs)) {
    if (!spec.formula || !spec.formula.includes('/') && spec.formula !== 'avg(M,F,A,R,C)') {
      computed[key] = resolveStatValue(spec, computed, sessionId, dna);
    }
  }
  for (const [key, spec] of Object.entries(statSpecs)) {
    if (spec.formula) {
      computed[key] = resolveStatValue(spec, computed, sessionId, dna);
    }
  }

  return {
    id: rule.id,
    name: rule.name,
    text: fillTemplate(rule.text, computed),
    subtext: fillTemplate(rule.subtext, computed),
    tone: rule.tone,
  };
}

export function computeResult(answers: Answers, sessionId: string): SessionResult {
  const dna = calcDNA(answers);
  const sorted = sortedDims(dna);

  const scriptAId = resolveScriptId(dna);
  const scriptA = scriptById[scriptAId];

  const scriptBId = resolveScriptId(dna, sorted[1][0], sorted[2][0]);
  const scriptB = scriptById[scriptBId] ?? scriptById[scriptA.parallelContrast.targetScriptId];

  const shadowDim = sorted[sorted.length - 1][0];
  const universeReport = matchUniverseReport(dna, answers, scriptAId, sessionId);
  const shareQuote =
    scriptA.shareQuotes[scriptA.poster.defaultQuoteIndex] ?? scriptA.shareQuotes[0];

  return {
    sessionId,
    dna,
    scriptA,
    scriptB,
    universeReport,
    shadowDim,
    shareQuote,
  };
}

export function pseudoIntroStats(sessionId: string) {
  const h = hashSeed(sessionId, 'intro');
  return {
    hesitations: 280 + (h % 100),
    abandoned: 35 + (h % 25),
    unsent: 8 + (h % 10),
  };
}
