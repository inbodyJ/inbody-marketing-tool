/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

/**
 * youtube.js — 유튜브 처리 파이프라인 로직
 */

const YouTube = (() => {
  const _t = (key, fallback) => window.t ? window.t(key) : fallback;
  // ─── 작업 추가 ──────────────────────────────────────────────────────────────

  async function addJob(url, title = '') {
    if (!isValidYouTubeUrl(url)) {
      window.showToast(_t('toast.invalidUrl','유효하지 않은 유튜브 URL입니다.'), 'error');
      return null;
    }

    const job = window.Storage.addItem(window.Storage.KEYS.YOUTUBE_JOBS, {
      text: title || extractVideoId(url) || url,
      url,
      status: 'pending',
      transcript: '',
      summary: '',
      shortsTimestamps: [],
      generatedAssets: [],
    });

    window.showToast(_t('toast.saved','작업이 추가되었습니다.'), 'success');
    return job;
  }

  // ─── 전체 파이프라인 실행 ───────────────────────────────────────────────────

  async function processJob(jobId, onProgress) {
    const report = (msg, pct) => {
      window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, { status: 'processing' });
      onProgress?.({ message: msg, percent: pct });
    };

    try {
      // Step 1: 자막 추출
      report('자막을 추출하는 중...', 10);
      const job = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS).find((j) => j.id === jobId);
      if (!job) throw new Error('작업을 찾을 수 없습니다.');

      const transcriptResult = await window.API.extractTranscript(job.url);
      const transcript = transcriptResult.transcript || '';

      window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, {
        transcript,
        text: transcriptResult.title || job.text,
      });

      // Step 2: Claude 분석
      report('AI가 영상을 분석하는 중...', 40);
      const analysisResult = await window.API.analyzeTranscript({
        transcript,
        videoTitle: transcriptResult.title || job.text,
      });

      window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, {
        summary: analysisResult.summary || '',
        shortsTimestamps: analysisResult.shortsTimestamps || [],
      });

      // Step 3: 마케팅 에셋 자동 생성
      report('마케팅 에셋을 생성하는 중...', 70);
      const generatedAssets = await generateAssetsFromAnalysis(jobId, analysisResult);

      window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, {
        status: 'done',
        generatedAssets,
      });

      report('완료!', 100);
      window.showToast(_t('youtube.allDone','유튜브 처리가 완료되었습니다!'), 'success');
      return window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS).find((j) => j.id === jobId);
    } catch (e) {
      window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, {
        status: 'error',
        errorMessage: e.message,
      });
      window.showToast(`${_t('youtube.processingError','처리 실패')}: ${e.message}`, 'error');
      throw e;
    }
  }

  // ─── 분석 결과 기반 에셋 자동 생성 ────────────────────────────────────────

  async function generateAssetsFromAnalysis(jobId, analysis) {
    const job = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS).find((j) => j.id === jobId);
    if (!job) return [];

    const assetIds = [];

    // 쇼츠 구간마다 에셋 생성
    const timestamps = analysis.shortsTimestamps || [];
    for (const ts of timestamps.slice(0, 3)) {
      const asset = window.Storage.addItem(window.Storage.KEYS.ASSETS, {
        text: `[YouTube Shorts] ${ts.description || job.text}`,
        category: 'shorts',
        country: 'AU',
        channel: 'youtube',
        copyHeadline: ts.headline || ts.description || '',
        copySubtext: `${formatTime(ts.start)} - ${formatTime(ts.end)}`,
        imageUrl: '',
        promptId: null,
        sourceJobId: jobId,
      });
      assetIds.push(asset.id);
    }

    // YouTube 썸네일용 에셋
    if (analysis.summary) {
      const asset = window.Storage.addItem(window.Storage.KEYS.ASSETS, {
        text: `[YouTube Thumbnail] ${job.text}`,
        category: 'youtube',
        country: 'AU',
        channel: 'youtube',
        copyHeadline: analysis.thumbnailTitle || job.text,
        copySubtext: analysis.summary.substring(0, 100),
        imageUrl: '',
        promptId: null,
        sourceJobId: jobId,
      });
      assetIds.push(asset.id);
    }

    return assetIds;
  }

  // ─── 렌더링 ─────────────────────────────────────────────────────────────────

  function renderJobList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const jobs = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS);

    if (!jobs.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📹</span>
          <p>${_t('youtube.noHistory','처리된 유튜브 영상이 없습니다.')}</p>
        </div>`;
      return;
    }

    container.innerHTML = jobs
      .map(
        (job) => `
      <div class="job-card" data-id="${job.id}">
        <div class="job-header">
          <div class="job-info">
            <h3 class="job-title">${job.text}</h3>
            <a href="${job.url}" target="_blank" class="job-url">${job.url}</a>
          </div>
          <span class="status-badge status-${job.status}">${getStatusLabel(job.status)}</span>
        </div>

        ${job.summary ? `
          <div class="job-summary">
            <h4>📊 분석 요약</h4>
            <p>${job.summary}</p>
          </div>` : ''}

        ${job.shortsTimestamps?.length ? `
          <div class="timestamps-section">
            <h4>✂️ 쇼츠 추천 구간 (${job.shortsTimestamps.length}개)</h4>
            <div class="timestamp-list">
              ${job.shortsTimestamps.map((ts) => `
                <div class="timestamp-item">
                  <span class="time-badge">${formatTime(ts.start)} → ${formatTime(ts.end)}</span>
                  <span>${ts.description || ''}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

        ${job.generatedAssets?.length ? `
          <div class="job-assets">
            <span>🎨 생성된 에셋: ${job.generatedAssets.length}개</span>
          </div>` : ''}

        <div class="job-actions">
          ${job.status === 'pending' || job.status === 'error'
            ? `<button class="btn btn-primary btn-sm" onclick="YouTube.processJobUI('${job.id}')">▶ 처리 시작</button>`
            : ''}
          ${job.status === 'done'
            ? `<button class="btn btn-outline btn-sm" onclick="YouTube.reprocess('${job.id}')">🔄 재처리</button>`
            : ''}
          <button class="btn btn-danger btn-sm" onclick="YouTube.deleteJob('${job.id}')">${_t('common.delete','삭제')}</button>
        </div>

        <div class="job-progress hidden" id="progress-${job.id}">
          <div class="progress-bar"><div class="progress-fill" id="fill-${job.id}"></div></div>
          <p class="progress-msg" id="msg-${job.id}"></p>
        </div>
      </div>`
      )
      .join('');
  }

  async function processJobUI(jobId) {
    const progressEl = document.getElementById(`progress-${jobId}`);
    progressEl?.classList.remove('hidden');

    try {
      await processJob(jobId, ({ message, percent }) => {
        const fill = document.getElementById(`fill-${jobId}`);
        const msg = document.getElementById(`msg-${jobId}`);
        if (fill) fill.style.width = `${percent}%`;
        if (msg) msg.textContent = message;
      });
    } finally {
      renderJobList('youtube-job-list');
    }
  }

  function deleteJob(jobId) {
    if (!confirm(_t('youtube.deleteConfirm','이 작업을 삭제하시겠습니까?'))) return;
    window.Storage.deleteItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId);
    renderJobList('youtube-job-list');
    window.showToast(_t('toast.deleted','삭제되었습니다.'), 'success');
  }

  async function reprocess(jobId) {
    window.Storage.updateItem(window.Storage.KEYS.YOUTUBE_JOBS, jobId, {
      status: 'pending',
      transcript: '',
      summary: '',
      shortsTimestamps: [],
      generatedAssets: [],
    });
    renderJobList('youtube-job-list');
    await processJobUI(jobId);
  }

  // ─── 유틸 ───────────────────────────────────────────────────────────────────

  function isValidYouTubeUrl(url) {
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
  }

  function extractVideoId(url) {
    const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getStatusLabel(status) {
    const map = {
      pending:    _t('youtube.status_pending','⏳ 대기'),
      processing: _t('youtube.status_processing','⚙️ 처리중'),
      done:       _t('youtube.status_done','✅ 완료'),
      error:      _t('youtube.status_error','❌ 오류'),
    };
    return map[status] || status;
  }

  return { addJob, processJob, processJobUI, renderJobList, deleteJob, reprocess };
})();

window.YouTube = YouTube;

/* ────────────────────────────────────────────────────────────
   유튜브 페이지 탭 전환
   (pages/youtube.html 인라인 스크립트는 innerHTML 삽입 시
    실행되지 않으므로 여기서 전역 함수로 등록)
   ──────────────────────────────────────────────────────────── */
window.switchYoutubeTab = function switchYoutubeTab(tab) {
  document.querySelectorAll('.yt-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.yt-panel').forEach(p => {
    p.style.display = 'none';
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.style.display = 'block';
};

/* ═══════════════════════════════════════════════════════════════════════════
   유튜브 페이지 전역 함수
   (pages/youtube.html 은 innerHTML 로드 → <script> 미실행
    → onclick 핸들러용 전역 함수를 여기서 정의)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const _t = (key, fb) => window.t ? window.t(key) : fb;

  /* ── API POST 헬퍼 ── */
  async function _apiPost(endpoint, body) {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `API 오류 ${res.status}`);
    return data;
  }

  /* ── 프롬프트 박스 토글 ── */
  window.togglePromptBox = function () {
    const box  = document.getElementById('yt-prompt-box');
    const icon = document.getElementById('prompt-toggle-icon');
    if (!box) return;
    const isOpen = box.style.display !== 'none';
    box.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.textContent = isOpen ? '▶' : '▼';
  };

  /* ── 썸네일 생성 ── */
  window.generateYoutubeThumbnail = async function () {
    const btn        = document.getElementById('btn-gen-thumbnail');
    const previewEl  = document.getElementById('yt-thumb-preview');
    const actionsEl  = document.getElementById('yt-thumb-actions');
    const promptEl   = document.getElementById('yt-prompt-result');
    const promptText = document.getElementById('yt-prompt-text');

    const videoTitle = document.getElementById('yt-video-title')?.value?.trim() || '';
    const topic      = document.getElementById('yt-video-topic')?.value?.trim()  || '';
    const mainText   = document.getElementById('yt-main-text')?.value?.trim()    || '';
    const subText    = document.getElementById('yt-sub-text')?.value?.trim()     || '';
    const style      = document.getElementById('yt-thumb-style')?.value          || 'clean';

    if (!videoTitle && !topic) {
      window.showToast(_t('toast.needKeyMsg', '영상 제목 또는 주제를 입력해주세요.'), 'warning');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = _t('create.generating', '생성 중...'); }
    if (previewEl) previewEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:2rem;">
        <div class="spinner"></div>
        <p style="font-size:12px;color:var(--color-text-light);">
          ${_t('create.imageWaiting', '이미지 생성 중... (30~60초 소요)')}
        </p>
      </div>`;

    try {
      const promptResp = await fetch('/api/youtube/thumbnail-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle, topic, mainText, subText, style }),
      });
      const promptData = await promptResp.json();
      if (!promptData.success) throw new Error(promptData.error || 'Prompt generation failed');

      const imgResp = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePrompt:    promptData.imagePrompt,
          negativePrompt: promptData.negativePrompt || '',
          sizePreset:     '16:9',
        }),
      });
      const imgData = await imgResp.json();
      if (!imgData.success) throw new Error(imgData.error || 'Image generation failed');

      if (previewEl) previewEl.innerHTML =
        `<img src="${imgData.imageUrl}" alt="thumbnail" style="width:100%;height:100%;object-fit:cover;">`;
      if (actionsEl) actionsEl.style.display = 'flex';
      if (promptEl) {
        promptEl.style.display = 'block';
        const box  = document.getElementById('yt-prompt-box');
        const icon = document.getElementById('prompt-toggle-icon');
        if (box)  box.style.display = 'none';
        if (icon) icon.textContent  = '▶';
      }
      if (promptText) promptText.value = promptData.imagePrompt;
      window._ytThumbnailData = { imageUrl: imgData.imageUrl, imagePrompt: promptData.imagePrompt, videoTitle, topic, mainText };
      window.showToast(_t('toast.imageGenDone', '썸네일이 생성되었습니다 ✅'), 'success');

    } catch (err) {
      if (previewEl) previewEl.innerHTML = `
        <div class="yt-thumb-empty">
          <span style="font-size:1.5rem;">⚠️</span>
          <p style="color:var(--ib-primary);font-size:12px;">${err.message}</p>
        </div>`;
      window.showToast(`${_t('toast.imageGenFail', '이미지 생성 실패')}: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled    = false;
        btn.textContent = _t('youtube.generateThumbnail', '썸네일 생성');
      }
    }
  };

  window.downloadThumbnail = function () {
    const d = window._ytThumbnailData;
    if (!d?.imageUrl) return;
    const a = document.createElement('a');
    a.href     = d.imageUrl;
    a.download = `inbody-thumbnail-${Date.now()}.png`;
    a.click();
    window.showToast(_t('toast.downloadStart', '다운로드를 시작합니다.'), 'success');
  };

  window.saveThumbnailAsAsset = function () {
    const d = window._ytThumbnailData;
    if (!d?.imageUrl) return;
    window.Storage.addItem(window.Storage.KEYS.ASSETS, {
      text:         d.videoTitle || d.mainText || 'YouTube Thumbnail',
      category:     'youtube',
      country:      'KR',
      channel:      'youtube-thumbnail',
      imageUrl:     d.imageUrl,
      copyHeadline: d.mainText || '',
      copySubtext:  d.topic    || '',
    });
    window.updateBadges?.();
    window.showToast(_t('toast.assetSaved', '에셋이 저장되었습니다!'), 'success');
  };

  window.copyYoutubePrompt = function () {
    const text = document.getElementById('yt-prompt-text')?.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      window.showToast(_t('toast.copied', '클립보드에 복사되었습니다 ✅'), 'success');
    });
  };

  /* ── 영상 분석 시작 ── */
  window.startYoutubeAnalysis = async function () {
    const url = document.getElementById('yt-url-input')?.value?.trim();
    if (!url) {
      window.showToast(_t('toast.enterUrl', '유튜브 URL을 입력해주세요.'), 'warning');
      return;
    }
    if (!/youtube\.com|youtu\.be/.test(url)) {
      window.showToast(_t('toast.invalidUrl', '올바른 유튜브 URL이 아닙니다.'), 'error');
      return;
    }

    const btn = document.getElementById('btn-start-analysis');
    if (btn) { btn.disabled = true; btn.textContent = _t('youtube.processingBtn', '처리 중...'); }

    const resultSection = document.getElementById('analysis-result-section');
    if (resultSection) resultSection.style.display = 'none';

    const jobData = { url, text: url, status: 'processing', generatedAssets: [] };

    try {
      const extractRes = await _apiPost('/api/youtube/extract', { url });
      jobData.text = extractRes.title || url;

      const analyzeRes = await _apiPost('/api/claude/analyze', {
        transcript: extractRes.transcript || '',
        videoTitle: extractRes.title      || url,
      });

      _renderAnalysisResult(analyzeRes, extractRes.title || url);

      jobData.status  = 'done';
      jobData.summary = analyzeRes.summary || '';
      window.Storage.addItem(window.Storage.KEYS.YOUTUBE_JOBS, jobData);
      window.updateBadges?.();
      _renderHistory();

      window.showToast(_t('youtube.allDone', '분석이 완료되었습니다! 🎉'), 'success');

    } catch (err) {
      jobData.status = 'error';
      window.Storage.addItem(window.Storage.KEYS.YOUTUBE_JOBS, jobData);
      _renderHistory();
      window.showToast(`${_t('youtube.processingError', '처리 중 오류')}: ${err.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled    = false;
        btn.textContent = _t('youtube.startAnalysis', '▶ 영상 분석 시작');
      }
    }
  };

  function _renderAnalysisResult(analysis, videoTitle) {
    const section = document.getElementById('analysis-result-section');
    if (!section) return;

    const summaryEl = document.getElementById('analysis-summary');
    if (summaryEl) summaryEl.textContent = analysis.summary || '-';

    const kpEl = document.getElementById('analysis-keypoints');
    if (kpEl) {
      const points = analysis.keyPoints ||
        analysis.timestamps?.map(t => t.description) ||
        analysis.shortsTimestamps?.map(t => t.description) || [];
      kpEl.innerHTML = points.length
        ? points.map(p => `<li>${p}</li>`).join('')
        : `<li style="color:var(--color-text-light)">-</li>`;
    }

    const cardsEl = document.getElementById('prompt-cards');
    if (cardsEl) {
      const prompts = [
        { icon: '📱', labelKey: 'youtube.promptForSNS',       label: 'SNS 카피 프롬프트',   text: analysis.snsPrompt       || analysis.snsPromptText       || '' },
        { icon: '🎬', labelKey: 'youtube.promptForThumbnail', label: '썸네일 제작 프롬프트', text: analysis.thumbnailPrompt || analysis.thumbnailPromptText || '' },
        { icon: '💼', labelKey: 'youtube.promptForB2B',       label: 'B2B 제안서 프롬프트',  text: analysis.b2bPrompt       || analysis.b2bPromptText       || '' },
      ];
      cardsEl.innerHTML = prompts.map(p => `
        <div class="prompt-card">
          <div class="prompt-card-head">
            <span class="prompt-card-label">${p.icon} ${_t(p.labelKey, p.label)}</span>
            <button class="btn-use-prompt" onclick="useAnalysisPrompt(this)"
                    data-prompt="${(p.text || '').replace(/"/g, '&quot;')}">
              ${_t('youtube.usePrompt', '이 프롬프트 사용')}
            </button>
          </div>
          <p class="prompt-card-text">${p.text || '-'}</p>
        </div>`).join('');
    }

    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth' });
  }

  window.useAnalysisPrompt = function (btn) {
    const text = btn.dataset.prompt;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      window.showToast(_t('toast.copied', '클립보드에 복사되었습니다 ✅'), 'success');
    });
  };

  /* ── 히스토리 렌더 ── */
  function _renderHistory() {
    const KEYS    = window.Storage?.KEYS;
    if (!KEYS) return;
    const jobs    = window.Storage.getData(KEYS.YOUTUBE_JOBS);
    const listEl  = document.getElementById('history-list');
    const countEl = document.getElementById('history-count');
    if (countEl) countEl.textContent = jobs.length;
    if (!listEl) return;

    if (!jobs.length) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:3rem 0;">
          <div class="empty-icon">🎬</div>
          <p class="empty-title">${_t('youtube.noHistory', '처리된 영상이 없습니다.')}</p>
          <p class="empty-desc">${_t('youtube.noHistoryDesc', '유튜브 URL을 입력하면 자동으로 처리 내역이 쌓입니다.')}</p>
        </div>`;
      return;
    }

    const statusCls = s => ({ done:'status-done', processing:'status-processing', error:'status-error', pending:'status-pending' }[s] || '');
    const statusLbl = s => ({ done: _t('youtube.statusDone','완료'), processing: _t('youtube.statusProcessing','처리 중'), error: _t('youtube.statusError','오류'), pending: _t('youtube.statusPending','대기') }[s] || s);
    const loc       = window.getCurrentLang?.() === 'en' ? 'en-AU' : 'ko-KR';

    listEl.innerHTML = [...jobs].reverse().map(j => `
      <div class="history-row">
        <div class="history-row-main">
          <div class="history-row-title">
            <a href="${j.url || '#'}" target="_blank" rel="noopener"
               style="color:var(--ib-primary);text-decoration:underline;font-size:13px;">
              ${j.text || j.url || '-'}
            </a>
          </div>
          <div class="history-row-meta">
            <span class="status-badge ${statusCls(j.status)}">${statusLbl(j.status)}</span>
            <span style="font-size:11px;color:var(--color-text-muted);">
              ${new Date(j.createdAt).toLocaleDateString(loc, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
            </span>
          </div>
        </div>
        <button class="btn-del-job btn btn-sm btn-danger"
                data-id="${j.id}" title="${_t('youtube.btnDelete','삭제')}">🗑️</button>
      </div>`
    ).join('');
  }

  /* initYoutubePage() 에서 호출 — DOM 로드 후 이벤트 바인딩 + 초기 렌더 */
  window._ytInitPage = function () {
    document.getElementById('history-list')?.addEventListener('click', e => {
      const btn = e.target.closest('.btn-del-job');
      if (!btn) return;
      const KEYS = window.Storage?.KEYS;
      if (!KEYS) return;
      if (!confirm(_t('youtube.deleteConfirm', '이 처리 내역을 삭제하시겠습니까?'))) return;
      window.Storage.deleteItem(KEYS.YOUTUBE_JOBS, btn.dataset.id);
      _renderHistory();
      window.updateBadges?.();
      window.showToast(_t('toast.deleted', '삭제되었습니다.'), 'success');
    });

    window.currentPageRender = _renderHistory;
    _renderHistory();
  };

  window._ytRenderHistory = _renderHistory;
})();
