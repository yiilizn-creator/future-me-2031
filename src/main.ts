import { QUESTIONS, type AnswerKey } from './questions';
import {
  type Answers,
  type Dim,
  type SessionResult,
  computeResult,
  createSessionId,
  getDimLabel,
  pseudoIntroStats,
} from './engine';

type Screen =
  | 'intro'
  | 'quiz'
  | 'dna'
  | 'result-identity'
  | 'result-timeline'
  | 'result-report'
  | 'universe'
  | 'poster'
  | 'parallel';

const DIMS: Dim[] = ['M', 'F', 'A', 'R', 'C'];
const RESULT_SCREENS: Screen[] = [
  'result-identity',
  'result-timeline',
  'result-report',
];

const app = document.getElementById('app')!;

const state = {
  screen: 'intro' as Screen,
  sessionId: createSessionId(),
  questionIndex: 0,
  answers: {} as Answers,
  result: null as SessionResult | null,
  shared: false,
  selectedKey: null as AnswerKey | null,
  undoTimer: null as ReturnType<typeof setTimeout> | null,
  introLineIndex: 0,
};

function clarityPercent(): number {
  if (state.screen === 'quiz') {
    const answered = Object.keys(state.answers).length;
    if (answered >= 12) return 100;
    return Math.round(((state.questionIndex + 1) / 12) * 100);
  }
  return 100;
}

function saveSession() {
  sessionStorage.setItem(
    'future-me-session',
    JSON.stringify({
      sessionId: state.sessionId,
      questionIndex: state.questionIndex,
      answers: state.answers,
      screen: state.screen,
      shared: state.shared,
    })
  );
}

function syncQuestionIndex() {
  const answered = Object.keys(state.answers).length;
  if (answered >= 12) {
    state.questionIndex = 11;
    return;
  }
  state.questionIndex = Math.min(answered, 11);
}

function loadSession() {
  const raw = sessionStorage.getItem('future-me-session');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.answers && Object.keys(data.answers).length > 0) {
      state.sessionId = data.sessionId ?? state.sessionId;
      state.answers = data.answers;
      state.shared = data.shared ?? false;
      syncQuestionIndex();
      if (data.screen && data.screen !== 'intro') {
        state.screen = data.screen;
      }
      if (Object.keys(state.answers).length === 12) {
        state.result = computeResult(state.answers, state.sessionId);
      }
    }
  } catch {
    /* ignore */
  }
}

function setScreen(screen: Screen) {
  state.screen = screen;
  saveSession();
  render();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRadar(dna: Record<Dim, number>, animate = false): string {
  const cx = 110;
  const cy = 110;
  const maxR = 80;
  const angles = DIMS.map((_, i) => (Math.PI * 2 * i) / DIMS.length - Math.PI / 2);

  const points = DIMS.map((d, i) => {
    const r = (dna[d] / 100) * maxR * (animate ? 1 : 1);
    const x = cx + r * Math.cos(angles[i]);
    const y = cy + r * Math.sin(angles[i]);
    return `${x},${y}`;
  }).join(' ');

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const grids = gridLevels
    .map((lv) => {
      const pts = angles
        .map((a) => {
          const r = maxR * lv;
          return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        })
        .join(' ');
      return `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
    })
    .join('');

  const labels = DIMS.map((d, i) => {
    const r = maxR + 18;
    const x = cx + r * Math.cos(angles[i]);
    const y = cy + r * Math.sin(angles[i]);
    const anchor =
      x < cx - 10 ? 'end' : x > cx + 10 ? 'start' : 'middle';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="radar-label" dominant-baseline="middle">${d}</text>
      <text x="${x}" y="${y + 14}" text-anchor="${anchor}" class="radar-value">${dna[d]}</text>`;
  }).join('');

  return `<svg class="radar-svg" viewBox="0 0 220 220">${grids}
    <polygon points="${points}" fill="rgba(91,140,255,0.2)" stroke="#5B8CFF" stroke-width="2"/>
    ${labels}
  </svg>`;
}

function renderIntro(): string {
  const stats = pseudoIntroStats(state.sessionId);
  const lines = [
    '未来档案加载中...',
    '正在扫描过去的人生选择...',
    `发现：${stats.hesitations} 次犹豫`,
    `${stats.abandoned} 个半途而废的计划`,
    `${stats.unsent} 条未发送的消息`,
  ];

  return `
    <div class="screen intro-screen" data-screen="intro">
      ${lines
        .map(
          (line, i) =>
            `<p class="intro-line ${i <= state.introLineIndex ? 'visible' : ''} ${i >= 2 && i <= 4 ? 'highlight' : ''}">${escapeHtml(line)}</p>`
        )
        .join('')}
      <p class="intro-ready ${state.introLineIndex >= lines.length ? 'visible' : ''}">未来已准备就绪</p>
      <div style="margin-top:40px">
        <button class="btn btn-primary" id="btn-start" ${state.introLineIndex < lines.length ? 'disabled' : ''}>
          开始推演未来
        </button>
      </div>
    </div>
  `;
}

function renderQuiz(): string {
  const q = QUESTIONS[state.questionIndex];
  const clarity = clarityPercent();
  const layer = String(state.questionIndex + 1).padStart(2, '0');

  return `
    <div class="screen" data-screen="quiz">
      <div class="quiz-header">
        ${state.questionIndex > 0 ? '<button class="quiz-back" id="btn-back">← 上一题</button>' : '<div></div>'}
        <div>
          <div class="clarity-label">
            <span>未来清晰度</span>
            <span>${clarity}%</span>
          </div>
          <div class="clarity-bar"><div class="clarity-fill" style="width:${clarity}%"></div></div>
        </div>
        <div class="scan-layer">扫描层 ${layer} / 12 · ${escapeHtml(q.section)}</div>
      </div>
      <h2 class="question-title">${escapeHtml(q.text)}</h2>
      ${q.weighted && !state.answers[q.id] ? '<p class="question-weight">此题权重 ×3</p>' : ''}
      <div class="answers" id="answers">
        ${q.options
          .map((opt) => {
            const isSelected = state.selectedKey === opt.key;
            const isDimmed = state.selectedKey !== null && !isSelected;
            return `
              <button class="answer-card ${isSelected ? 'selected' : ''} ${isDimmed ? 'dimmed' : ''}"
                data-answer="${opt.key}" type="button">
                <span class="key">${opt.key}</span>
                <span class="text">${escapeHtml(opt.text)}</span>
              </button>`;
          })
          .join('')}
      </div>
      ${
        state.questionIndex === 11
          ? `<button class="btn btn-primary btn-block" id="btn-generate" ${Object.keys(state.answers).length < 11 ? 'disabled' : ''} style="margin-top:24px">生成未来档案</button>`
          : '<div class="spacer"></div>'
      }
    </div>
  `;
}

function renderDna(): string {
  const dna = state.result!.dna;
  return `
    <div class="screen dna-screen" data-screen="dna">
      <p class="dna-title">正在比对 2031 年时间线…</p>
      <div class="radar-wrap">${renderRadar(dna)}</div>
      <div class="dna-dims">
        ${DIMS.map((d) => `<span class="dna-chip">${getDimLabel(d)} <span>${dna[d]}</span></span>`).join('')}
      </div>
      <p class="dna-title" style="margin-top:16px">未来 DNA 生成完毕</p>
    </div>
  `;
}

function renderResultIdentity(): string {
  const s = state.result!.scriptA;
  return `
    <div class="screen" data-screen="result-identity">
      ${renderResultNav('result-identity')}
      <div class="result-hero">
        <div class="year-2031">${s.identity.yearLabel}</div>
        <div class="role-label">${s.identity.roleLabel}</div>
        <div class="script-name">${escapeHtml(s.name)}</div>
        <div class="script-tagline">${escapeHtml(s.tagline)}</div>
        <div class="script-desc">
          ${s.identity.description.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        </div>
      </div>
      <div class="dna-dims" style="justify-content:center">
        ${DIMS.map((d) => `<span class="dna-chip">${getDimLabel(d)} <span>${state.result!.dna[d]}</span></span>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:32px">查看人生时间线 →</button>
    </div>
  `;
}

function renderResultTimeline(): string {
  const s = state.result!.scriptA;
  return `
    <div class="screen" data-screen="result-timeline">
      ${renderResultNav('result-timeline')}
      <div class="section-title">人生时间线</div>
      <div class="timeline">
        ${s.timeline
          .map(
            (t) => `
          <div class="timeline-item ${t.type}">
            <div class="timeline-dot"></div>
            <div class="timeline-year">${t.year}${t.type === 'milestone' ? ' ★' : t.type === 'turning' ? ' ◎' : ' ●'}</div>
            <div class="timeline-label">${escapeHtml(t.label)}</div>
            <div class="timeline-event">${escapeHtml(t.event)}</div>
          </div>`
          )
          .join('')}
      </div>
      <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:32px">查看状态报告 →</button>
    </div>
  `;
}

function renderResultReport(): string {
  const s = state.result!.scriptA;
  const r = s.report;
  const d = s.dna;
  return `
    <div class="screen" data-screen="result-report">
      ${renderResultNav('result-report')}
      <div class="section-title">人生状态报告</div>
      <div class="report-grid">
        <div class="report-card highlight">
          <div class="label">人生主线</div>
          <div class="value">${escapeHtml(r.mainQuest)}</div>
        </div>
        <div class="report-card">
          <div class="label">最大成长</div>
          <div class="value">${escapeHtml(r.maxGrowth)}</div>
        </div>
        <div class="report-card">
          <div class="label">最大遗憾</div>
          <div class="value">${escapeHtml(r.maxRegret)}</div>
        </div>
        <div class="report-card">
          <div class="label">成长阻力</div>
          <div class="value">${escapeHtml(d.growthResistance)}</div>
        </div>
        <div class="report-card">
          <div class="label">未来机会</div>
          <div class="value">${escapeHtml(d.futureOpportunity)}</div>
        </div>
        <div class="report-card">
          <div class="label">宇宙备注</div>
          <div class="value">${escapeHtml(r.universeNote)}</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-next" style="margin-top:32px">查看宇宙观察报告 →</button>
    </div>
  `;
}

function renderUniverse(): string {
  const u = state.result!.universeReport;
  return `
    <div class="screen" data-screen="universe">
      <div class="section-title">宇宙观察报告</div>
      <div class="universe-card">
        <div class="universe-tone">${escapeHtml(u.tone)} · ${escapeHtml(u.name)}</div>
        <div class="universe-text">${escapeHtml(u.text)}</div>
        <div class="universe-sub">${escapeHtml(u.subtext)}</div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-next">生成分享海报 →</button>
    </div>
  `;
}

function renderPoster(): string {
  const r = state.result!;
  const s = r.scriptA;
  return `
    <div class="screen" data-screen="poster">
      <div class="section-title">分享海报</div>
      <div class="poster-preview" id="poster-canvas">
        <div class="poster-year">来自 2031 年的自己</div>
        <div class="poster-quote">「${escapeHtml(r.shareQuote)}」</div>
        <div class="poster-script">${escapeHtml(s.name)}</div>
        <div class="poster-dna">
          ${DIMS.map((d) => `<div class="poster-dna-bar" title="${getDimLabel(d)}"><i style="width:${r.dna[d]}%"></i></div>`).join('')}
        </div>
        <div class="poster-footer">${escapeHtml(s.poster.footer)}</div>
      </div>
      <div class="actions-row">
        <button class="btn btn-ghost btn-sm" id="btn-copy">复制文案</button>
        <button class="btn btn-ghost btn-sm" id="btn-save">保存海报</button>
      </div>
      <button class="btn btn-primary btn-block" id="btn-share" style="margin-top:12px">
        ${state.shared ? '查看平行宇宙对比 →' : '分享给朋友 · 解锁平行宇宙'}
      </button>
      <button class="btn btn-ghost btn-block" id="btn-restart" style="margin-top:8px">重新推演</button>
    </div>
  `;
}

function renderParallel(): string {
  const r = state.result!;
  const a = r.scriptA;
  const b = r.scriptB;
  const contrast = a.parallelContrast;
  return `
    <div class="screen" data-screen="parallel">
      <div class="parallel-header">
        <h2>平行宇宙对比</h2>
        <p>${escapeHtml(contrast.prefix)}，${escapeHtml(contrast.suffix)}</p>
      </div>
      <div class="compare-cards">
        <div class="compare-card active">
          <div class="compare-badge">时间线 A · 当前</div>
          <div class="compare-name">${escapeHtml(a.name)}</div>
          <div class="compare-tagline">${escapeHtml(a.tagline)}</div>
        </div>
        <div class="compare-card alt">
          <div class="compare-badge">时间线 B · 平行宇宙</div>
          <div class="compare-name">${escapeHtml(b.name)}</div>
          <div class="compare-tagline">${escapeHtml(b.tagline)}</div>
        </div>
      </div>
      <div class="report-card" style="margin-top:20px">
        <div class="label">如果当年选了另一条路</div>
        <div class="value">${escapeHtml(b.report.mainQuest)}</div>
      </div>
      <button class="btn btn-primary btn-block" id="btn-restart" style="margin-top:24px">让朋友也来测 →</button>
    </div>
  `;
}

function renderResultNav(current: Screen): string {
  return `
    <div class="result-nav">
      ${RESULT_SCREENS.map((s) => `<button class="nav-dot ${s === current ? 'active' : ''}" data-goto="${s}" type="button" aria-label="${s}"></button>`).join('')}
    </div>
  `;
}

function render(): void {
  let html = '';
  switch (state.screen) {
    case 'intro':
      html = renderIntro();
      break;
    case 'quiz':
      html = renderQuiz();
      break;
    case 'dna':
      html = renderDna();
      break;
    case 'result-identity':
      html = renderResultIdentity();
      break;
    case 'result-timeline':
      html = renderResultTimeline();
      break;
    case 'result-report':
      html = renderResultReport();
      break;
    case 'universe':
      html = renderUniverse();
      break;
    case 'poster':
      html = renderPoster();
      break;
    case 'parallel':
      html = renderParallel();
      break;
  }
  app.innerHTML = html;
  bindEvents();
}

function selectAnswer(key: AnswerKey) {
  const idx = state.questionIndex;
  const q = QUESTIONS[idx];
  if (state.answers[q.id] === key) return;

  state.answers[q.id] = key;
  if (state.undoTimer) clearTimeout(state.undoTimer);
  state.undoTimer = null;

  if (idx < 11) {
    state.selectedKey = null;
    state.questionIndex = idx + 1;
    saveSession();
    render();
    return;
  }

  state.selectedKey = key;
  saveSession();
  render();
}

function finishQuiz() {
  state.result = computeResult(state.answers, state.sessionId);
  setScreen('dna');
  setTimeout(() => setScreen('result-identity'), 2500);
}

function showToast(msg: string) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

async function copyQuote() {
  const text = `「${state.result!.shareQuote}」\n— ${state.result!.scriptA.name}\n${state.result!.scriptA.poster.footer}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('文案已复制');
  } catch {
    showToast('复制失败，请手动复制');
  }
}

function savePoster() {
  const r = state.result!;
  const s = r.scriptA;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const grad = ctx.createLinearGradient(0, 0, 1080, 400);
  grad.addColorStop(0, 'rgba(138,93,255,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 600);

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '28px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('来自 2031 年的自己', 540, 200);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 52px "Noto Sans SC", sans-serif';
  wrapText(ctx, `「${r.shareQuote}」`, 540, 420, 900, 72);

  ctx.fillStyle = '#8A5DFF';
  ctx.font = '36px "Noto Sans SC", sans-serif';
  ctx.fillText(s.name, 540, 900);

  DIMS.forEach((d, i) => {
    const x = 240 + i * 120;
    const y = 1050;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y, 80, 8);
    ctx.fillStyle = '#5B8CFF';
    ctx.fillRect(x, y, (80 * r.dna[d]) / 100, 8);
  });

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '24px "Noto Sans SC", sans-serif';
  ctx.fillText(s.poster.footer, 540, 1200);

  const link = document.createElement('a');
  link.download = 'future-me-2031.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('海报已保存');
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const chars = [...text];
  let line = '';
  let offsetY = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, offsetY);
      line = ch;
      offsetY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, offsetY);
}

function runIntroAnimation() {
  const lines = 5;
  state.introLineIndex = 0;
  render();

  const interval = setInterval(() => {
    state.introLineIndex++;
    if (state.introLineIndex > lines) {
      clearInterval(interval);
    }
    const introScreen = document.querySelector('[data-screen="intro"]');
    if (introScreen) {
      const lineEls = introScreen.querySelectorAll('.intro-line');
      const ready = introScreen.querySelector('.intro-ready');
      const btn = document.getElementById('btn-start') as HTMLButtonElement | null;
      lineEls.forEach((el, i) => {
        el.classList.toggle('visible', i <= state.introLineIndex);
      });
      if (ready) ready.classList.toggle('visible', state.introLineIndex >= lines);
      if (btn) btn.disabled = state.introLineIndex < lines;
    }
  }, 700);
}

function bindEvents() {
  document.getElementById('btn-start')?.addEventListener('click', () => {
    state.questionIndex = 0;
    state.answers = {};
    state.result = null;
    state.shared = false;
    setScreen('quiz');
  });

  document.getElementById('btn-back')?.addEventListener('click', () => {
    if (state.undoTimer) clearTimeout(state.undoTimer);
    state.undoTimer = null;
    state.selectedKey = null;
    if (state.questionIndex > 0) {
      state.questionIndex--;
      const prevQ = QUESTIONS[state.questionIndex];
      delete state.answers[prevQ.id];
      saveSession();
    }
    render();
  });

  document.querySelectorAll('[data-answer]').forEach((el) => {
    el.addEventListener('click', () => {
      if (state.selectedKey) return;
      selectAnswer((el as HTMLElement).dataset.answer as AnswerKey);
    });
  });

  document.getElementById('btn-generate')?.addEventListener('click', finishQuiz);

  document.getElementById('btn-next')?.addEventListener('click', () => {
    const flow: Partial<Record<Screen, Screen>> = {
      'result-identity': 'result-timeline',
      'result-timeline': 'result-report',
      'result-report': 'universe',
      universe: 'poster',
    };
    const next = flow[state.screen];
    if (next) setScreen(next);
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      setScreen((el as HTMLElement).dataset.goto as Screen);
    });
  });

  document.getElementById('btn-copy')?.addEventListener('click', copyQuote);
  document.getElementById('btn-save')?.addEventListener('click', savePoster);

  document.getElementById('btn-share')?.addEventListener('click', () => {
    state.shared = true;
    saveSession();
    const text = `我测了「五年后的自己模拟器」，2031年的我是：${state.result!.scriptA.name}。来测测你的 → ${location.href}`;
    if (navigator.share) {
      navigator.share({ title: '五年后的自己模拟器', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
      showToast('链接已复制，发给朋友吧');
    }
    setScreen('parallel');
  });

  document.getElementById('btn-restart')?.addEventListener('click', () => {
    sessionStorage.removeItem('future-me-session');
    state.sessionId = createSessionId();
    state.questionIndex = 0;
    state.answers = {};
    state.result = null;
    state.shared = false;
    state.selectedKey = null;
    state.introLineIndex = 0;
    setScreen('intro');
    runIntroAnimation();
  });

}

loadSession();
render();

if (state.screen === 'intro') {
  runIntroAnimation();
}
