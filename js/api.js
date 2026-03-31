/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

/**
 * api.js — InBody Marketing Tool
 * 외부 API 호출 함수 (Claude, Gemini, Canva → Flask 서버 경유)
 */

const API_BASE = '/api';

// ─── 공통 fetch 래퍼 ───────────────────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API Error ${res.status}`);
  return data;
}

// ─── Claude API ────────────────────────────────────────────────────────────────

/**
 * 에셋 카피 생성 (헤드라인 + 서브카피)
 * @param {Object} params - { category, country, channel, productName, keyMessage }
 */
async function generateCopy(params) {
  return apiFetch('/generate-copy', {
    method: 'POST',
    body: JSON.stringify({
      category:       params.category       || '',
      country:        params.country        || 'KR',
      channel:        params.channel        || '',
      product:        params.productName    || params.product || '',
      conceptKeywords:params.keyMessage     || params.conceptKeywords || '',
      style:          params.style          || 'professional',
    }),
  });
}

/**
 * 이미지 프롬프트 생성
 * @param {Object} params - { category, country, channel, copyHeadline, style }
 */
async function generateImagePrompt(params) {
  return apiFetch('/generate-prompt', {
    method: 'POST',
    body: JSON.stringify({
      category:       params.category       || '',
      country:        params.country        || 'KR',
      channel:        params.channel        || '',
      product:        params.productName    || params.product || '',
      conceptKeywords:params.keyMessage     || params.copyHeadline || params.conceptKeywords || '',
      style:          params.style          || 'professional',
      sizePreset:     params.sizePreset     || '1:1',
    }),
  });
}

/**
 * 유튜브 영상 자막 분석 → 요약 + 쇼츠 구간 추천
 * @param {Object} params - { transcript, videoTitle }
 */
async function analyzeTranscript(params) {
  return apiFetch('/claude/analyze', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ─── Gemini API ────────────────────────────────────────────────────────────────

/**
 * 유튜브 자막 추출 (Gemini)
 * @param {string} youtubeUrl
 */
async function extractTranscript(youtubeUrl) {
  return apiFetch('/gemini/transcript', {
    method: 'POST',
    body: JSON.stringify({ url: youtubeUrl }),
  });
}

/**
 * Gemini 이미지 생성
 * @param {Object} params - { prompt, negativePrompt, aspectRatio }
 */
async function generateImage(params) {
  return apiFetch('/generate-image', {
    method: 'POST',
    body: JSON.stringify({
      imagePrompt:    params.imagePrompt    || params.prompt || '',
      negativePrompt: params.negativePrompt || '',
      sizePreset:     params.sizePreset     || params.aspectRatio || '1:1',
    }),
  });
}

// ─── Canva API ─────────────────────────────────────────────────────────────────

/**
 * Canva 디자인 생성
 * @param {Object} params - { templateId, headline, subtext, imageUrl, brandColors }
 */
async function createCanvaDesign(params) {
  return apiFetch('/canva/design', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * Canva 디자인 내보내기 (PNG/PDF)
 * @param {string} designId
 * @param {string} format - 'png' | 'pdf'
 */
async function exportCanvaDesign(designId, format = 'png') {
  return apiFetch('/canva/export', {
    method: 'POST',
    body: JSON.stringify({ designId, format }),
  });
}

// ─── 브랜드 이미지 생성 ────────────────────────────────────────────────────────

/**
 * Pillow 브랜드 이미지 생성 (1080×1080 PNG)
 * @param {Object} params - { type, headline, body_copy, type_label, image }
 */
async function createBrandImage(params) {
  return apiFetch('/image/create', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 이미지 파일 업로드 → 서버 URL 반환
 * @param {File} file
 */
async function uploadBrandImage(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/image/upload`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '업로드 실패');
  return data.url;
}

// ─── 서버 상태 확인 ────────────────────────────────────────────────────────────

async function checkServerHealth() {
  try {
    const data = await apiFetch('/health');
    return { ok: true, ...data };
  } catch {
    return { ok: false, message: 'Flask 서버에 연결할 수 없습니다.' };
  }
}

window.API = {
  generateCopy,
  generateImagePrompt,
  analyzeTranscript,
  extractTranscript,
  generateImage,
  createCanvaDesign,
  exportCanvaDesign,
  createBrandImage,
  uploadBrandImage,
  checkServerHealth,
};
