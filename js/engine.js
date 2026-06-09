const DIMS = ['M', 'F', 'A', 'R', 'C'];
const DIM_LABELS = {
  M: '人生动能',
  F: '自由驱动',
  A: '行动倾向',
  R: '遗憾敏感',
  C: '创造欲',
};

export function createEngine(answerMap, scriptsData, universeReportData, futureLeakData) {
  const scripts = scriptsData.scripts;
  const scriptById = Object.fromEntries(scripts.map((s) => [s.id, s]));
  const scriptLookup = scriptsData.scriptLookup;
  const scriptFallback = answerMap.scriptFallback;
  const tieBreaker = answerMap.tieBreaker;

  function hashSeed(sessionId, seed) {
    const str = sessionId + seed;
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function calcDNA(answers) {
    const raw = { M: 0, F: 0, A: 0, R: 0, C: 0 };
    const maxRaw = answerMap.maxRawScore;
    const map = answerMap.answers;

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
    );
  }

  function calcPartialDNA(answers, maxQuestion = 6) {
    const raw = { M: 0, F: 0, A: 0, R: 0, C: 0 };
    const maxRaw = { M: 0, F: 0, A: 0, R: 0, C: 0 };
    const map = answerMap.answers;

    for (let n = 1; n <= maxQuestion; n++) {
      const q = `Q${n}`;
      for (const d of DIMS) {
        let qMax = 0;
        for (const opt of ['A', 'B', 'C', 'D']) {
          qMax = Math.max(qMax, map[q]?.[opt]?.[d] ?? 0);
        }
        maxRaw[d] += qMax;
      }

      const chosen = answers[q];
      if (!chosen) continue;
      const score = map[q]?.[chosen];
      if (!score) continue;
      for (const d of DIMS) {
        raw[d] += score[d];
      }
    }

    return Object.fromEntries(
      DIMS.map((d) => [
        d,
        maxRaw[d] > 0 ? Math.round((raw[d] / maxRaw[d]) * 100) : 0,
      ])
    );
  }

  function matchLeakCondition(dna, cond = {}) {
    if (cond.avgOthers) {
      const avg = (dna.F + dna.A + dna.R + dna.C) / 4;
      if (cond.avgOthers.min !== undefined && avg < cond.avgOthers.min) return false;
      if (cond.avgOthers.max !== undefined && avg > cond.avgOthers.max) return false;
    }

    for (const [dim, rule] of Object.entries(cond)) {
      if (dim === 'avgOthers') continue;
      const val = dna[dim];
      if (rule.min !== undefined && val < rule.min) return false;
      if (rule.max !== undefined && val > rule.max) return false;
    }
    return true;
  }

  function matchLeakPattern(dna, sorted, pattern) {
    const top1 = sorted[0];
    const top2 = sorted[1];

    if (pattern.primaryDim) {
      if (top1[0] !== pattern.primaryDim) return false;
      if (
        pattern.dominanceMin !== undefined &&
        top1[1] - top2[1] < pattern.dominanceMin
      ) {
        return false;
      }
    }

    if (pattern.primaryPair) {
      const topPair = sorted
        .slice(0, 2)
        .map(([dim]) => dim)
        .sort()
        .join(',');
      const wantPair = [...pattern.primaryPair].sort().join(',');
      if (topPair !== wantPair) return false;
    }

    if (pattern.balancedOthers) {
      const others = [dna.F, dna.A, dna.R, dna.C];
      const avg = others.reduce((sum, val) => sum + val, 0) / others.length;
      const spread = Math.max(...others) - Math.min(...others);
      if (spread > 22 || avg < 22 || avg > 58) return false;
    }

    return matchLeakCondition(dna, pattern.conditions ?? {});
  }

  function computeFutureLeak(answers, sessionId) {
    const dna = calcPartialDNA(answers, futureLeakData.meta?.triggerAfter ?? 6);
    const sorted = sortedDims(dna);
    let pattern = futureLeakData.universal;

    for (const candidate of futureLeakData.patterns) {
      if (matchLeakPattern(dna, sorted, candidate)) {
        pattern = candidate;
        break;
      }
    }

    const confidence = 81 + (hashSeed(sessionId, 'leak') % 3);

    return {
      patternId: pattern.id,
      patternName: pattern.name,
      lines: pattern.lines,
      dna,
      confidence,
    };
  }

  function sortedDims(dna) {
    return Object.entries(dna).sort(
      (a, b) =>
        b[1] - a[1] || tieBreaker.indexOf(a[0]) - tieBreaker.indexOf(b[0])
    );
  }

  function resolveScriptId(dna, rank1, rank2) {
    const sorted = sortedDims(dna);
    const p = rank1 ?? sorted[0][0];
    const s = rank2 ?? sorted[1][0];

    if (p === 'M' && dna.A < 40) return 'fate_observer';

    const key1 = `${p}_${s}`;
    const key2 = `${s}_${p}`;

    if (scriptLookup[key1]) return scriptLookup[key1];
    if (scriptLookup[key2]) return scriptLookup[key2];
    if (scriptFallback[key1]) return scriptFallback[key1];
    if (scriptFallback[key2]) return scriptFallback[key2];

    return scripts[0].id;
  }

  function matchDnaCondition(dna, cond) {
    if (!cond) return true;
    const sorted = sortedDims(dna);

    for (const [dim, rule] of Object.entries(cond)) {
      if (dim === 'topDimension') continue;
      const val = dna[dim];
      if (rule.min !== undefined && val < rule.min) return false;
      if (rule.max !== undefined && val > rule.max) return false;
    }

    if (cond.topDimension && sorted[0][0] !== cond.topDimension) return false;
    return true;
  }

  function matchAnswerPatterns(answers, patterns) {
    if (!patterns) return true;
    let hits = 0;
    for (const p of patterns.anyOf) {
      const ans = answers[p.question];
      if (ans && p.answers.includes(ans)) hits++;
    }
    return hits >= patterns.minMatch;
  }

  function resolveStatValue(spec, computed, sessionId, dna) {
    if (spec.value !== undefined) return spec.value;
    if (spec.formula) {
      if (spec.formula === 'actions / insights') {
        return (computed.actions ?? 0) / (computed.insights ?? 1);
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

  function fillTemplate(template, stats) {
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

  function matchUniverseReport(dna, answers, scriptId, sessionId) {
    const rules = [...universeReportData.rules].sort(
      (a, b) => b.priority - a.priority
    );

    let best = null;
    let bestScore = -1;

    for (const rule of rules) {
      if (rule.conditions.fallback) continue;
      const cond = rule.conditions;
      if (!matchDnaCondition(dna, cond.dna)) continue;
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
      best ??
      rules.find((r) => r.conditions.fallback) ??
      rules[rules.length - 1];

    const computed = {};
    const statSpecs = rule.stats;

    for (const [key, spec] of Object.entries(statSpecs)) {
      if (
        !spec.formula ||
        (!spec.formula.includes('/') && spec.formula !== 'avg(M,F,A,R,C)')
      ) {
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

  function computeResult(answers, sessionId) {
    const dna = calcDNA(answers);
    const sorted = sortedDims(dna);

    const scriptAId = resolveScriptId(dna);
    const scriptA = scriptById[scriptAId];

    const scriptBId = resolveScriptId(dna, sorted[1][0], sorted[2][0]);
    const scriptB =
      scriptById[scriptBId] ??
      scriptById[scriptA.parallelContrast.targetScriptId];

    const shareQuote =
      scriptA.verdict?.quote ??
      scriptA.shareQuotes[scriptA.poster.defaultQuoteIndex] ??
      scriptA.shareQuotes[0];

    const lifeTags =
      scriptA.verdict?.lifeTags ??
      scriptA.shareQuotes.slice(0, 3).map((q) => q.slice(0, 8));

    return {
      sessionId,
      dna,
      scriptA,
      scriptB,
      universeReport: matchUniverseReport(dna, answers, scriptAId, sessionId),
      shadowDim: sorted[sorted.length - 1][0],
      shareQuote,
      lifeTags,
    };
  }

  function pseudoIntroStats(sessionId) {
    const h = hashSeed(sessionId, 'intro');
    return {
      hesitations: 280 + (h % 100),
      abandoned: 35 + (h % 25),
      unsent: 8 + (h % 10),
    };
  }

  return {
    DIMS,
    getDimLabel: (dim) => DIM_LABELS[dim] ?? dim,
    createSessionId: () =>
      `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    computeResult,
    computeFutureLeak,
    pseudoIntroStats,
  };
}
