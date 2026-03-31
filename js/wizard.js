/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

/**
 * wizard.js — 에셋 생성 마법사 로직
 */

const Wizard = (() => {
  /* ── 번역 헬퍼 ── */
  const _t = (key, fallback) => window.t ? window.t(key) : fallback;
  let currentStep = 1;
  const TOTAL_STEPS = 4;

  const state = {
    category: '',
    country: '',
    channel: '',
    productName: '',
    keyMessage: '',
    style: 'professional',
    copyHeadline: '',
    copySubtext: '',
    imagePrompt: '',
    negativePrompt: '',
    imageUrl: '',
    promptId: null,
    // 블로그 전용
    blogLength: 'medium',
    blogTone: 'info',
    blogSeo: '',
    blogCta: '',
    blogTitle: '',
    blogBody: '',
    blogSeoKeywords: '',
    blogCtaText: '',
    blogTags: '',
    // 브랜드 이미지 (step 3)
    brandType:   null,
    brandBgUrl:  '',
    brandPngUrl: '',
    miniStep:    1,
  };

  // ─── 카테고리 레이블 & 채널 맵 ──────────────────────────────────────────────
  const CAT_LABEL = {
    sns:     'SNS',
    b2b:     'B2B',
    event:   () => _t('create.cat_event', '이벤트'),
    youtube: 'YouTube',
  };

  const CHANNEL_MAP = {
    sns: [
      { value: 'instagram', icon: '&#128247;',        label: 'Instagram',         i18n: '' },
      { value: 'facebook',  icon: '&#128172;',        label: 'Facebook',          i18n: '' },
      { value: 'blog',      icon: '✏️',               label: '블로그',             i18n: 'blog.channel' },
      { value: 'youtube',   icon: '&#127909;',        label: 'YouTube',           i18n: '' },
      { value: 'email',     icon: '&#9993;&#65039;',  label: 'Email',             i18n: '' },
    ],
    b2b: [
      { value: 'proposal-pdf',    icon: '&#128203;', label: '제안서 PDF',        i18n: 'create.ch_proposal_pdf' },
      { value: 'email-proposal',  icon: '&#128233;', label: '이메일 제안',       i18n: 'create.ch_email_proposal' },
      { value: 'digital-display', icon: '&#128187;', label: '디지털 디스플레이', i18n: 'create.ch_digital_display' },
    ],
    event: [
      { value: 'instagram',  icon: '&#128247;', label: 'Instagram',  i18n: '' },
      { value: 'facebook',   icon: '&#128172;', label: 'Facebook',   i18n: '' },
      { value: 'web-banner', icon: '&#127760;', label: 'Web Banner', i18n: '' },
    ],
    youtube: [
      { value: 'youtube-thumbnail', icon: '&#127909;', label: 'Thumbnail', i18n: '' },
    ],
  };

  function getCatLabel(cat) {
    const v = CAT_LABEL[cat];
    return typeof v === 'function' ? v() : (v || cat.toUpperCase());
  }

  function chVal(displayName) {
    return displayName.toLowerCase().replace(/\s+/g, '-');
  }

  function tipHtml(key) {
    return `<span class="tooltip-wrap"><span class="tooltip-icon" onclick="event.stopPropagation();window.toggleTooltip(this)">?</span><span class="tooltip-popup">${_t(key, '')}</span></span>`;
  }

  // ─── 스텝 렌더 ──────────────────────────────────────────────────────────────

  function renderProgressBar() {
    const container = document.getElementById('wizard-progress');
    if (!container) return;

    const steps = [
      { num: 1, label: _t('create.step1Label','기본 설정') },
      { num: 2, label: _t('create.step2Label','카피 생성') },
      { num: 3, label: _t('create.step3Label','이미지 생성') },
      { num: 4, label: _t('create.step4Label','최종 확인') },
    ];

    container.innerHTML = steps
      .map(
        (s) => `
      <div class="wizard-step ${s.num < currentStep ? 'done' : ''} ${s.num === currentStep ? 'active' : ''}">
        <div class="step-circle">${s.num < currentStep ? '✓' : s.num}</div>
        <span class="step-label">${s.label}</span>
      </div>
      ${s.num < TOTAL_STEPS ? '<div class="step-line ' + (s.num < currentStep ? 'done' : '') + '"></div>' : ''}
    `
      )
      .join('');
  }

  function renderStep(step) {
    const content = document.getElementById('wizard-content');
    if (!content) return;

    const renders = { 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4 };
    content.innerHTML = renders[step] ? renders[step]() : '';
    bindStepEvents(step);
    renderProgressBar();
    updateNavButtons();
  }

  function renderStep1() {
    const countries = [
      { value: 'KR', icon: '🇰🇷', label: _t('common.country_kr','한국'), sub: 'Korean' },
      { value: 'AU', icon: '🇦🇺', label: _t('common.country_au','호주'), sub: 'Australian English' },
      { value: 'UK', icon: '🇬🇧', label: _t('common.country_uk','영국'), sub: 'British English' },
    ];
    return `
      <div class="wizard-step-content">
        <h2 class="step-title">${_t('create.step1Title','기본 설정')}</h2>
        <p class="step-desc">${_t('create.step1Desc','생성할 마케팅 에셋의 기본 정보를 입력하세요.')}</p>

        <!-- 카테고리 -->
        <div class="form-group">
          <label class="form-label">${_t('create.categoryLabel','카테고리')} ${tipHtml('tooltip.category')} <span class="required">*</span></label>
          <div class="select-card-grid col-4" id="field-category">
            ${[
              { value:'sns',     icon:'📱', i18nSub:'create.cat_sns_sub',     sub:_t('create.cat_sns_sub','인스타 · 페이스북') },
              { value:'b2b',     icon:'🤝', i18nSub:'create.cat_b2b_sub',     sub:_t('create.cat_b2b_sub','제안서 · 영업자료') },
              { value:'event',   icon:'🎉', i18nSub:'create.cat_event_sub',   sub:_t('create.cat_event_sub','공휴일 · 프로모션') },
              { value:'youtube', icon:'▶️', i18nSub:'create.cat_youtube_sub', sub:_t('create.cat_youtube_sub','썸네일') },
            ].map(c => `
              <div class="select-card${state.category === c.value ? ' selected' : ''}"
                   data-value="${c.value}" onclick="Wizard.selectCard(this,'category')">
                <div class="select-card-icon">${c.icon}</div>
                <div class="select-card-label">${getCatLabel(c.value)}</div>
                <div class="select-card-sub" data-i18n="${c.i18nSub}">${c.sub}</div>
              </div>`).join('')}
          </div>
        </div>

        <!-- 국가 -->
        <div class="form-group">
          <label class="form-label">${_t('create.countryLabel','국가')} ${tipHtml('tooltip.country')} <span class="required">*</span></label>
          <div class="select-card-grid col-3" id="field-country">
            ${[
              { value:'KR', badgeBg:'#971B2F', i18n:'common.country_kr', label:_t('common.country_kr','한국'), sub:'Korean' },
              { value:'AU', badgeBg:'#1B4F8A', i18n:'common.country_au', label:_t('common.country_au','호주'), sub:'Australian English' },
              { value:'UK', badgeBg:'#0A2356', i18n:'common.country_uk', label:_t('common.country_uk','영국'), sub:'British English' },
            ].map(c => `
              <div class="select-card${state.country === c.value ? ' selected' : ''}"
                   data-value="${c.value}" onclick="Wizard.selectCard(this,'country')"
                   style="min-height:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; padding:10px 8px; box-sizing:border-box; cursor:pointer; border-radius:var(--radius-lg); border:1.5px solid var(--color-border); background:var(--color-white); transition:all 0.15s ease; user-select:none;">
                <div style="width:40px; height:40px; border-radius:50%; background:${c.badgeBg}; color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${c.value}</div>
                <span style="font-size:13px; font-weight:600; color:var(--ib-gray-4); text-align:center;"
                      data-i18n="${c.i18n}">${c.label}</span>
                <span style="font-size:10px; color:var(--ib-gray-2);">${c.sub}</span>
              </div>`).join('')}
          </div>
        </div>

        <!-- 채널 -->
        <div class="form-group">
          <label class="form-label">${_t('create.channelLabel','채널')} ${tipHtml('tooltip.channel')} <span class="required">*</span></label>
          <p id="channel-placeholder" style="font-size:12px; color:var(--color-text-light); margin:4px 0 0; display:${state.category ? 'none' : 'block'};">
            ${_t('create.channelHint','먼저 카테고리를 선택하면 채널이 표시됩니다.')}
          </p>
          <div class="select-card-grid col-5" id="channel-cards"
               style="display:${state.category ? 'grid' : 'none'};"></div>
        </div>

        <!-- 제품명 + 이미지 스타일 -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="form-group">
            <label class="form-label">${_t('create.productLabel','제품명')} ${tipHtml('tooltip.product')}</label>
            <input type="text" class="form-input" id="field-productName"
              value="${state.productName}"
              placeholder="${_t('create.productPlaceholder','예: InBody 970, InBody 380N')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${_t('create.styleLabel','이미지 스타일')} ${tipHtml('tooltip.imageStyle')}</label>
            <select class="form-input" id="field-style">
              <option value="professional" ${state.style==='professional'?'selected':''}>${_t('create.styleProf','전문적 & 깔끔한')}</option>
              <option value="energetic"    ${state.style==='energetic'   ?'selected':''}>${_t('create.styleEnergy','활동적 & 역동적인')}</option>
              <option value="warm"         ${state.style==='warm'        ?'selected':''}>${_t('create.styleWarm','따뜻한 & 친근한')}</option>
              <option value="clinical"     ${state.style==='clinical'    ?'selected':''}>${_t('create.styleClinical','임상적 & 의료적')}</option>
              <option value="bold"         ${state.style==='bold'        ?'selected':''}>${_t('create.styleBold','강렬한 & 임팩트있는')}</option>
            </select>
          </div>
        </div>

        <!-- 광고 방향 -->
        <div class="form-group">
          <label class="form-label">${_t('create.fieldDirection','광고 방향')} ${tipHtml('tooltip.direction')} <span class="required">*</span></label>
          <textarea class="form-input" id="field-keyMessage" rows="3"
            placeholder="${_t('create.placeholderDirection','예: 체성분 전문성 강조, 임상 신뢰도 어필, 비즈니스 파트너십 강조')}">${state.keyMessage}</textarea>
        </div>

        <!-- 블로그 채널 전용 추가 입력 -->
        <div id="blog-extra-fields"${state.channel === 'blog' ? ' class="visible"' : ''}>
          <div style="height:0.5px; background:var(--color-border); margin:4px 0 16px;"></div>
          <p style="font-size:12px; color:var(--ib-primary); font-weight:500; margin:0 0 14px; display:flex; align-items:center; gap:6px;">
            <span>✍️</span>
            <span>${_t('blog.channel','블로그')} ${_t('create.step1Label','기본 설정')}</span>
          </p>
          <div class="form-grid">
            <div class="form-group full-width">
              <label class="form-label">${_t('blog.lengthLabel','글 길이')}</label>
              <div class="chip-group" id="blog-length-chips">
                <button type="button" class="chip ${state.blogLength === 'short'  ? 'active' : ''}" data-value="short">${_t('blog.lengthShort','단문 (500자)')}</button>
                <button type="button" class="chip ${state.blogLength === 'medium' ? 'active' : ''}" data-value="medium">${_t('blog.lengthMedium','중문 (1000자)')}</button>
                <button type="button" class="chip ${state.blogLength === 'long'   ? 'active' : ''}" data-value="long">${_t('blog.lengthLong','장문 (1500자)')}</button>
              </div>
            </div>
            <div class="form-group full-width">
              <label class="form-label">${_t('blog.toneLabel','글 톤')}</label>
              <div class="chip-group" id="blog-tone-chips">
                <button type="button" class="chip ${state.blogTone === 'info'   ? 'active' : ''}" data-value="info">${_t('blog.toneInfo','정보 전달형')}</button>
                <button type="button" class="chip ${state.blogTone === 'story'  ? 'active' : ''}" data-value="story">${_t('blog.toneStory','스토리텔링형')}</button>
                <button type="button" class="chip ${state.blogTone === 'expert' ? 'active' : ''}" data-value="expert">${_t('blog.toneExpert','전문가형')}</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">
                ${_t('blog.seoLabel','SEO 키워드')}
                <span class="tooltip-wrap"><span class="tooltip-icon" onclick="event.stopPropagation();window.toggleTooltip(this)">?</span><span class="tooltip-popup">${_t('blog.seoDesc','')}</span></span>
              </label>
              <input type="text" class="form-input" id="blog-seo"
                value="${state.blogSeo}"
                placeholder="${_t('blog.seoPlaceholder','예: 체성분 분석, 인바디 사용법, 체지방 감량')}" />
            </div>
            <div class="form-group">
              <label class="form-label">
                ${_t('blog.ctaLabel','CTA 포함')}
                <span class="tooltip-wrap"><span class="tooltip-icon" onclick="event.stopPropagation();window.toggleTooltip(this)">?</span><span class="tooltip-popup">${_t('blog.ctaDesc','')}</span></span>
              </label>
              <input type="text" class="form-input" id="blog-cta"
                value="${state.blogCta}"
                placeholder="${_t('blog.ctaPlaceholder','예: 지금 상담 예약하기')}" />
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderStep2() {
    if (state.channel === 'blog') return renderBlogStep2();
    return `
      <div class="wizard-step-content">
        <h2 class="step-title">${_t('create.step2Title','카피 생성')}</h2>
        <p class="step-desc">${_t('create.step2Desc','AI가 마케팅 카피를 생성합니다. 직접 수정도 가능합니다.')}</p>

        <div class="ai-action-bar">
          <div class="context-badge">
            <span class="badge badge-primary">${state.category.toUpperCase()}</span>
            <span class="badge badge-secondary">${state.country}</span>
            <span class="badge badge-outline">${state.channel}</span>
          </div>
          <button class="btn btn-primary" id="btn-generate-copy">
            <span class="btn-icon">✨</span> ${_t('create.generateCopyBtn','AI 카피 생성')}
          </button>
        </div>

        <div id="copy-loading" class="loading-box hidden">
          <div class="spinner"></div>
          <p>${_t('create.aiGenerating','Claude AI가 카피를 작성 중입니다...')}</p>
        </div>

        <div class="form-grid" id="copy-form">
          <div class="form-group full-width">
            <label class="form-label">${_t('create.headlineLabel','헤드라인')} ${tipHtml('tooltip.headline')} <span class="required">*</span></label>
            <input type="text" class="form-input form-input-lg" id="field-copyHeadline"
              value="${state.copyHeadline}" placeholder="${_t('create.headlinePlaceholder','강렬한 헤드라인을 입력하세요')}" />
          </div>

          <div class="form-group full-width">
            <label class="form-label">${_t('create.subCopyLabel','서브카피')} ${tipHtml('tooltip.subCopy')}</label>
            <textarea class="form-input" id="field-copySubtext" rows="3"
              placeholder="${_t('create.subCopyPlaceholder','헤드라인을 보완하는 서브카피를 입력하세요')}">${state.copySubtext}</textarea>
          </div>
        </div>

        <div style="margin-top:16px; border-top:0.5px solid var(--color-border); padding-top:12px;">
          <button onclick="Wizard.toggleSavedPrompts()"
                  style="all:unset; display:flex; align-items:center; gap:6px;
                         font-size:12px; color:var(--ib-gray-2); cursor:pointer;">
            <span id="saved-prompt-arrow">▶</span>
            <span data-i18n="create.loadFromLibrary">${_t('create.loadFromLibrary','저장된 프롬프트에서 불러오기')}</span>
          </button>
          <div id="saved-prompts-panel" style="display:none; margin-top:10px;">
            <div id="saved-prompts-list" class="prompt-list"></div>
          </div>
        </div>
      </div>`;
  }

  function renderBlogStep2() {
    const hasResult = !!state.blogTitle;
    return `
      <div class="wizard-step-content">
        <h2 class="step-title">${_t('blog.step2Title','블로그 글 생성')}</h2>
        <p class="step-desc">${_t('blog.step2Desc','AI가 인바디 브랜드에 맞는 블로그 글을 작성합니다.')}</p>

        <div class="ai-action-bar">
          <div class="context-badge">
            <span class="badge badge-primary">${state.category.toUpperCase()}</span>
            <span class="badge badge-secondary">${state.country}</span>
            <span class="badge badge-outline">${_t('blog.channel','블로그')}</span>
          </div>
          <button class="btn btn-primary" id="btn-generate-blog">
            ${hasResult ? _t('blog.regenerateBtn','재생성') : _t('blog.generateBtn','AI 블로그 글 생성')}
          </button>
        </div>

        <div id="blog-loading" class="loading-box hidden">
          <div class="spinner"></div>
          <p>${_t('create.aiGenerating','AI가 블로그 글을 작성 중입니다...')}</p>
        </div>

        <div id="blog-result" style="display:${hasResult ? 'block' : 'none'}; margin-top:20px;">
          <p style="font-size:11px; color:var(--color-text-light); margin:0 0 12px;">${_t('blog.editHint','텍스트를 클릭하면 직접 편집할 수 있습니다.')}</p>

          <div class="blog-result-block">
            <div class="blog-result-header">
              <span class="blog-result-label">${_t('blog.blogTitleLabel','제목')}</span>
              <button class="btn-copy-small" id="btn-copy-title">${_t('blog.copyTitle','제목 복사')}</button>
            </div>
            <div id="blog-title-output" contenteditable="true" class="blog-title-edit">${state.blogTitle}</div>
          </div>

          <div class="blog-result-block">
            <div class="blog-result-header">
              <span class="blog-result-label">${_t('blog.blogBodyLabel','본문')}</span>
              <span id="blog-char-count" style="font-size:11px; color:var(--color-text-light);">${state.blogBody.length}${_t('blog.charCount','자')}</span>
              <button class="btn-copy-small" id="btn-copy-body">${_t('blog.copyBody','본문 복사')}</button>
            </div>
            <div id="blog-body-output" contenteditable="true" class="blog-body-edit">${state.blogBody}</div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="blog-result-block">
              <div class="blog-result-label" style="margin-bottom:5px;">${_t('blog.seoKeywordsResult','SEO 키워드')}</div>
              <div id="blog-seo-output" class="blog-meta-output">${state.blogSeoKeywords}</div>
            </div>
            <div class="blog-result-block">
              <div class="blog-result-label" style="margin-bottom:5px;">${_t('blog.ctaResult','CTA')}</div>
              <div id="blog-cta-output" class="blog-meta-output">${state.blogCtaText}</div>
            </div>
          </div>

          <div class="blog-result-block" style="margin-top:10px;">
            <div class="blog-result-header">
              <span class="blog-result-label">${_t('blog.tagsLabel','네이버 블로그 태그')}</span>
              <button class="btn-copy-small" id="btn-copy-tags">${_t('blog.copyTags','태그 복사')}</button>
            </div>
            <div id="blog-tags-output" class="blog-meta-output"
                 style="color:var(--ib-primary, #971B2F); font-size:12px;">${state.blogTags}</div>
          </div>

          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn btn-outline" id="btn-copy-all-blog">${_t('blog.copyAll','전체 복사')}</button>
          </div>

          <p style="font-size:11px; color:var(--color-text-light); margin:12px 0 0; text-align:center;"
             data-i18n="blog.platformNote">${_t('blog.platformNote','생성된 글을 복사해서 블로그에 직접 붙여넣으세요.')}</p>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Step 3 — 4개 미니스텝으로 분리된 이미지 생성 화면
  // ══════════════════════════════════════════════════════════════════════════

  function renderStep3() {
    if (state.channel === 'blog') {
      return `<div class="ms-wrapper">
        <div class="ms-content">
          <div class="ms-progress"><span class="ms-step-num">3 / 4</span><span class="ms-step-title">이미지 생성</span></div>
          <div style="text-align:center;padding:60px 0;color:#9ca3af;">
            <p style="font-size:16px;margin-bottom:28px;">블로그 채널은 이미지 생성을 건너뛸 수 있습니다.</p>
            <div style="display:flex;gap:12px;justify-content:center;">
              <button class="ms-btn ms-btn-outline" onclick="Wizard.miniPrev()">← 이전</button>
              <button class="ms-btn ms-btn-primary" onclick="Wizard.miniSaveNext()">건너뛰기 →</button>
            </div>
          </div>
        </div>
      </div>`;
    }
    const renders = { 1: renderMini1, 2: renderMini2, 3: renderMini3, 4: renderMini4 };
    return `<div class="ms-wrapper">${(renders[state.miniStep] || renderMini1)()}</div>`;
  }

  function renderMini1() {
    const types = [
      { type: 'a', name: 'Type A', desc: _t('brand.typeA', '화이트 클린') },
      { type: 'b', name: 'Type B', desc: _t('brand.typeB', '다크 프리미엄') },
      { type: 'c', name: 'Type C', desc: _t('brand.typeC', '아이스버그') },
      { type: 'd', name: 'Type D', desc: _t('brand.typeD', '웨이브 데이터') },
    ];
    return `
      <div class="ms-content">
        <div class="ms-progress">
          <span class="ms-step-num">1 / 4</span>
          <span class="ms-step-title">템플릿 선택</span>
        </div>
        <div class="ms-type-grid">
          ${types.map(t => `
            <button class="ms-type-card${state.brandType === t.type ? ' selected' : ''}"
                    data-type="${t.type}" type="button"
                    onclick="Wizard.selectBrandType(this)">
              <div class="ms-thumb">
                <img src="/assets/templates/template_${t.type}.png" alt="${t.name}"
                     onerror="this.parentElement.style.background='${t.type==='b'||t.type==='d'?'#101820':'#F5F5F5'}'" />
              </div>
              <div class="ms-card-info">
                <div class="ms-card-name">${t.name}</div>
                <div class="ms-card-desc">${t.desc}</div>
              </div>
              <div class="ms-check-icon">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>`).join('')}
        </div>
        <div class="ms-nav">
          <button class="ms-btn ms-btn-outline" onclick="Wizard.miniPrev()">← 이전</button>
          <button class="ms-btn ms-btn-primary" id="ms-next-btn"
                  ${!state.brandType ? 'disabled' : ''}
                  onclick="Wizard.miniNext()">다음 →</button>
        </div>
      </div>`;
  }

  function renderMini2() {
    const hasBg = !!state.brandBgUrl;
    return `
      <div class="ms-content">
        <div class="ms-progress">
          <span class="ms-step-num">2 / 4</span>
          <span class="ms-step-title">이미지 삽입</span>
        </div>
        <p class="ms-section-desc">배경에 사용할 이미지를 업로드하세요. <span class="ms-optional-badge">선택사항</span></p>
        <div class="ms-upload-zone" id="ms-upload-zone">
          <input type="file" id="ms-image-file" accept="image/*" hidden />
          <div class="ms-upload-inner" id="ms-upload-inner" style="${hasBg ? 'display:none' : ''}">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="4" y="9" width="32" height="22" rx="3" stroke="#C4C6CA" stroke-width="2"/>
              <circle cx="14" cy="17" r="3" stroke="#C4C6CA" stroke-width="2"/>
              <path d="M4 27L14 17L21 24L29 14L36 24" stroke="#C4C6CA" stroke-width="2" stroke-linecap="round"/>
              <path d="M27 5L31 1L35 5M31 1V12" stroke="#971B2F" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <div class="ms-upload-text">클릭하거나 드래그해서 이미지 업로드</div>
            <div class="ms-upload-sub">JPG · PNG · WEBP · 최대 10MB</div>
          </div>
          <div class="ms-upload-preview" id="ms-upload-preview" style="${hasBg ? '' : 'display:none'}">
            <img id="ms-upload-thumb" src="${state.brandBgUrl || ''}" alt="preview" />
            <div class="ms-upload-file-info">
              <span id="ms-upload-filename" class="ms-upload-filename">이미지 업로드됨</span>
              <button class="ms-upload-remove" id="ms-upload-remove" type="button">✕</button>
            </div>
          </div>
          <div class="ms-uploading" id="ms-uploading" style="display:none">
            <div class="ms-spinner-sm"></div>
            <span>업로드 중...</span>
          </div>
        </div>
        <div class="ms-nav">
          <button class="ms-btn ms-btn-outline" onclick="Wizard.miniPrev()">← 이전</button>
          <button class="ms-btn ms-btn-primary" onclick="Wizard.miniNext()">다음 →</button>
        </div>
      </div>`;
  }

  function renderMini3() {
    const hl = state.copyHeadline || '';
    const bd = state.copySubtext  || '';
    return `
      <div class="ms-content">
        <div class="ms-progress">
          <span class="ms-step-num">3 / 4</span>
          <span class="ms-step-title">텍스트 입력</span>
        </div>
        <div class="ms-field">
          <label class="ms-label">헤드라인 <span class="ms-required-badge">필수</span></label>
          <input class="ms-input" type="text" id="ms-headline"
                 value="${hl}" maxlength="40"
                 placeholder="${_t('brand.headlinePlaceholder','체성분 분석의 기준')}"
                 oninput="document.getElementById('ms-hl-count').textContent=this.value.length" />
          <div class="ms-char-count"><span id="ms-hl-count">${hl.length}</span> / 40</div>
        </div>
        <div class="ms-field">
          <label class="ms-label">본문 <span class="ms-optional-badge">선택</span></label>
          <textarea class="ms-input ms-textarea" id="ms-body"
                    maxlength="100" rows="4"
                    placeholder="${_t('brand.bodyCopyPlaceholder','InBody로 정확하게 측정하세요')}"
                    oninput="document.getElementById('ms-bd-count').textContent=this.value.length"
                    >${bd}</textarea>
          <div class="ms-char-count"><span id="ms-bd-count">${bd.length}</span> / 100</div>
        </div>
        <div class="ms-nav">
          <button class="ms-btn ms-btn-outline" onclick="Wizard.miniPrev()">← 이전</button>
          <button class="ms-btn ms-btn-primary" onclick="Wizard.miniNext()">미리보기 생성 →</button>
        </div>
      </div>`;
  }

  function renderMini4() {
    const hasPng = !!state.brandPngUrl;
    return `
      <div class="ms-content">
        <div class="ms-progress">
          <span class="ms-step-num">4 / 4</span>
          <span class="ms-step-title">미리보기</span>
        </div>
        <div class="ms-preview-box" id="ms-preview-box">
          <!-- loading overlay -->
          <div class="ms-preview-loading" id="ms-preview-loading" style="display:none">
            <div class="ms-spinner"></div>
            <p class="ms-loading-text">이미지 생성 중...</p>
          </div>
          <!-- result image -->
          ${hasPng
            ? `<img class="ms-preview-img" id="ms-preview-img" src="${state.brandPngUrl}" alt="generated" />`
            : `<div class="ms-preview-placeholder" id="ms-preview-placeholder">
                 <button class="ms-generate-btn" id="ms-generate-btn" type="button"
                         onclick="Wizard.handleGenerateBrandImage()">
                   <span>✨</span> 이미지 생성하기
                 </button>
               </div>`
          }
        </div>
        <div class="ms-nav ms-nav-preview">
          <button class="ms-btn ms-btn-outline" onclick="Wizard.miniReset()">← 수정하기</button>
          <a class="ms-btn ms-btn-outline" id="ms-download-btn"
             ${hasPng ? `href="${state.brandPngUrl}"` : 'href="#"'}
             download="inbody-brand.png"
             style="${hasPng ? '' : 'opacity:0.4;pointer-events:none;'}">↓ PNG 다운로드</a>
          <button class="ms-btn ms-btn-primary" id="ms-save-next"
                  ${hasPng ? '' : 'disabled'}
                  onclick="Wizard.miniSaveNext()">저장하고 다음 →</button>
        </div>
      </div>`;
  }

  // ── 미니스텝 이동 함수 ────────────────────────────────────────────────────

  function miniNext() {
    if (state.miniStep === 1 && !state.brandType) {
      window.showToast('템플릿을 선택해주세요.', 'error'); return;
    }
    if (state.miniStep === 3) {
      const hl = document.getElementById('ms-headline')?.value.trim();
      const bd = document.getElementById('ms-body')?.value.trim() || '';
      if (!hl) {
        window.showToast(_t('brand.errorHeadline', '헤드라인을 입력해주세요.'), 'error');
        document.getElementById('ms-headline')?.focus();
        return;
      }
      state.copyHeadline = hl;
      state.copySubtext  = bd;
      state.brandPngUrl  = '';
      state.imageUrl     = '';
    }
    state.miniStep = Math.min(4, state.miniStep + 1);
    renderStep(currentStep);
  }

  function miniPrev() {
    if (state.miniStep === 1) { prev(); return; }
    state.miniStep = Math.max(1, state.miniStep - 1);
    renderStep(currentStep);
  }

  function miniReset() {
    state.brandType   = null;
    state.brandBgUrl  = '';
    state.brandPngUrl = '';
    state.imageUrl    = '';
    state.miniStep    = 1;
    renderStep(currentStep);
  }

  function miniSaveNext() {
    state.miniStep = 1;
    next();
  }

  // ── 미니스텝 2 업로드 ─────────────────────────────────────────────────────

  function _initMsUpload() {
    const zone      = document.getElementById('ms-upload-zone');
    const input     = document.getElementById('ms-image-file');
    const removeBtn = document.getElementById('ms-upload-remove');
    if (!zone) return;

    zone.addEventListener('click', e => {
      if (removeBtn && (e.target === removeBtn || removeBtn.contains(e.target))) return;
      input?.click();
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) _handleMsImageFile(file);
    });
    input?.addEventListener('change', () => {
      if (input.files?.[0]) _handleMsImageFile(input.files[0]);
    });
    removeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      state.brandBgUrl = '';
      const inner   = document.getElementById('ms-upload-inner');
      const preview = document.getElementById('ms-upload-preview');
      if (inner)   inner.style.display   = 'flex';
      if (preview) preview.style.display = 'none';
      if (input)   input.value = '';
    });
  }

  function _handleMsImageFile(file) {
    if (!file.type.startsWith('image/')) {
      window.showToast('이미지 파일만 업로드할 수 있습니다.', 'error'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      window.showToast('파일 크기는 10MB 이하여야 합니다.', 'error'); return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const thumb    = document.getElementById('ms-upload-thumb');
      const preview  = document.getElementById('ms-upload-preview');
      const inner    = document.getElementById('ms-upload-inner');
      const filename = document.getElementById('ms-upload-filename');
      if (thumb)    thumb.src = ev.target.result;
      if (filename) filename.textContent = file.name;
      if (preview)  preview.style.display = 'flex';
      if (inner)    inner.style.display   = 'none';
    };
    reader.readAsDataURL(file);
    const uploading = document.getElementById('ms-uploading');
    if (uploading) uploading.style.display = 'flex';
    window.API.uploadBrandImage(file)
      .then(url => { state.brandBgUrl = url; if (uploading) uploading.style.display = 'none'; })
      .catch(err => {
        if (uploading) uploading.style.display = 'none';
        window.showToast('이미지 업로드 실패: ' + err.message, 'error');
      });
  }

  function renderStep4() {
    const isBlog = state.channel === 'blog';
    return `
      <div class="wizard-step-content">
        <h2 class="step-title">${_t('create.step4Title','최종 확인 및 저장')}</h2>
        <p class="step-desc">${_t('create.step4Desc','생성된 에셋을 확인하고 저장하세요.')}</p>

        <div class="asset-preview-card">
          ${state.imageUrl
            ? `<img src="${state.imageUrl}" alt="Asset" class="asset-preview-img" />`
            : `<div class="asset-preview-img-placeholder">${_t('create.noImage','이미지 없음')}</div>`
          }
          <div class="asset-preview-info">
            <div class="asset-meta-tags">
              <span class="badge badge-primary">${state.category.toUpperCase()}</span>
              <span class="badge badge-secondary">${state.country}</span>
              <span class="badge badge-outline">${isBlog ? _t('blog.channel','블로그') : state.channel}</span>
            </div>
            ${isBlog
              ? `<h3 class="asset-headline">${state.blogTitle || _t('create.noHeadline','(제목 없음)')}</h3>
                 <p class="asset-subtext">${(state.blogBody || '').substring(0, 120)}${state.blogBody?.length > 120 ? '...' : ''}</p>`
              : `<h3 class="asset-headline">${state.copyHeadline || _t('create.noHeadline','(헤드라인 없음)')}</h3>
                 <p class="asset-subtext">${state.copySubtext || _t('create.noSubCopy','(서브카피 없음)')}</p>`
            }
            ${state.productName ? `<p class="asset-product">📦 ${state.productName}</p>` : ''}
          </div>
        </div>

        <div class="save-options">
          <div class="form-group">
            <label class="form-label">${_t('create.assetTitleLabel','에셋 제목 (선택)')}</label>
            <input type="text" class="form-input" id="field-assetTitle"
              placeholder="${_t('create.assetTitlePlaceholder','저장할 에셋 이름 (비어있으면 헤드라인으로 저장)')}" />
          </div>

          <div class="action-row">
            <button class="btn btn-outline" id="btn-save-prompt">
              ${_t('create.savePromptOnly','📚 프롬프트만 저장')}
            </button>
            <button class="btn btn-primary btn-lg" id="btn-save-asset">
              ${_t('create.saveAsset','💾 에셋 저장하기')}
            </button>
          </div>
        </div>
      </div>`;
  }

  // ─── 채널 카드 업데이트 ─────────────────────────────────────────────────────

  function updateChannelCards(category) {
    const grid        = document.getElementById('channel-cards');
    const placeholder = document.getElementById('channel-placeholder');
    const channels    = CHANNEL_MAP[category] || [];
    if (!grid) return;

    if (!channels.length) {
      grid.style.display = 'none';
      if (placeholder) placeholder.style.display = 'block';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    grid.style.display = 'grid';
    grid.className = `select-card-grid col-${Math.min(channels.length, 5)}`;

    grid.innerHTML = channels.map(ch => `
      <div class="select-card${state.channel === ch.value ? ' selected' : ''}"
           data-value="${ch.value}" onclick="Wizard.selectCard(this,'channel')"
           style="min-height:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; padding:10px 8px; box-sizing:border-box; cursor:pointer; border-radius:var(--radius-lg); border:1.5px solid var(--color-border); background:var(--color-white); transition:all 0.15s ease; user-select:none;">
        <span style="font-size:24px; line-height:1; height:28px; display:flex; align-items:center;">${ch.icon}</span>
        <span style="font-size:12px; font-weight:500; color:var(--ib-gray-4); text-align:center;"
              ${ch.i18n ? `data-i18n="${ch.i18n}"` : ''}>${ch.i18n ? _t(ch.i18n, ch.label) : ch.label}</span>
        <span style="font-size:10px; color:var(--ib-gray-2); min-height:14px;"></span>
      </div>`).join('');
  }

  // ─── 카드 선택 핸들러 (전역 노출) ───────────────────────────────────────────

  function selectCard(el, type) {
    const grid = el.closest('.select-card-grid');
    if (grid) grid.querySelectorAll('.select-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    const value = el.dataset.value;
    switch (type) {
      case 'category':
        state.category = value;
        state.channel  = '';
        updateChannelCards(value);
        // 카테고리 재선택 시 블로그 추가 필드 숨김
        document.getElementById('blog-extra-fields')?.classList.remove('visible');
        break;
      case 'country':
        state.country = value;
        break;
      case 'channel':
        state.channel = value;
        const blogFields = document.getElementById('blog-extra-fields');
        if (blogFields) {
          if (value === 'blog') blogFields.classList.add('visible');
          else                  blogFields.classList.remove('visible');
        }
        break;
    }
  }

  // ─── 이벤트 바인딩 ──────────────────────────────────────────────────────────

  function bindStepEvents(step) {
    if (step === 1) {
      // 카드 선택은 onclick="Wizard.selectCard()" 로 처리됨
      // 뒤로가기 시 채널 카드 복원
      if (state.category) updateChannelCards(state.category);

      // 블로그 길이 칩
      document.querySelectorAll('#blog-length-chips .chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#blog-length-chips .chip').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.blogLength = btn.dataset.value;
        });
      });
      // 블로그 톤 칩
      document.querySelectorAll('#blog-tone-chips .chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#blog-tone-chips .chip').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.blogTone = btn.dataset.value;
        });
      });

      ['productName', 'keyMessage', 'style'].forEach((field) => {
        const el = document.getElementById(`field-${field}`);
        if (el) el.addEventListener('input', (e) => { state[field] = e.target.value; });
      });
    }

    if (step === 2) {
      if (state.channel === 'blog') {
        document.getElementById('btn-generate-blog')?.addEventListener('click', handleGenerateBlogPost);
        document.getElementById('btn-copy-title')?.addEventListener('click', () => {
          const el = document.getElementById('blog-title-output');
          if (el) { navigator.clipboard.writeText(el.textContent); window.showToast(_t('toast.copied','복사되었습니다 ✅'), 'success'); }
        });
        document.getElementById('btn-copy-body')?.addEventListener('click', () => {
          const el = document.getElementById('blog-body-output');
          if (el) { navigator.clipboard.writeText(el.textContent); window.showToast(_t('toast.copied','복사되었습니다 ✅'), 'success'); }
        });
        document.getElementById('btn-copy-tags')?.addEventListener('click', () => {
          const el = document.getElementById('blog-tags-output');
          if (el) { navigator.clipboard.writeText(el.textContent); window.showToast(_t('toast.copied','복사되었습니다 ✅'), 'success'); }
        });
        document.getElementById('btn-copy-all-blog')?.addEventListener('click', () => {
          const title = document.getElementById('blog-title-output')?.textContent || '';
          const body  = document.getElementById('blog-body-output')?.textContent  || '';
          const cta   = document.getElementById('blog-cta-output')?.textContent   || '';
          const text  = `${title}\n\n${body}${cta ? '\n\n' + cta : ''}`;
          navigator.clipboard.writeText(text);
          window.showToast(_t('blog.copyAll','전체 복사') + ' ✅', 'success');
        });
        document.getElementById('blog-body-output')?.addEventListener('input', () => {
          const bodyEl  = document.getElementById('blog-body-output');
          const countEl = document.getElementById('blog-char-count');
          if (bodyEl && countEl) countEl.textContent = `${bodyEl.textContent.length}${_t('blog.charCount','자')}`;
          state.blogBody = bodyEl?.textContent || '';
        });
        document.getElementById('blog-title-output')?.addEventListener('input', (e) => {
          state.blogTitle = e.target.textContent;
        });
      } else {
        document.getElementById('btn-generate-copy')?.addEventListener('click', handleGenerateCopy);
        document.getElementById('field-copyHeadline')?.addEventListener('input', (e) => { state.copyHeadline = e.target.value; });
        document.getElementById('field-copySubtext')?.addEventListener('input', (e) => { state.copySubtext = e.target.value; });
      }
    }

    if (step === 3) {
      if (state.miniStep === 2) _initMsUpload();
    }

    if (step === 4) {
      document.getElementById('btn-save-asset')?.addEventListener('click', handleSaveAsset);
      document.getElementById('btn-save-prompt')?.addEventListener('click', handleSavePromptOnly);
    }
  }

  // ─── AI 액션 핸들러 ─────────────────────────────────────────────────────────

  async function handleGenerateCopy() {
    const btn     = document.getElementById('btn-generate-copy');
    const loading = document.getElementById('copy-loading');
    const origTxt = btn?.textContent;

    if (btn) { btn.disabled = true; btn.textContent = _t('create.generating', '생성 중...'); }
    if (loading) loading.classList.remove('hidden');

    try {
      const result = await window.API.generateCopy({
        category:    state.category,
        country:     state.country,
        channel:     state.channel,
        productName: state.productName,
        keyMessage:  state.keyMessage,
        style:       state.style,
      });

      if (result.success === false) throw new Error(result.error || '카피 생성 실패');

      // 응답 필드명 양쪽 수용 (subCopy / subtext)
      state.copyHeadline = result.headline || '';
      state.copySubtext  = result.subCopy  || result.subtext || '';

      const headlineEl = document.getElementById('field-copyHeadline');
      const subtextEl  = document.getElementById('field-copySubtext');
      if (headlineEl) headlineEl.value = state.copyHeadline;
      if (subtextEl)  subtextEl.value  = state.copySubtext;

      window.showToast(_t('toast.copyGenDone', '카피 생성 완료!'), 'success');
    } catch (e) {
      console.error('[Wizard] 카피 생성 오류:', e);
      window.showToast(`${_t('toast.copyGenFail', '카피 생성 실패')}: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origTxt; }
      if (loading) loading.classList.add('hidden');
    }
  }

  async function handleGeneratePrompt() {
    try {
      const result = await window.API.generateImagePrompt({
        category:    state.category,
        country:     state.country,
        channel:     state.channel,
        productName: state.productName,
        keyMessage:  state.keyMessage,
        style:       state.style,
        sizePreset:  getAspectRatio(state.channel),
      });

      if (result.success === false) throw new Error(result.error || '프롬프트 생성 실패');

      state.imagePrompt    = result.imagePrompt    || result.prompt || '';
      state.negativePrompt = result.negativePrompt || '';

      const promptEl = document.getElementById('field-imagePrompt');
      const negEl    = document.getElementById('field-negativePrompt');
      if (promptEl) promptEl.value = state.imagePrompt;
      if (negEl)    negEl.value    = state.negativePrompt;

      window.showToast(_t('toast.promptGenDone', '프롬프트 생성 완료!'), 'success');
    } catch (e) {
      console.error('[Wizard] 프롬프트 생성 오류:', e);
      window.showToast(`${_t('toast.promptGenFail', '프롬프트 생성 실패')}: ${e.message}`, 'error');
    }
  }

  async function handleGenerateImage() {
    const btn       = document.getElementById('btn-generate-image');
    const loading   = document.getElementById('image-loading');
    const previewEl = document.getElementById('image-preview-area');
    const origTxt   = btn?.textContent;

    if (btn) { btn.disabled = true; btn.textContent = _t('create.generating', '생성 중...'); }
    if (loading) loading.classList.remove('hidden');
    if (previewEl) previewEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:2rem;">
        <div class="spinner"></div>
        <p style="font-size:13px;color:var(--color-text-light);">${_t('create.imageWaiting', '이미지 생성 중... (30~60초 소요)')}</p>
      </div>`;

    try {
      const result = await window.API.generateImage({
        imagePrompt:    state.imagePrompt,
        negativePrompt: state.negativePrompt,
        sizePreset:     getAspectRatio(state.channel),
      });

      if (result.success === false) throw new Error(result.error || '이미지 생성 실패');

      state.imageUrl = result.imageUrl || '';
      updateImagePreview(state.imageUrl);
      const urlEl = document.getElementById('field-imageUrl');
      if (urlEl) urlEl.value = state.imageUrl;

      window.showToast(_t('toast.imageGenDone', '이미지 생성 완료!'), 'success');
    } catch (e) {
      console.error('[Wizard] 이미지 생성 오류:', e);
      if (previewEl) previewEl.innerHTML = `
        <div class="image-placeholder">
          <span class="placeholder-icon">⚠️</span>
          <p style="color:var(--ib-primary);font-size:13px;">${e.message}</p>
        </div>`;
      window.showToast(`${_t('toast.imageGenFail', '이미지 생성 실패')}: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origTxt; }
      if (loading) loading.classList.add('hidden');
    }
  }

  async function handleGenerateBlogPost() {
    const btn      = document.getElementById('btn-generate-blog');
    const loading  = document.getElementById('blog-loading');
    const resultEl = document.getElementById('blog-result');
    const origTxt  = btn?.innerHTML;

    if (btn) { btn.disabled = true; btn.textContent = _t('create.generating','생성 중...'); }
    if (loading) loading.classList.remove('hidden');
    if (resultEl) resultEl.style.display = 'none';

    try {
      const resp = await fetch('/api/generate-blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country:     state.country,
          message:     state.keyMessage,
          product:     state.productName || 'InBody',
          length:      state.blogLength  || 'medium',
          tone:        state.blogTone    || 'info',
          seoKeywords: state.blogSeo     || '',
          cta:         state.blogCta     || '',
        }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || '블로그 글 생성 실패');

      state.blogTitle       = data.title        || '';
      state.blogBody        = data.body         || '';
      state.blogSeoKeywords = data.seoKeywords  || '';
      state.blogCtaText     = data.cta          || '';
      state.blogTags        = data.tags         || '';

      const titleEl  = document.getElementById('blog-title-output');
      const bodyEl   = document.getElementById('blog-body-output');
      const seoEl    = document.getElementById('blog-seo-output');
      const ctaEl    = document.getElementById('blog-cta-output');
      const tagsEl   = document.getElementById('blog-tags-output');
      const countEl  = document.getElementById('blog-char-count');

      if (titleEl)  titleEl.textContent  = state.blogTitle;
      if (bodyEl)   bodyEl.textContent   = state.blogBody;
      if (seoEl)    seoEl.textContent    = state.blogSeoKeywords;
      if (ctaEl)    ctaEl.textContent    = state.blogCtaText;
      if (tagsEl)   tagsEl.textContent   = state.blogTags;
      if (countEl)  countEl.textContent  = `${state.blogBody.length}${_t('blog.charCount','자')}`;

      if (resultEl) resultEl.style.display = 'block';
      window.showToast(_t('blog.saveSuccess','블로그 글이 생성되었습니다 ✅'), 'success');
    } catch (e) {
      console.error('[Wizard] 블로그 글 생성 오류:', e);
      window.showToast(`${_t('toast.error','오류')}: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origTxt; }
      if (loading) loading.classList.add('hidden');
    }
  }

  function updateImagePreview(url) {
    const area = document.getElementById('image-preview-area');
    if (!area) return;
    area.innerHTML = url
      ? `<img src="${url}" alt="Generated" class="preview-image" />`
      : `<div class="image-placeholder"><span class="placeholder-icon">🖼️</span><p>${_t('create.imagePlaceholder','이미지를 생성하면 여기에 표시됩니다')}</p></div>`;
  }

  function getAspectRatio(channel) {
    const map = {
      instagram: '1:1', facebook: '1.91:1',
      youtube: '16:9', email: '16:9',
      'proposal-pdf': '1:1.414', 'email-proposal': '1.91:1', 'digital-display': '16:9',
      'youtube-thumbnail': '16:9', 'web-banner': '3:1',
    };
    return map[channel] || '1:1';
  }

  function toggleSavedPrompts() {
    const panel = document.getElementById('saved-prompts-panel');
    const arrow = document.getElementById('saved-prompt-arrow');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    if (!isOpen) loadSavedPrompts();
  }

  function loadSavedPrompts() {
    const list = document.getElementById('saved-prompts-list');
    if (!list) return;
    const prompts = window.Storage.filterItems(window.Storage.KEYS.PROMPTS, {
      category: state.category,
      country: state.country,
    }).slice(0, 5);

    if (!prompts.length) {
      list.innerHTML = `<p class="empty-text">${_t('create.noSavedPrompts','저장된 프롬프트가 없습니다.')}</p>`;
      return;
    }

    list.innerHTML = prompts
      .map(
        (p) => `
      <div class="saved-prompt-item" data-id="${p.id}">
        <p class="prompt-text">${p.text.substring(0, 100)}...</p>
        <div class="prompt-meta">
          <span class="badge badge-outline">${p.category}</span>
          <span class="prompt-rating">⭐ ${p.rating || 0}</span>
        </div>
        <button class="btn btn-sm btn-outline" onclick="Wizard.usePrompt('${p.id}')">${_t('create.usePrompt','사용')}</button>
      </div>`
      )
      .join('');
  }

  function usePrompt(promptId) {
    const prompt = window.Storage.getData(window.Storage.KEYS.PROMPTS).find((p) => p.id === promptId);
    if (!prompt) return;
    state.imagePrompt = prompt.text;
    state.negativePrompt = prompt.negativePrompt || '';
    state.promptId = promptId;
    window.showToast(_t('toast.promptLoaded','프롬프트를 불러왔습니다.'), 'success');
  }

  // ─── 브랜드 이미지 생성 (Step 3) ───────────────────────────────────────────

  function selectBrandType(el) {
    const alreadySelected = el.classList.contains('selected');
    document.querySelectorAll('.ms-type-grid .ms-type-card').forEach(c => c.classList.remove('selected'));
    if (alreadySelected) {
      state.brandType = null;
    } else {
      el.classList.add('selected');
      state.brandType = el.dataset.type;
    }
    // enable/disable next button
    const nextBtn = document.getElementById('ms-next-btn');
    if (nextBtn) nextBtn.disabled = !state.brandType;
  }

  function _initWizUpload() {
    const zone      = document.getElementById('wiz-upload-zone');
    const input     = document.getElementById('wiz-image-file');
    const removeBtn = document.getElementById('wiz-upload-remove');

    zone?.addEventListener('click', e => {
      if (removeBtn && (e.target === removeBtn || removeBtn.contains(e.target))) return;
      input?.click();
    });
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone?.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) _handleWizImageFile(file);
    });
    input?.addEventListener('change', () => {
      if (input.files?.[0]) _handleWizImageFile(input.files[0]);
    });
    removeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      state.brandBgUrl = '';
      document.getElementById('wiz-upload-inner').hidden  = false;
      document.getElementById('wiz-upload-preview').hidden = true;
      const fn = document.getElementById('wiz-upload-filename');
      if (fn) fn.textContent = '';
      if (input) input.value = '';
    });
  }

  function _handleWizImageFile(file) {
    if (!file.type.startsWith('image/')) {
      window.showToast('이미지 파일만 업로드할 수 있습니다.', 'error'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      window.showToast('파일 크기는 10MB 이하여야 합니다.', 'error'); return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const thumb    = document.getElementById('wiz-upload-thumb');
      const preview  = document.getElementById('wiz-upload-preview');
      const inner    = document.getElementById('wiz-upload-inner');
      const filename = document.getElementById('wiz-upload-filename');
      if (thumb)    thumb.src        = e.target.result;
      if (filename) filename.textContent = file.name;
      if (preview)  preview.hidden   = false;
      if (inner)    inner.hidden     = true;
    };
    reader.readAsDataURL(file);

    const uploading = document.getElementById('wiz-upload-uploading');
    if (uploading) uploading.hidden = false;
    window.API.uploadBrandImage(file)
      .then(url => { state.brandBgUrl = url; if (uploading) uploading.hidden = true; })
      .catch(err => {
        if (uploading) uploading.hidden = true;
        window.showToast('이미지 업로드 실패: ' + err.message, 'error');
      });
  }

  async function handleGenerateBrandImage() {
    const box       = document.getElementById('ms-preview-box');
    const placeholder = document.getElementById('ms-preview-placeholder');
    const genBtn    = document.getElementById('ms-generate-btn');
    const loading   = document.getElementById('ms-preview-loading');
    const dlBtn     = document.getElementById('ms-download-btn');
    const saveBtn   = document.getElementById('ms-save-next');

    if (genBtn)      genBtn.disabled        = true;
    if (placeholder) placeholder.style.display = 'none';
    if (loading)     loading.style.display  = 'flex';

    try {
      const data = await window.API.createBrandImage({
        type:       state.brandType,
        headline:   state.copyHeadline,
        body_copy:  state.copySubtext || '',
        type_label: `Type ${(state.brandType || 'a').toUpperCase()}`,
        image:      state.brandBgUrl || '',
      });
      if (!data.ok || !data.png_url) throw new Error(data.error || '생성 실패');

      state.brandPngUrl = data.png_url;
      state.imageUrl    = data.png_url;

      if (loading) loading.style.display = 'none';

      // placeholder를 이미지로 교체
      if (box) {
        const ph = document.getElementById('ms-preview-placeholder');
        if (ph) ph.remove();
        const img = document.createElement('img');
        img.className = 'ms-preview-img';
        img.id = 'ms-preview-img';
        img.src = data.png_url;
        img.alt = 'generated';
        box.appendChild(img);
      }

      if (dlBtn)  { dlBtn.href = data.png_url; dlBtn.style.opacity = '1'; dlBtn.style.pointerEvents = ''; }
      if (saveBtn) saveBtn.disabled = false;
      window.showToast(_t('toast.imageGenDone','이미지 생성 완료!'), 'success');
    } catch (e) {
      if (loading)     loading.style.display     = 'none';
      if (placeholder) placeholder.style.display = 'flex';
      if (genBtn)      genBtn.disabled            = false;
      window.showToast(`이미지 생성 실패: ${e.message}`, 'error');
    }
  }

  // ─── 저장 ──────────────────────────────────────────────────────────────────

  async function handleSaveAsset() {
    const titleEl = document.getElementById('field-assetTitle');
    const title = titleEl?.value || state.copyHeadline || '제목 없음';

    const isBlog = state.channel === 'blog';
    const asset = {
      text: title,
      category: state.category,
      country: state.country,
      channel: state.channel,
      copyHeadline: isBlog ? state.blogTitle : state.copyHeadline,
      copySubtext:  isBlog ? (state.blogBody || '').substring(0, 200) : state.copySubtext,
      imageUrl: state.imageUrl,
      promptId: state.promptId,
      completed: false,
      ...(isBlog && {
        blogTitle:       state.blogTitle,
        blogBody:        state.blogBody,
        blogSeoKeywords: state.blogSeoKeywords,
        blogCtaText:     state.blogCtaText,
      }),
    };

    window.Storage.addItem(window.Storage.KEYS.ASSETS, asset);
    window.showToast(_t('toast.assetSaved','에셋이 저장되었습니다!'), 'success');

    setTimeout(() => {
      window.navigateTo('assets');
    }, 1000);
  }

  async function handleSavePromptOnly() {
    if (!state.imagePrompt) {
      window.showToast(_t('toast.noPromptToSave','저장할 프롬프트가 없습니다.'), 'warning');
      return;
    }

    const prompt = {
      text: state.imagePrompt,
      negativePrompt: state.negativePrompt,
      category: state.category,
      country: state.country,
      tags: [state.channel, state.style],
      rating: 0,
      useCount: 0,
    };

    const saved = window.Storage.addItem(window.Storage.KEYS.PROMPTS, prompt);
    state.promptId = saved.id;
    window.showToast(_t('toast.promptSaved','프롬프트가 라이브러리에 저장되었습니다!'), 'success');
  }

  // ─── 네비게이션 ─────────────────────────────────────────────────────────────

  function updateNavButtons() {
    const nav = document.querySelector('.wizard-nav');
    if (nav) nav.style.display = currentStep === 3 ? 'none' : '';
    const prevBtn = document.getElementById('wizard-prev');
    const nextBtn = document.getElementById('wizard-next');
    if (prevBtn) prevBtn.disabled = currentStep === 1;
    if (nextBtn) {
      nextBtn.textContent = currentStep === TOTAL_STEPS ? _t('create.done','완료') : _t('create.next','다음 →');
    }
  }

  function next() {
    if (!validateStep(currentStep)) return;
    if (currentStep < TOTAL_STEPS) {
      currentStep++;
      renderStep(currentStep);
    }
  }

  function prev() {
    if (currentStep > 1) {
      currentStep--;
      renderStep(currentStep);
    }
  }

  function validateStep(step) {
    if (step === 1) {
      if (!state.category) { window.showToast(_t('toast.needCategory','카테고리를 선택해주세요.'), 'warning'); return false; }
      if (!state.country) { window.showToast(_t('toast.needCountry','국가를 선택해주세요.'), 'warning'); return false; }
      if (!state.channel) { window.showToast(_t('toast.needChannel','채널을 선택해주세요.'), 'warning'); return false; }

      const keyMsg = document.getElementById('field-keyMessage');
      if (keyMsg) state.keyMessage = keyMsg.value;
      if (!state.keyMessage) { window.showToast(_t('toast.needKeyMsg','핵심 메시지를 입력해주세요.'), 'warning'); return false; }

      // 블로그 전용 입력 값 저장
      if (state.channel === 'blog') {
        const seoEl = document.getElementById('blog-seo');
        const ctaEl = document.getElementById('blog-cta');
        if (seoEl) state.blogSeo = seoEl.value;
        if (ctaEl) state.blogCta = ctaEl.value;
      }
    }
    if (step === 2) {
      if (state.channel === 'blog') {
        // 편집된 내용 읽기
        const titleEl = document.getElementById('blog-title-output');
        const bodyEl  = document.getElementById('blog-body-output');
        const seoEl   = document.getElementById('blog-seo-output');
        const ctaEl   = document.getElementById('blog-cta-output');
        if (titleEl) state.blogTitle       = titleEl.textContent;
        if (bodyEl)  state.blogBody        = bodyEl.textContent;
        if (seoEl)   state.blogSeoKeywords = seoEl.textContent;
        if (ctaEl)   state.blogCtaText     = ctaEl.textContent;
        if (!state.blogTitle) { window.showToast(_t('blog.needGenerate','블로그 글을 먼저 생성해주세요.'), 'warning'); return false; }
        return true;
      }
      const h = document.getElementById('field-copyHeadline');
      const s = document.getElementById('field-copySubtext');
      if (h) state.copyHeadline = h.value;
      if (s) state.copySubtext = s.value;
      if (!state.copyHeadline) { window.showToast(_t('toast.needHeadline','헤드라인을 입력해주세요.'), 'warning'); return false; }
    }
    if (step === 3) {
      return true; // mini-steps handle their own validation
    }
    return true;
  }

  function init() {
    currentStep = 1;
    Object.keys(state).forEach((k) => {
      if (typeof state[k] === 'string') state[k] = '';
      if (typeof state[k] === 'number') state[k] = 0;
      if (state[k] === null) state[k] = null;
    });
    state.style      = 'professional';
    state.blogLength = 'medium';
    state.blogTone   = 'info';
    state.brandType  = null;
    state.miniStep   = 1;
    renderStep(1);

    // 언어 전환 시 재렌더 훅 등록
    window.currentPageRender = () => renderStep(currentStep);

    document.getElementById('wizard-next')?.addEventListener('click', next);
    document.getElementById('wizard-prev')?.addEventListener('click', prev);
  }

  return { init, next, prev, usePrompt, refresh: () => renderStep(currentStep), selectCard, selectBrandType, handleGenerateBrandImage, updateChannelCards, toggleSavedPrompts, miniNext, miniPrev, miniReset, miniSaveNext };
})();

window.Wizard = Wizard;
