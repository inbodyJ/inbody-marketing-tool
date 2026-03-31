/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

// ─── 라우터 ──────────────────────────────────────────────────────────────────

const PAGES = {
  dashboard: { path: 'pages/dashboard.html', titleKey: 'nav.dashboard', breadcrumbKey: 'nav.dashboard' },
  create:    { path: 'pages/create.html',    titleKey: 'create.title',  breadcrumbKey: 'nav.create' },
  assets:    { path: 'pages/assets.html',    titleKey: 'assets.title',  breadcrumbKey: 'nav.assets' },
  library:   { path: 'pages/library.html',   titleKey: 'library.title', breadcrumbKey: 'nav.library' },
  youtube:   { path: 'pages/youtube.html',   titleKey: 'youtube.title', breadcrumbKey: 'nav.youtube' },
  brand:     { path: 'pages/brand.html',     titleKey: 'brand.title',   breadcrumbKey: 'brand.title' },
};

/* 번역 헬퍼 (i18n.js 로드 전 안전 fallback) */
const _t = (key, fallback) => window.t ? window.t(key) : (fallback || key);

let currentPage = '';

async function navigateTo(pageKey) {
  if (!PAGES[pageKey]) return;
  if (currentPage === pageKey) return;

  const page = PAGES[pageKey];
  currentPage = pageKey;

  // 네비 활성화
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === pageKey);
  });

  // 브레드크럼 업데이트
  const bc = document.getElementById('breadcrumb-current');
  if (bc) bc.textContent = _t(page.breadcrumbKey, page.breadcrumbKey);

  // 로딩 표시
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="flex-center" style="height:60vh;">
      <div class="loading-box"><div class="spinner"></div><p>${_t('nav.loading','페이지 로딩 중...')}</p></div>
    </div>`;

  try {
    const res = await fetch(page.path);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();
    main.innerHTML = html;

    // 페이지별 초기화
    initPage(pageKey);

    // 번역 적용 (동적으로 로드된 페이지의 data-i18n 속성 처리)
    window.applyLang?.(window.getCurrentLang?.() || 'ko');

    // URL 해시 동기화
    history.replaceState(null, '', `#${pageKey}`);
  } catch (e) {
    console.error(`[navigateTo] ${pageKey} 로드 실패:`, e);
    currentPage = '';  // 재시도 가능하도록 초기화
    main.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>
        <p style="font-weight:700;">${_t('nav.loadFail','페이지 로드 실패')}</p>
        <p class="text-muted">${e.message}</p>
        <button class="btn btn-outline" onclick="navigateTo('${pageKey}')">${_t('nav.retry','재시도')}</button>
      </div>`;
  }
}


function initPage(pageKey) {
  switch (pageKey) {
    case 'dashboard':
      window.currentPageRender = () => window.Dashboard?.render();
      window.Dashboard?.render();
      break;
    case 'create':
      window.Wizard?.init();
      break;
    case 'assets':
      window.currentPageRender = renderAssets;
      initAssetsPage();
      renderAssets();
      break;
    case 'library':
      window.currentPageRender = renderPrompts;
      initLibraryPage();
      renderPrompts();
      break;
    case 'youtube':
      initYoutubePage();
      break;
  }
}

// ─── 에셋 라이브러리 페이지 ──────────────────────────────────────────────────

function initAssetsPage() {
  document.getElementById('search-assets')?.addEventListener('input', (e) => {
    renderAssets({ search: e.target.value });
  });

  ['filter-category', 'filter-country', 'filter-channel'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      renderAssets({
        search: document.getElementById('search-assets')?.value,
        category: document.getElementById('filter-category')?.value,
        country: document.getElementById('filter-country')?.value,
        channel: document.getElementById('filter-channel')?.value,
      });
    });
  });
}

function renderAssets(filters = {}) {
  const grid = document.getElementById('assets-grid');
  if (!grid) return;

  let assets = window.Storage.getData(window.Storage.KEYS.ASSETS);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    assets = assets.filter((a) =>
      [a.text, a.copyHeadline, a.copySubtext, a.category, a.country, a.channel]
        .some((f) => f?.toLowerCase().includes(q))
    );
  }

  if (filters.category) assets = assets.filter((a) => a.category === filters.category);
  if (filters.country) assets = assets.filter((a) => a.country === filters.country);
  if (filters.channel) assets = assets.filter((a) => a.channel === filters.channel);

  const countEl = document.getElementById('assets-count');
  if (countEl) countEl.textContent = `${assets.length}${_t('common.items','개')}`;

  if (!assets.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-icon">🎨</span>
        <p>${_t('assets.noAssets','조건에 맞는 에셋이 없습니다.')}</p>
      </div>`;
    return;
  }

  grid.innerHTML = assets
    .map(
      (a) => `
    <div class="asset-card">
      <div class="asset-card-thumb">
        ${a.imageUrl
          ? `<img src="${a.imageUrl}" alt="${a.text}" loading="lazy" />`
          : `<div class="asset-card-thumb-placeholder">🎨</div>`
        }
        <div class="asset-card-overlay">
          <button class="btn btn-sm btn-primary" onclick="downloadAsset('${a.id}')">⬇ 다운로드</button>
          <button class="btn btn-sm btn-outline" style="background:rgba(255,255,255,0.9)" onclick="deleteAsset('${a.id}')">🗑</button>
        </div>
      </div>
      <div class="asset-card-body">
        <div class="asset-card-meta">
          <span class="badge badge-sm badge-primary">${a.category || '-'}</span>
          <span class="badge badge-sm badge-secondary">${a.country || '-'}</span>
          <span class="badge badge-sm badge-outline">${a.channel || '-'}</span>
        </div>
        <p class="asset-card-title">${a.copyHeadline || a.text}</p>
        <p class="asset-card-subtext">${a.copySubtext || ''}</p>
        <p class="asset-card-date">${formatDate(a.createdAt)}</p>
      </div>
    </div>`
    )
    .join('');
}

window.deleteAsset = function (id) {
  if (!confirm(_t('assets.deleteConfirm','이 에셋을 삭제하시겠습니까?'))) return;
  window.Storage.deleteItem(window.Storage.KEYS.ASSETS, id);
  renderAssets();
  updateBadges();
  showToast(_t('toast.deleted','삭제되었습니다.'), 'success');
};

window.downloadAsset = function (id) {
  const asset = window.Storage.getData(window.Storage.KEYS.ASSETS).find((a) => a.id === id);
  if (!asset?.imageUrl) { showToast(_t('toast.noImage','이미지가 없습니다.'), 'warning'); return; }
  const a = document.createElement('a');
  a.href = asset.imageUrl;
  a.download = `${asset.text || 'asset'}.png`;
  a.click();
};

// ─── 프롬프트 라이브러리 페이지 ─────────────────────────────────────────────

function initLibraryPage() {
}

function renderPrompts(filters = {}) {
  const grid = document.getElementById('prompts-grid');
  if (!grid) return;

  let prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    prompts = prompts.filter((p) =>
      [p.text, p.rationale, ...(p.tags || [])].some((f) => f?.toLowerCase().includes(q))
    );
  }

  if (filters.category) prompts = prompts.filter((p) => p.category === filters.category);
  if (filters.country) prompts = prompts.filter((p) => p.country === filters.country);

  const countEl = document.getElementById('prompts-count');
  if (countEl) countEl.textContent = `${prompts.length}${_t('common.items','개')}`;

  if (!prompts.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-icon">📚</span>
        <p>${_t('library.noPrompts','저장된 프롬프트가 없습니다.')}</p>
        <p class="text-muted">${_t('library.noPromptsHint','에셋 생성 시 프롬프트를 저장할 수 있습니다.')}</p>
      </div>`;
    return;
  }

  grid.innerHTML = prompts
    .map(
      (p) => `
    <div class="prompt-card">
      <div class="prompt-card-header">
        <div class="prompt-card-meta">
          <span class="badge badge-primary">${p.category || '-'}</span>
          <span class="badge badge-secondary">${p.country || '-'}</span>
          ${(p.tags || []).map((t) => `<span class="badge badge-outline">${t}</span>`).join('')}
        </div>
        <div class="prompt-card-actions">
          <button class="btn btn-sm btn-outline" onclick="copyPromptText('${p.id}')">📋 복사</button>
          <button class="btn btn-sm btn-danger" onclick="deletePrompt('${p.id}')">🗑</button>
        </div>
      </div>
      <p class="prompt-text">${p.text}</p>
      ${p.negativePrompt ? `<div class="prompt-negative">❌ ${p.negativePrompt}</div>` : ''}
      ${p.rationale ? `<p style="font-size:var(--text-xs);color:var(--color-text-light);margin-bottom:var(--space-2);">💡 ${p.rationale}</p>` : ''}
      <div class="prompt-card-footer">
        <div class="prompt-stats">
          <span>${_t('library.colUses','사용')} ${p.useCount || 0}</span>
          <span>·</span>
          <span>${formatDate(p.createdAt)}</span>
        </div>
        <div class="star-rating" data-id="${p.id}">
          ${[1,2,3,4,5].map((n) =>
            `<span class="star ${(p.rating || 0) >= n ? 'filled' : ''}"
              onclick="ratePrompt('${p.id}', ${n})">★</span>`
          ).join('')}
        </div>
      </div>
    </div>`
    )
    .join('');
}

window.deletePrompt = function (id) {
  if (!confirm(_t('library.deleteConfirm','이 프롬프트를 삭제하시겠습니까?'))) return;
  window.Storage.deleteItem(window.Storage.KEYS.PROMPTS, id);
  renderPrompts();
  updateBadges();
  showToast(_t('toast.deleted','삭제되었습니다.'), 'success');
};

window.copyPromptText = function (id) {
  const p = window.Storage.getData(window.Storage.KEYS.PROMPTS).find((p) => p.id === id);
  if (!p) return;
  navigator.clipboard.writeText(p.text).then(() => {
    window.Storage.updateItem(window.Storage.KEYS.PROMPTS, id, { useCount: (p.useCount || 0) + 1 });
    showToast(_t('toast.copied','클립보드에 복사되었습니다!'), 'success');
  });
};

window.ratePrompt = function (id, rating) {
  window.Storage.updateItem(window.Storage.KEYS.PROMPTS, id, { rating });
  renderPrompts({
    search: document.getElementById('search-prompts')?.value,
    category: document.getElementById('filter-prompt-category')?.value,
    country: document.getElementById('filter-prompt-country')?.value,
  });
};

function showAddPromptModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'add-prompt-modal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${_t('library.addModalTitle','프롬프트 직접 추가')}</h2>
        <button class="modal-close" onclick="document.getElementById('add-prompt-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:var(--space-4)">
          <label class="form-label">${_t('library.promptLabel','이미지 프롬프트')} *</label>
          <textarea class="form-input" id="new-prompt-text" rows="4" placeholder="${_t('create.imgPromptPlaceholder','이미지 생성 프롬프트...')}"></textarea>
        </div>
        <div class="form-group" style="margin-bottom:var(--space-4)">
          <label class="form-label">${_t('library.negLabel','네거티브 프롬프트')}</label>
          <textarea class="form-input" id="new-prompt-negative" rows="2" placeholder="${_t('create.negPromptPlaceholder','포함하지 않을 요소...')}"></textarea>
        </div>
        <div class="form-grid" style="margin-bottom:var(--space-4)">
          <div class="form-group">
            <label class="form-label">${_t('library.categoryLabel','카테고리')}</label>
            <select class="form-input" id="new-prompt-category">
              <option value="">-</option>
              <option value="sns">SNS</option>
              <option value="b2b">B2B</option>
              <option value="event">${_t('assets.tab_event','이벤트')}</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${_t('library.countryLabel','국가')}</label>
            <select class="form-input" id="new-prompt-country">
              <option value="">-</option>
              <option value="AU">${_t('common.country_au','호주')}</option>
              <option value="UK">${_t('common.country_uk','영국')}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${_t('library.tagsInputLabel','태그 (쉼표 구분)')}</label>
          <input type="text" class="form-input" id="new-prompt-tags" placeholder="e.g. professional, fitness, b2b" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('add-prompt-modal').remove()">${_t('common.cancel','취소')}</button>
        <button class="btn btn-primary" onclick="saveNewPrompt()">${_t('common.save','저장')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

window.saveNewPrompt = function () {
  const text = document.getElementById('new-prompt-text')?.value?.trim();
  if (!text) { showToast(_t('toast.enterPrompt','프롬프트를 입력해주세요.'), 'warning'); return; }

  const tagsRaw = document.getElementById('new-prompt-tags')?.value || '';
  const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

  window.Storage.addItem(window.Storage.KEYS.PROMPTS, {
    text,
    negativePrompt: document.getElementById('new-prompt-negative')?.value || '',
    category: document.getElementById('new-prompt-category')?.value || '',
    country: document.getElementById('new-prompt-country')?.value || '',
    tags,
    rating: 0,
    useCount: 0,
  });

  document.getElementById('add-prompt-modal')?.remove();
  renderPrompts();
  updateBadges();
  showToast(_t('toast.promptSaved','프롬프트가 저장되었습니다!'), 'success');
};

// ─── 유튜브 페이지 ───────────────────────────────────────────────────────────

function initYoutubePage() {
  window.switchYoutubeTab?.('thumbnail');
  // 이벤트 바인딩 + 히스토리 초기 렌더
  // (youtube.js의 _ytInitPage에서 처리 — innerHTML 로드 후 DOM 준비됨)
  window._ytInitPage?.();
}

// ─── 토스트 시스템 ───────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️', loading: '⏳' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;

  container.appendChild(toast);

  // loading 타입은 자동 닫기 없음 (호출자가 직접 제거)
  if (type === 'loading') return toast;

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);

  return toast;
}

window.showToast = showToast;

// ─── 배지 업데이트 ───────────────────────────────────────────────────────────

function updateBadges() {
  const assetCount = window.Storage.getData(window.Storage.KEYS.ASSETS).length;
  const promptCount = window.Storage.getData(window.Storage.KEYS.PROMPTS).length;
  const ytDoneCount = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS)
    .filter(j => j.status === 'done').length;

  const el = (id, val) => {
    const e = document.getElementById(id);
    if (e) e.textContent = val;
  };

  el('badge-assets', assetCount);
  el('badge-prompts', promptCount);
  el('badge-youtube', ytDoneCount);
}

window.updateBadges = updateBadges;

// ─── 서버 상태 확인 ─────────────────────────────────────────────────────────

async function checkServer() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const sdot = document.getElementById('sidebar-status-dot');
  const stext = document.getElementById('sidebar-status-text');

  try {
    const result = await window.API.checkServerHealth();
    if (result.ok) {
      [dot, sdot].forEach(d => {
        d?.classList.add('connected');
        d?.classList.remove('disconnected');
      });
      [text, stext].forEach(el => {
        if (el) {
          el.setAttribute('data-i18n', 'common.serverConnected');
          el.textContent = _t('common.serverConnected', '🟢 서버 연결됨');
        }
      });
    } else {
      throw new Error(result.message);
    }
  } catch {
    [dot, sdot].forEach(d => {
      d?.classList.add('disconnected');
      d?.classList.remove('connected');
    });
    [text, stext].forEach(el => {
      if (el) {
        el.setAttribute('data-i18n', 'common.serverDisconnected');
        el.textContent = _t('common.serverDisconnected', '🔴 서버 오프라인');
      }
    });
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const loc = window.getCurrentLang?.() === 'en' ? 'en-AU' : 'ko-KR';
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncateText(text, maxLength = 40) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

window.formatDate    = formatDate;
window.truncateText  = truncateText;
window.debounce      = debounce;

// ─── 툴팁 ────────────────────────────────────────────────────────────────────

window.toggleTooltip = function toggleTooltip(iconEl) {
  const isActive = iconEl.classList.contains('active');
  document.querySelectorAll('.tooltip-icon.active').forEach((el) => el.classList.remove('active'));
  if (!isActive) iconEl.classList.add('active');
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.tooltip-wrap')) {
    document.querySelectorAll('.tooltip-icon.active').forEach((el) => el.classList.remove('active'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.tooltip-icon.active').forEach((el) => el.classList.remove('active'));
  }
});

// ─── 초기화 ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // 사이드바 토글
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // 네비게이션 이벤트
  document.getElementById('main-nav')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-page]');
    if (item) {
      e.preventDefault();
      navigateTo(item.dataset.page);
    }
  });

  // 초기 페이지 (해시 또는 대시보드)
  const hash = location.hash.replace('#', '');
  const initialPage = PAGES[hash] ? hash : 'dashboard';

  // 초기 사이드바 활성화
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === initialPage);
  });

  // 배지 업데이트
  updateBadges();

  // 서버 상태 확인
  checkServer();
  setInterval(checkServer, 30000);

  // 첫 페이지 로드
  navigateTo(initialPage);
});
