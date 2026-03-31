/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

/**
 * dashboard.js — 대시보드 차트 및 통계 로직
 */

const Dashboard = (() => {
  const _t = (key, fallback) => window.t ? window.t(key) : fallback;
  // ─── 메인 렌더 ──────────────────────────────────────────────────────────────

  // ─── 국가별 현황 설정 ──────────────────────────────────────────────────────
  const COUNTRY_CONFIG = [
    { code: 'KR', labelKey: 'dashboard.country_kr', color: '#971B2F', fillClass: 'cu-ratio-fill' },
    { code: 'AU', labelKey: 'dashboard.country_au', color: '#A2B2C8', fillClass: 'cu-ratio-fill' },
    { code: 'UK', labelKey: 'dashboard.country_uk', color: '#4B4F5A', fillClass: 'cu-ratio-fill' },
  ];

  const CATEGORIES = ['sns', 'b2b', 'event', 'youtube'];

  /**
   * 🔐 관리자 모드 연결 포인트
   * - resetData(): 관리자 권한 확인 후 disabled 해제
   * - dm-card-reset: 관리자 로그인 시 opacity 1로 복원
   * - dm-admin-badge: 관리자 로그인 시 "관리자 모드" 배지 표시
   * - ADMIN_FEATURES = ['reset-all', 'reset-assets', 'reset-prompts']
   */
  function render() {
    const stats = window.Storage.getStats();
    updateMetricCards(stats);
    renderCategoryBarChart();
    renderCountryOverview();
    renderRecentAssets();
    renderTopPrompts();
    renderActivityTimeline();
  }

  // ─── D형 지표 카드 ─────────────────────────────────────────────────────────

  function updateMetricCards(stats) {
    const assets  = window.Storage.getData(window.Storage.KEYS.ASSETS);
    const prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS);
    const jobs    = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS);
    const doneJobs = jobs.filter(j => j.status === 'done');

    // 이번 달 / 전월 에셋
    const now = new Date();
    const thisMonth = assets.filter(a => {
      const d = new Date(a.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = assets.filter(a => {
      const d = new Date(a.createdAt);
      return d.getFullYear() === lastMonthDate.getFullYear() && d.getMonth() === lastMonthDate.getMonth();
    });
    const thisCount = thisMonth.length;
    const lastCount = lastMonth.length;
    const diff = thisCount - lastCount;

    // 전월 대비 증감 텍스트
    let diffText;
    if (lastCount === 0) {
      diffText = _t('dashboard.thisMonthNoData', '전월 데이터 없음');
    } else if (diff > 0) {
      diffText = _t('dashboard.thisMonthUp', '▲ {n}개 증가').replace('{n}', diff);
    } else if (diff < 0) {
      diffText = _t('dashboard.thisMonthDown', '▼ {n}개 감소').replace('{n}', Math.abs(diff));
    } else {
      diffText = _t('dashboard.thisMonthSame', '전월과 동일');
    }

    // 숫자 업데이트
    const el = id => document.getElementById(id);
    if (el('val-assets'))    el('val-assets').textContent    = assets.length;
    if (el('val-prompts'))   el('val-prompts').textContent   = prompts.length;
    if (el('val-youtube'))   el('val-youtube').textContent   = jobs.length;
    if (el('val-thismonth')) el('val-thismonth').textContent = thisCount;

    // 프로그레스 바 (4개 값 중 최대를 100% 기준으로 상대 표시)
    const maxVal = Math.max(assets.length, prompts.length, jobs.length, thisCount, 1);
    if (el('prog-assets'))    el('prog-assets').style.width    = Math.min((assets.length  / maxVal) * 100, 100) + '%';
    if (el('prog-prompts'))   el('prog-prompts').style.width   = Math.min((prompts.length / maxVal) * 100, 100) + '%';
    if (el('prog-youtube'))   el('prog-youtube').style.width   = Math.min((jobs.length    / maxVal) * 100, 100) + '%';
    if (el('prog-thismonth')) el('prog-thismonth').style.width = Math.min((thisCount      / maxVal) * 100, 100) + '%';

    // 설명 텍스트 (카드 1~3)
    const catCount  = [...new Set(assets.map(a => a.category).filter(Boolean))].length;
    const totalUses = prompts.reduce((s, p) => s + (p.useCount || 0), 0);
    if (el('desc-assets'))  el('desc-assets').textContent  = _t('dashboard.totalAssetsDesc',  '{n}개 카테고리').replace('{n}', catCount);
    if (el('desc-prompts')) el('desc-prompts').textContent = _t('dashboard.totalPromptsDesc', '총 {n}회 사용').replace('{n}', totalUses);
    if (el('desc-youtube')) el('desc-youtube').textContent = _t('dashboard.youtubeJobsDesc',  '완료: {n}개').replace('{n}', doneJobs.length);

    // 카드 4 증감 텍스트 + 색상
    const descEl = el('desc-thismonth');
    if (descEl) {
      descEl.textContent = diffText;
      descEl.style.color = diff > 0 ? '#2E6B2E'
                         : diff < 0 ? 'var(--ib-primary)'
                         : 'var(--color-text-light)';
    }
  }

  // ─── 카테고리 수평 바 차트 ──────────────────────────────────────────────────

  function renderCategoryBarChart() {
    const el = document.getElementById('category-bar-chart');
    if (!el) return;

    const allAssets = window.Storage.getData(window.Storage.KEYS.ASSETS);

    if (allAssets.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <p class="empty-title" data-i18n="dashboard.noCategoryData">${_t('dashboard.noCategoryData', '생성된 에셋이 없습니다.')}</p>
          <p class="empty-desc" data-i18n="dashboard.noCategoryDesc">${_t('dashboard.noCategoryDesc', '에셋을 생성하면 카테고리별로 자동 분류됩니다.')}</p>
          <a href="#" onclick="navigateTo('create');return false;" class="btn-empty-action">${_t('nav.create', '에셋 생성')}</a>
        </div>`;
      return;
    }

    const data = CATEGORIES.map(cat => {
      const rows = COUNTRY_CONFIG.map(cfg => ({
        code:  cfg.code,
        color: cfg.color,
        count: allAssets.filter(a => a.category === cat && (a.country || 'KR') === cfg.code).length,
      }));
      const total = rows.reduce((s, r) => s + r.count, 0);
      const flags = rows.filter(r => r.count > 0)
        .map(r => r.code === 'KR' ? '🇰🇷' : r.code === 'AU' ? '🇦🇺' : '🇬🇧').join('');
      return { cat, rows, total, flags };
    }).filter(d => d.total > 0)
      .sort((a, b) => b.total - a.total);

    const maxTotal = Math.max(...data.map(d => d.total), 1);

    const rows = data.map(d => {
      const segs = d.rows
        .filter(r => r.count > 0)
        .map(r => {
          const pct   = (r.count / maxTotal * 100).toFixed(1);
          const label = r.count >= 2 ? r.count : '';
          return `<div class="cat-bar-seg" style="width:${pct}%;background:${r.color}">${label}</div>`;
        }).join('');
      return `
        <div class="cat-bar-row">
          <span class="cat-bar-label">${getCatLabel(d.cat)}</span>
          <div class="cat-bar-track">${segs}</div>
          <span class="cat-bar-flags">${d.flags}</span>
          <span class="cat-bar-total">${d.total}</span>
        </div>`;
    }).join('');

    const legend = COUNTRY_CONFIG.map(cfg => `
      <div class="cbl-item">
        <div class="cbl-dot" style="background:${cfg.color}"></div>
        <span data-i18n="${cfg.labelKey}">${_t(cfg.labelKey, cfg.code)}</span>
      </div>`).join('');

    el.innerHTML = `
      <div class="cat-bar-list">${rows}</div>
      <div class="cat-bar-legend">${legend}</div>`;
  }

  // ─── 최근 에셋 ──────────────────────────────────────────────────────────────

  function renderRecentAssets() {
    const grid = document.getElementById('recent-assets-grid');
    if (!grid) return;

    const assets = window.Storage.getData(window.Storage.KEYS.ASSETS)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4);

    if (!assets.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;padding:2rem 0;">
          <div class="empty-icon">🖼️</div>
          <p class="empty-title" data-i18n="dashboard.noRecentAssets">${_t('dashboard.noRecentAssets', '아직 생성된 에셋이 없습니다.')}</p>
        </div>`;
      return;
    }

    grid.innerHTML = assets.map(a => {
      const thumb = a.imageUrl
        ? `<img src="${a.imageUrl}" alt="${a.text}" onerror="this.style.display='none'">`
        : `<span>🖼️</span>`;
      const catLabel = getCatLabel(a.category);
      const country  = a.country === 'AU' ? '🇦🇺' : a.country === 'UK' ? '🇬🇧' : '🇰🇷';
      const date     = getRelativeDate(a.createdAt);
      return `
        <a class="recent-asset-card" href="#" onclick="navigateTo('assets');return false;">
          <div class="recent-asset-thumb">${thumb}</div>
          <div class="recent-asset-body">
            <div class="recent-asset-meta">
              <span class="badge badge-${a.category}">${catLabel}</span>
              <span style="font-size:12px">${country}</span>
            </div>
            <p class="recent-asset-name">${a.text || catLabel}</p>
            <p class="recent-asset-date">${date}</p>
          </div>
        </a>`;
    }).join('');
  }

  // ─── 인기 프롬프트 ──────────────────────────────────────────────────────────

  function renderTopPrompts() {
    const container = document.getElementById('top-prompts');
    if (!container) return;

    const prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS)
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
      .slice(0, 5);

    if (!prompts.length) {
      container.innerHTML = `<p class="empty-text">${_t('dashboard.noPrompts', '저장된 프롬프트가 없습니다.')}</p>`;
      return;
    }

    container.innerHTML = `
      <div class="prompt-rank-list">
        ${prompts.map((p, i) => `
          <div class="prompt-rank-item">
            <span class="rank-num">${i + 1}</span>
            <div class="rank-info">
              <p class="rank-text">${p.text.substring(0, 80)}...</p>
              <div class="rank-meta">
                <span class="badge badge-sm badge-outline">${p.category || '-'}</span>
                <span class="rank-count">${_t('dashboard.rankUsePrefix', '사용 ')}${p.useCount || 0}${_t('dashboard.rankUseSuffix', '회')}</span>
                <span class="rank-rating">⭐ ${p.rating || 0}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ─── 활동 타임라인 ──────────────────────────────────────────────────────────

  function renderActivityTimeline() {
    const container = document.getElementById('activity-timeline');
    if (!container) return;

    const assets = window.Storage.getData(window.Storage.KEYS.ASSETS);
    const prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS);
    const jobs = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS);

    const events = [
      ...assets.map((a) => ({ type: 'asset', text: `${_t('dashboard.activityAssetCreated', '에셋 생성: ')}${a.text}`, date: a.createdAt })),
      ...prompts.map((p) => ({ type: 'prompt', text: _t('dashboard.activityPromptSaved', '프롬프트 저장'), date: p.createdAt })),
      ...jobs.map((j) => ({ type: 'youtube', text: `${_t('dashboard.activityYoutube', '유튜브 처리: ')}${j.text}`, date: j.createdAt })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    if (!events.length) {
      container.innerHTML = `<p class="empty-text">${_t('dashboard.noActivity', '활동 기록이 없습니다.')}</p>`;
      return;
    }

    const iconMap = { asset: '🎨', prompt: '📝', youtube: '📹' };

    container.innerHTML = `
      <div class="timeline">
        ${events.map((e) => `
          <div class="timeline-item">
            <div class="timeline-icon">${iconMap[e.type] || '•'}</div>
            <div class="timeline-body">
              <p class="timeline-text">${e.text}</p>
              <p class="timeline-date">${formatDate(e.date)}</p>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ─── 국가별 현황 (통합) ─────────────────────────────────────────────────────

  function getMiniChartPoints(country, allAssets) {
    const assets = allAssets.filter(a => (a.country || 'KR') === country);
    const counts = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const ds = d.toISOString().slice(0, 10);
      return assets.filter(a => a.createdAt?.slice(0, 10) === ds).length;
    });
    const max = Math.max(...counts, 1);
    return counts.map((v, i) => {
      const x = (i / 6) * 100;
      const y = 28 - (v / max) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  function getRelativeDate(isoString) {
    if (!isoString) return _t('dashboard.noActivity', '아직 없음');
    const diff = Math.floor((new Date() - new Date(isoString)) / 86400000);
    if (diff === 0) return _t('dashboard.today', '오늘');
    if (diff === 1) return _t('dashboard.yesterday', '어제');
    const lang = window.getCurrentLang?.() || 'ko';
    return lang === 'ko'
      ? `${diff}${_t('dashboard.daysAgo', '일 전')}`
      : `${diff} ${_t('dashboard.daysAgo', 'days ago')}`;
  }

  function getCatLabel(cat) {
    const map = {
      sns: 'SNS', b2b: 'B2B',
      event: _t('assets.tab_event') || '이벤트',
      youtube: 'YouTube',
    };
    return map[cat] || cat;
  }

  function renderCountryOverview() {
    const grid = document.getElementById('country-cards-grid');
    if (!grid) return;

    const allAssets = window.Storage.getData(window.Storage.KEYS.ASSETS);
    const total = allAssets.length;

    // 월 표시
    const monthEl = document.getElementById('overview-month');
    if (monthEl) {
      const now = new Date();
      const lang = window.getCurrentLang?.() || 'ko';
      monthEl.textContent = lang === 'ko'
        ? `${now.getFullYear()}년 ${now.getMonth() + 1}월`
        : now.toLocaleString('en', { month: 'long', year: 'numeric' });
    }

    grid.innerHTML = COUNTRY_CONFIG.map(cfg => {
      const assets  = allAssets.filter(a => (a.country || 'KR') === cfg.code);
      const count   = assets.length;
      const pct     = total > 0 ? Math.round((count / total) * 100) : 0;

      // 카테고리별 집계
      const catMap = {};
      assets.forEach(a => { catMap[a.category] = (catMap[a.category] || 0) + 1; });
      const catTags = Object.entries(catMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, n]) => `<span class="cu-cat cu-cat-${cat}">${getCatLabel(cat)} ${n}</span>`)
        .join('');

      // 마지막 생성일
      const sorted = assets.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const lastDate = sorted.length
        ? getRelativeDate(sorted[0].createdAt)
        : _t('dashboard.noActivity', '아직 없음');

      const miniPts = getMiniChartPoints(cfg.code, allAssets);
      const label   = _t(cfg.labelKey, cfg.code);

      return `
        <div class="cu-card">
          <div class="cu-card-top">
            <span class="cu-card-name" data-i18n="${cfg.labelKey}">${label}</span>
            <span class="cu-card-pct">${pct}%</span>
          </div>
          <div class="cu-card-num">
            ${count}<span>${_t('common.items', '개')}</span>
          </div>
          <div class="cu-mini-chart">
            <svg viewBox="0 0 100 28" preserveAspectRatio="none">
              <polyline points="${miniPts}" fill="none" stroke="${cfg.color}" stroke-width="2"/>
            </svg>
          </div>
          <div class="cu-cats">
            ${catTags || `<span class="cu-cat" style="background:var(--color-bg);color:var(--color-text-light)">${_t('dashboard.noActivity', '아직 없음')}</span>`}
          </div>
          <div class="cu-ratio-bg">
            <div class="${cfg.fillClass}" style="width:${pct}%;background:${cfg.color}"></div>
          </div>
          <div class="cu-ratio-label">
            <span>${_t('dashboard.totalOf', '전체의')} ${pct}%</span>
            <span>${_t('dashboard.lastCreated', '마지막 생성')}: ${lastDate}</span>
          </div>
        </div>`;
    }).join('');

  }

  // ─── 유틸 ───────────────────────────────────────────────────────────────────

  function formatDate(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    const loc = window.getCurrentLang?.() === 'en' ? 'en-AU' : 'ko-KR';
    return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return { render };
})();

window.Dashboard = Dashboard;
