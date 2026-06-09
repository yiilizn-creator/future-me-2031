import { QUESTIONS } from './questions.js';
import { createEngine } from './engine.js';

const RESULT_SCREENS = ['result-identity', 'result-share'];
const TOTAL_QUESTIONS = QUESTIONS.length;
const LEAK_TRIGGER_COUNT = 6;
const LEAK_SCREENS = ['future-leak-loading', 'future-leak'];
const LEGACY_LEAK_SCREENS = ['future-leak-scan', 'future-leak-os'];
const POST_RESULT_SCREENS = ['dna', 'result-identity', 'result-share'];
const LEGACY_RESULT_SCREENS = [
  'result-timeline',
  'result-report',
  'universe',
  'poster',
  'parallel',
];

const DNA_BAR_ORDER = [
  { key: 'F', label: '自由驱动' },
  { key: 'M', label: '探索欲' },
  { key: 'A', label: '行动力' },
  { key: 'C', label: '创造欲' },
  { key: 'R', label: '认可驱动' },
];
const DNA_BLOCKS = 10;

const app = document.getElementById('app');
let introTimer = null;
let leakFlowTimer = null;
let leakAnimTimer = null;
let quizSubmitting = false;

const state = {
  screen: 'intro',
  sessionId: '',
  questionIndex: 0,
  answers: {},
  result: null,
  shared: false,
  selectedKey: null,
  undoTimer: null,
  introLineIndex: 0,
  introLines: null,
  futureLeakSeen: false,
  futureLeak: null,
  leakLineIndex: -1,
  leakShowButton: false,
  leakShownAt: 0,
};

let engine = null;
let DIMS = [];
let getDimLabel = (d) => d;
let createSessionId = () => '';
let computeResult = () => null;
let computeFutureLeak = () => null;
let pseudoIntroStats = () => ({});

async function bootstrap() {
  if (new URLSearchParams(location.search).has('reset')) {
    sessionStorage.removeItem('future-me-session');
  }

  const [answerMap, scriptsData, universeReportData, futureLeakData] = await Promise.all([
    fetch('./data/answerMap.json').then((r) => r.json()),
    fetch('./data/scripts.json').then((r) => r.json()),
    fetch('./data/universeReport.json').then((r) => r.json()),
    fetch('./data/futureLeak.json').then((r) => r.json()),
  ]);

  engine = createEngine(answerMap, scriptsData, universeReportData, futureLeakData);
  DIMS = engine.DIMS;
  getDimLabel = engine.getDimLabel;
  createSessionId = engine.createSessionId;
  computeResult = engine.computeResult;
  computeFutureLeak = engine.computeFutureLeak;
  pseudoIntroStats = engine.pseudoIntroStats;

  state.sessionId = createSessionId();
  loadSession();
  render();
  if (state.screen === 'intro') runIntroAnimation();
}

function getQuizProgress() {
  const answered = Object.keys(state.answers).length;
  const currentNo = state.questionIndex + 1;
  const percent =
    answered >= TOTAL_QUESTIONS
      ? 100
      : Math.round((currentNo / TOTAL_QUESTIONS) * 100);

  return {
    answered,
    total: TOTAL_QUESTIONS,
    currentNo,
    percent,
  };
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
      futureLeakSeen: state.futureLeakSeen,
      futureLeak: state.futureLeak,
      leakLineIndex: state.leakLineIndex,
      leakShowButton: state.leakShowButton,
    })
  );
}

function trackEvent(name, payload = {}) {
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[analytics]', name, payload);
  }
}

function getShareLink() {
  const url = new URL(location.href);
  url.search = '?reset=1';
  url.hash = '';
  return url.toString();
}

function buildShareText() {
  const r = state.result;
  const quote = r?.shareQuote ?? '';
  const name = r?.scriptA?.name ?? '五年后的自己';
  return `${quote}\n\n— ${name}\n\n来测测你的五年后 → ${getShareLink()}`;
}

function hideShareCopySheet() {
  document.getElementById('share-copy-sheet')?.remove();
}

function showShareCopySheet(text) {
  hideShareCopySheet();
  const overlay = document.createElement('div');
  overlay.id = 'share-copy-sheet';
  overlay.className = 'share-copy-sheet verdict-pixel';
  overlay.innerHTML = `
    <div class="share-copy-mask"></div>
    <div class="share-copy-panel">
      <p class="share-copy-title">分享文案</p>
      <pre class="share-copy-body">${escapeHtml(text)}</pre>
      <p class="share-copy-hint">文案已复制，粘贴发给朋友吧</p>
      <button type="button" class="btn btn-primary btn-block" id="btn-share-copy-close">知道了</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-share-copy-close')?.addEventListener('click', hideShareCopySheet);
  overlay.querySelector('.share-copy-mask')?.addEventListener('click', hideShareCopySheet);
}

async function shareToFriend() {
  if (!state.result) return;

  state.shared = true;
  saveSession();
  trackEvent('future_leak_share', { action: 'btn-share' });

  const text = buildShareText();

  if (navigator.share) {
    try {
      await navigator.share({
        title: '五年后的自己模拟器',
        text,
      });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast('复制失败，请手动复制');
    showShareCopySheet(text);
    return;
  }

  showShareCopySheet(text);
}

function getFirstUnansweredIndex() {
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    if (!state.answers[QUESTIONS[i].id]) {
      return i;
    }
  }
  return TOTAL_QUESTIONS - 1;
}

function syncQuestionIndex() {
  state.questionIndex = getFirstUnansweredIndex();
}

function loadSession() {
  const raw = sessionStorage.getItem('future-me-session');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (!data.answers) return;

    const answerCount = Object.keys(data.answers).length;
    if (answerCount === 0) return;

    state.sessionId = data.sessionId ?? state.sessionId;
    state.answers = data.answers;
    state.shared = data.shared ?? false;
    state.futureLeakSeen = data.futureLeakSeen ?? false;
    state.futureLeak = data.futureLeak ?? null;
    state.leakLineIndex = data.leakLineIndex ?? -1;
    state.leakShowButton = data.leakShowButton ?? false;
    syncQuestionIndex();

    if (!state.futureLeakSeen && answerCount > LEAK_TRIGGER_COUNT) {
      state.futureLeakSeen = true;
      state.futureLeak = computeFutureLeak(state.answers, state.sessionId);
    }

    if (LEAK_SCREENS.includes(data.screen) || LEGACY_LEAK_SCREENS.includes(data.screen)) {
      if (!state.futureLeak && answerCount >= LEAK_TRIGGER_COUNT) {
        state.futureLeak = computeFutureLeak(state.answers, state.sessionId);
      }
      state.screen = 'future-leak';
      state.leakLineIndex = Math.max(
        state.leakLineIndex,
        (state.futureLeak?.lines?.length ?? 1) - 1
      );
      state.leakShowButton = true;
      state.futureLeakSeen = true;
    }

    if (answerCount === TOTAL_QUESTIONS) {
      state.result = computeResult(state.answers, state.sessionId);
      if (data.screen && data.screen !== 'intro') {
        state.screen = LEGACY_RESULT_SCREENS.includes(data.screen)
          ? 'result-share'
          : data.screen;
      }
      return;
    }

    state.result = null;
    if (data.screen && POST_RESULT_SCREENS.includes(data.screen)) {
      state.screen = 'quiz';
    } else if (data.screen && data.screen !== 'intro') {
      state.screen = data.screen;
    }
  } catch {
    /* ignore */
  }
}

function setScreen(screen) {
  state.screen = screen;
  saveSession();
  render();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 逗号后换行（用于传播页标题 / 标签） */
function formatCommaBreak(text) {
  return escapeHtml(text).replace(/([，,])/g, '$1<br>');
}

function renderDnaBars(dna) {
  return DNA_BAR_ORDER.map(({ key, label }) => {
    const filled = Math.round((dna[key] / 100) * DNA_BLOCKS);
    const bar =
      '█'.repeat(Math.max(0, filled)) +
      '░'.repeat(Math.max(0, DNA_BLOCKS - filled));
    return `
      <div class="dna-bar-row">
        <span class="dna-bar-label">${label}</span>
        <span class="dna-bar-track" aria-label="${label} ${dna[key]}%">${bar}</span>
      </div>`;
  }).join('');
}

function getIntroLines() {
  const stats = pseudoIntroStats(state.sessionId);
  return [
    '未来档案加载中...',
    '正在扫描过去的人生选择...',
    `发现：${stats.hesitations} 次犹豫`,
    `${stats.abandoned} 个半途而废的计划`,
    `${stats.unsent} 条未发送的消息`,
  ];
}

function renderIntro() {
  const lines = state.introLines ?? getIntroLines();

  return `
    <div class="screen intro-screen verdict-pixel" data-screen="intro">
      <h1 class="intro-title verdict-pixel">开启我的2031</h1>
      <div class="intro-lines">
        ${lines
          .map(
            (line, i) =>
              `<p class="intro-line ${i <= state.introLineIndex ? 'visible' : ''} ${i >= 2 && i <= 4 ? 'highlight' : ''}">${escapeHtml(line)}</p>`
          )
          .join('')}
      </div>
      <p class="intro-ready ${state.introLineIndex >= lines.length ? 'visible' : ''}">未来已准备就绪</p>
      <div class="intro-actions">
        <button class="btn btn-primary" id="btn-start" type="button" ${state.introLineIndex < lines.length ? 'disabled' : ''}>
          开始推演未来
        </button>
      </div>
    </div>
  `;
}

function renderQuiz() {
  const q = QUESTIONS[state.questionIndex];
  if (!q) {
    return '<div class="screen"><p class="intro-line visible">扫描层加载异常，请刷新重试</p></div>';
  }

  const progress = getQuizProgress();
  const layer = String(progress.currentNo).padStart(2, '0');
  const progressDots = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
    const done = i < progress.answered;
    const active = i === progress.answered && progress.answered < TOTAL_QUESTIONS;
    return `<span class="progress-dot ${done ? 'done' : ''} ${active ? 'active' : ''}"></span>`;
  }).join('');

  return `
    <div class="screen screen-quiz verdict-pixel" data-screen="quiz">
      <div class="quiz-header">
        ${state.questionIndex > 0 ? '<button class="quiz-back" id="btn-back" type="button">← 上一题</button>' : '<div class="quiz-back-placeholder"></div>'}
        <div class="progress-panel">
          <div class="clarity-label">
            <span>未来清晰度</span>
            <span class="clarity-value">${progress.percent}%</span>
          </div>
          <div class="clarity-bar" role="progressbar" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100">
            <div class="clarity-fill" style="width:${progress.percent}%"></div>
          </div>
          <div class="progress-meta">
            <span>第 ${layer} / ${TOTAL_QUESTIONS} 题</span>
            <span>已答 ${progress.answered} / ${TOTAL_QUESTIONS}</span>
          </div>
          <div class="progress-dots" aria-hidden="true">${progressDots}</div>
        </div>
      </div>
      <div class="quiz-body">
        <h2 class="question-title">${escapeHtml(q.text)}</h2>
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
      </div>
      <div class="quiz-footer"></div>
    </div>
  `;
}

function renderDna() {
  return `
    <div class="screen screen-verdict dna-screen verdict-pixel" data-screen="dna">
      <p class="verdict-from">来自2031年的自己</p>
      <p class="dna-loading">Future DNA Analysis…</p>
    </div>
  `;
}

function renderFutureLeakLoading() {
  return `
    <div class="screen screen-leak screen-leak-loading verdict-pixel" data-screen="future-leak-loading">
      <p class="leak-loading-text verdict-pixel">正在扫描未来...</p>
      <div class="leak-scan-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        <div class="leak-scan-fill"></div>
      </div>
    </div>
  `;
}

function renderFutureLeak() {
  const leak = state.futureLeak;
  const lines = leak?.lines ?? [];
  return `
    <div class="screen screen-leak screen-leak-reveal verdict-pixel" data-screen="future-leak">
      <p class="leak-archive">Future Archive #2031</p>
      <div class="leak-lines">
        ${lines
          .map(
            (line, i) =>
              `<p class="leak-line ${i <= state.leakLineIndex ? 'visible' : ''}">${escapeHtml(line)}</p>`
          )
          .join('')}
      </div>
      <p class="leak-confidence ${state.leakLineIndex >= 0 ? 'visible' : ''}">Confidence ${leak?.confidence ?? 81}%</p>
      <button class="btn btn-primary btn-block leak-continue ${state.leakShowButton ? 'visible' : ''}" id="btn-leak-continue" type="button">继续查看未来 →</button>
    </div>
  `;
}

function renderResultNav(current) {
  return `
    <div class="result-nav result-nav-min">
      ${RESULT_SCREENS.map((s) => `<button class="nav-dot ${s === current ? 'active' : ''}" data-goto="${s}" type="button" aria-label="${s}"></button>`).join('')}
    </div>
  `;
}

function renderResultIdentity() {
  const s = state.result.scriptA;
  const dna = state.result.dna;
  return `
    <div class="screen screen-verdict screen-identity verdict-pixel" data-screen="result-identity">
      ${renderResultNav('result-identity')}
      <div class="verdict-body">
        <p class="verdict-from">来自2031年的自己</p>
        <h1 class="verdict-name">${escapeHtml(s.name)}</h1>
        <div class="dna-bars">${renderDnaBars(dna)}</div>
        <p class="verdict-system">Future DNA Analysis Complete</p>
      </div>
      <button class="btn btn-primary btn-block" id="btn-next" type="button">开启2031</button>
    </div>
  `;
}

function renderResultShare() {
  const r = state.result;
  const s = r.scriptA;
  const tags = (r.lifeTags ?? s.verdict?.lifeTags ?? []).slice(0, 3);
  return `
    <div class="screen screen-verdict screen-share verdict-pixel" data-screen="result-share">
      ${renderResultNav('result-share')}
      <div id="share-capture-root" class="share-capture-root">
        <p class="share-header verdict-pixel">来自2031年的自己</p>
        <div class="verdict-body verdict-body-share">
          <p class="share-quote verdict-pixel">${formatCommaBreak(r.shareQuote)}</p>
          <div class="share-tags">
            ${tags.map((t) => `<span class="share-tag verdict-pixel">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="share-actions">
        <button class="btn btn-primary btn-block" id="btn-share" type="button">分享给朋友</button>
        <div class="actions-row">
          <button class="btn btn-ghost btn-sm verdict-pixel" id="btn-copy" type="button">复制判词</button>
          <button class="btn btn-ghost btn-sm verdict-pixel" id="btn-save" type="button">保存图片</button>
        </div>
        <button class="btn btn-ghost btn-block verdict-pixel" id="btn-restart" type="button">重新推演</button>
      </div>
    </div>
  `;
}

function ensureResult() {
  if (!state.result && Object.keys(state.answers).length === TOTAL_QUESTIONS) {
    state.result = computeResult(state.answers, state.sessionId);
  }
  return Boolean(state.result);
}

function refreshQuizScreen() {
  const current = document.querySelector('[data-screen="quiz"]');
  const html = renderQuiz();
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const next = holder.firstElementChild;
  if (current && next) {
    current.replaceWith(next);
  } else {
    app.innerHTML = html;
  }
  bindEvents();
}

function render() {
  if (!engine) {
    app.innerHTML =
      '<div class="screen intro-screen"><p class="intro-line visible">未来档案加载中...</p></div>';
    return;
  }

  if (POST_RESULT_SCREENS.includes(state.screen) && !ensureResult()) {
    state.screen = 'quiz';
    syncQuestionIndex();
  }

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
    case 'future-leak-loading':
      html = renderFutureLeakLoading();
      break;
    case 'future-leak':
      html = renderFutureLeak();
      break;
    case 'result-identity':
      html = renderResultIdentity();
      break;
    case 'result-share':
      html = renderResultShare();
      break;
  }
  app.innerHTML = html;
  bindEvents();

  if (state.screen === 'future-leak' && !state.leakShowButton && state.leakLineIndex < 0) {
    runLeakLineAnimation();
  } else if (state.screen === 'future-leak') {
    syncLeakDom();
  }
}

function selectAnswer(key) {
  const idx = state.questionIndex;
  const q = QUESTIONS[idx];
  if (!q || state.answers[q.id] === key) return;

  state.answers[q.id] = key;
  clearTimeout(state.undoTimer);
  state.undoTimer = null;
  state.selectedKey = null;
  saveSession();

  const answeredCount = Object.keys(state.answers).length;

  if (!state.futureLeakSeen && answeredCount === LEAK_TRIGGER_COUNT) {
    startFutureLeak();
    return;
  }

  if (answeredCount >= TOTAL_QUESTIONS) {
    finishQuiz();
    return;
  }

  const nextIndex = getFirstUnansweredIndex();
  if (nextIndex === idx) return;

  state.questionIndex = nextIndex;
  saveSession();
  refreshQuizScreen();
}

function finishQuiz() {
  if (quizSubmitting) return;
  if (Object.keys(state.answers).length < TOTAL_QUESTIONS) {
    showToast('请先完成全部 12 题');
    return;
  }
  if (state.screen !== 'quiz') return;

  quizSubmitting = true;
  state.result = computeResult(state.answers, state.sessionId);
  setScreen('dna');
  setTimeout(() => setScreen('result-identity'), 1800);
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

async function copyQuote() {
  const s = state.result.scriptA;
  const tags = (state.result.lifeTags ?? s.verdict?.lifeTags ?? []).slice(0, 3).join(' · ');
  const text = `${state.result.shareQuote}\n\n${s.name}${tags ? `\n${tags}` : ''}\n\n来自2031年的自己`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('文案已复制');
  } catch {
    showToast('复制失败，请手动复制');
  }
}

let html2canvasLoader = null;

function loadHtml2Canvas() {
  if (!html2canvasLoader) {
    html2canvasLoader = import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm').then(
      (mod) => mod.default
    );
  }
  return html2canvasLoader;
}

async function saveImageBlob(blob) {
  const file = new File([blob], 'future-me-2031.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '五年后的自己' });
      showToast('已唤起分享，可选择保存到相册');
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'future-me-2031.png';
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
  showToast('截图已保存，可在相册或下载中查看');
}

function composePosterCanvas(sourceCanvas) {
  const poster = document.createElement('canvas');
  poster.width = 1080;
  poster.height = 1920;
  const ctx = poster.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1080, 1920);

  const padding = 96;
  const maxW = 1080 - padding * 2;
  const maxH = 1920 - padding * 2;
  const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height);
  const drawW = sourceCanvas.width * scale;
  const drawH = sourceCanvas.height * scale;
  const x = (1080 - drawW) / 2;
  const y = (1920 - drawH) / 2;

  ctx.drawImage(sourceCanvas, x, y, drawW, drawH);
  return poster;
}

async function captureShareScreen() {
  const root = document.getElementById('share-capture-root');
  if (!root) {
    showToast('请在金句页使用截图保存');
    return;
  }

  const actions = document.querySelector('.screen-share .share-actions');

  showToast('正在生成分享海报…');
  if (actions) {
    actions.dataset.capturePrevVisibility = actions.style.visibility;
    actions.style.visibility = 'hidden';
  }

  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(root, {
      backgroundColor: '#000000',
      scale: Math.min(window.devicePixelRatio || 2, 3),
      useCORS: true,
      logging: false,
      allowTaint: true,
    });

    const poster = composePosterCanvas(canvas);
    const blob = await new Promise((resolve) => poster.toBlob(resolve, 'image/png', 1));
    if (!blob) {
      showToast('海报生成失败，请重试');
      return;
    }
    await saveImageBlob(blob);
  } catch (err) {
    console.error(err);
    showToast('海报生成失败，请重试');
  } finally {
    if (actions) {
      actions.style.visibility = actions.dataset.capturePrevVisibility || '';
      delete actions.dataset.capturePrevVisibility;
    }
  }
}

function stopIntroAnimation() {
  if (introTimer) {
    clearInterval(introTimer);
    introTimer = null;
  }
}

function stopLeakFlow() {
  if (leakFlowTimer) {
    clearTimeout(leakFlowTimer);
    leakFlowTimer = null;
  }
}

function stopLeakAnimation() {
  if (leakAnimTimer) {
    clearInterval(leakAnimTimer);
    leakAnimTimer = null;
  }
}

function syncLeakDom() {
  const screen = document.querySelector('[data-screen="future-leak"]');
  if (!screen) return;

  screen.querySelectorAll('.leak-line').forEach((el, i) => {
    el.classList.toggle('visible', i <= state.leakLineIndex);
  });
  screen.querySelector('.leak-confidence')?.classList.toggle('visible', state.leakLineIndex >= 0);
  document.getElementById('btn-leak-continue')?.classList.toggle('visible', state.leakShowButton);
}

function runLeakLineAnimation() {
  if (!state.futureLeak?.lines?.length) return;

  stopLeakAnimation();
  state.leakLineIndex = -1;
  state.leakShowButton = false;
  syncLeakDom();
  state.leakShownAt = Date.now();
  trackEvent('future_leak_show', { patternId: state.futureLeak.patternId });

  leakAnimTimer = setInterval(() => {
    if (state.leakLineIndex < state.futureLeak.lines.length - 1) {
      state.leakLineIndex++;
      syncLeakDom();
      saveSession();
    } else {
      stopLeakAnimation();
      leakFlowTimer = setTimeout(() => {
        state.leakShowButton = true;
        syncLeakDom();
        saveSession();
      }, 1500);
    }
  }, 300);
}

function startFutureLeak() {
  stopLeakFlow();
  stopLeakAnimation();
  state.futureLeak = computeFutureLeak(state.answers, state.sessionId);
  state.futureLeakSeen = true;
  state.leakLineIndex = -1;
  state.leakShowButton = false;
  saveSession();

  setScreen('future-leak-loading');
  leakFlowTimer = setTimeout(() => {
    setScreen('future-leak');
  }, 800);
}

function continueAfterLeak() {
  const duration = state.leakShownAt ? Date.now() - state.leakShownAt : 0;
  trackEvent('future_leak_continue', {
    patternId: state.futureLeak?.patternId,
    duration,
  });
  stopLeakFlow();
  stopLeakAnimation();
  state.questionIndex = getFirstUnansweredIndex();
  saveSession();
  setScreen('quiz');
}

function syncIntroDom() {
  const introScreen = document.querySelector('[data-screen="intro"]');
  if (!introScreen) return;

  const lineCount = state.introLines?.length ?? 0;
  introScreen.querySelectorAll('.intro-line').forEach((el, i) => {
    el.classList.toggle('visible', i <= state.introLineIndex);
  });

  const ready = introScreen.querySelector('.intro-ready');
  if (ready) ready.classList.toggle('visible', state.introLineIndex >= lineCount);

  const btn = document.getElementById('btn-start');
  if (btn) btn.disabled = state.introLineIndex < lineCount;
}

function runIntroAnimation() {
  state.introLines = getIntroLines();
  stopIntroAnimation();
  state.introLineIndex = 0;
  syncIntroDom();

  introTimer = setInterval(() => {
    if (state.introLineIndex < state.introLines.length) {
      state.introLineIndex++;
      syncIntroDom();
    } else {
      stopIntroAnimation();
    }
  }, 700);
}

function bindEvents() {
  document.getElementById('btn-start')?.addEventListener('click', () => {
    stopIntroAnimation();
    stopLeakFlow();
    stopLeakAnimation();
    quizSubmitting = false;
    state.questionIndex = 0;
    state.answers = {};
    state.result = null;
    state.shared = false;
    state.selectedKey = null;
    state.futureLeakSeen = false;
    state.futureLeak = null;
    state.leakLineIndex = -1;
    state.leakShowButton = false;
    setScreen('quiz');
  });

  document.getElementById('btn-leak-continue')?.addEventListener('click', continueAfterLeak);

  document.getElementById('btn-back')?.addEventListener('click', () => {
    clearTimeout(state.undoTimer);
    state.undoTimer = null;
    state.selectedKey = null;
    if (state.questionIndex > 0) {
      state.questionIndex--;
      const prevQ = QUESTIONS[state.questionIndex];
      delete state.answers[prevQ.id];
      saveSession();
    }
    refreshQuizScreen();
  });

  document.querySelectorAll('[data-answer]').forEach((el) => {
    el.addEventListener('click', () => {
      if (state.selectedKey) return;
      selectAnswer(el.dataset.answer);
    });
  });

  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (state.screen === 'result-identity') {
      setScreen('result-share');
    }
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => setScreen(el.dataset.goto));
  });

  document.getElementById('btn-copy')?.addEventListener('click', copyQuote);
  document.getElementById('btn-save')?.addEventListener('click', captureShareScreen);

  document.getElementById('btn-share')?.addEventListener('click', () => {
    shareToFriend();
  });

  document.getElementById('btn-restart')?.addEventListener('click', () => {
    stopLeakFlow();
    stopLeakAnimation();
    quizSubmitting = false;
    sessionStorage.removeItem('future-me-session');
    state.sessionId = createSessionId();
    state.questionIndex = 0;
    state.answers = {};
    state.result = null;
    state.shared = false;
    state.selectedKey = null;
    state.introLineIndex = 0;
    state.introLines = null;
    state.futureLeakSeen = false;
    state.futureLeak = null;
    state.leakLineIndex = -1;
    state.leakShowButton = false;
    setScreen('intro');
    runIntroAnimation();
  });

}

bootstrap().catch((err) => {
  console.error(err);
  app.innerHTML =
    '<div class="screen verdict-pixel"><p class="load-error">加载失败，请使用本地服务器运行（见 start.sh）</p></div>';
});
