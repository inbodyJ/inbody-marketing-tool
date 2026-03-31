/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - HTML 직접 삽입 시 data-i18n 속성 필수
 * - 새 텍스트 추가 시 i18n.js의 ko/en 동시 업데이트
 * - 국가 표기: t('common.country_au') / t('common.country_uk')
 */

/**
 * storage.js — InBody Marketing Tool
 * localStorage 읽기/쓰기/삭제 공통 함수
 */

const KEYS = {
  ASSETS: 'inbody_assets',
  PROMPTS: 'inbody_prompts',
  YOUTUBE_JOBS: 'inbody_youtube_jobs',
};

/**
 * UUID v4 생성
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * 해당 키의 배열 반환 (없으면 빈 배열)
 */
function getData(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`[storage] getData error (key: ${key})`, e);
    return [];
  }
}

/**
 * 배열 전체를 localStorage에 저장
 */
function saveData(key, array) {
  try {
    localStorage.setItem(key, JSON.stringify(array));
    return true;
  } catch (e) {
    console.error(`[storage] saveData error (key: ${key})`, e);
    return false;
  }
}

/**
 * 배열에 항목 추가 후 저장
 */
function addItem(key, item) {
  const data = getData(key);
  const newItem = {
    id: item.id || generateId(),
    createdAt: item.createdAt || new Date().toISOString(),
    completed: item.completed ?? false,
    ...item,
  };
  data.unshift(newItem); // 최신순
  saveData(key, data);
  return newItem;
}

/**
 * id로 항목 찾아 업데이트
 */
function updateItem(key, id, updates) {
  const data = getData(key);
  const idx = data.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() };
  saveData(key, data);
  return data[idx];
}

/**
 * id로 항목 삭제
 */
function deleteItem(key, id) {
  const data = getData(key);
  const filtered = data.filter((item) => item.id !== id);
  if (filtered.length === data.length) return false;
  saveData(key, filtered);
  return true;
}

/**
 * 항목 검색 (text, category, country, channel 필드 기준)
 */
function searchItems(key, query) {
  if (!query) return getData(key);
  const q = query.toLowerCase();
  return getData(key).filter((item) =>
    ['text', 'category', 'country', 'channel', 'copyHeadline', 'copySubtext', 'rationale']
      .some((field) => item[field] && item[field].toLowerCase().includes(q))
  );
}

/**
 * 항목 필터 (key-value 조건 객체)
 */
function filterItems(key, filters = {}) {
  return getData(key).filter((item) =>
    Object.entries(filters).every(([k, v]) => !v || item[k] === v)
  );
}

/**
 * 전체 통계 반환
 */
function getStats() {
  const assets = getData(KEYS.ASSETS);
  const prompts = getData(KEYS.PROMPTS);
  const jobs = getData(KEYS.YOUTUBE_JOBS);

  const countBy = (arr, field) =>
    arr.reduce((acc, item) => {
      const val = item[field] || 'unknown';
      acc[val] = (acc[val] || 0) + 1;
      return acc;
    }, {});

  return {
    assets: {
      total: assets.length,
      byCategory: countBy(assets, 'category'),
      byCountry: countBy(assets, 'country'),
      byChannel: countBy(assets, 'channel'),
    },
    prompts: {
      total: prompts.length,
      byCategory: countBy(prompts, 'category'),
      byCountry: countBy(prompts, 'country'),
      totalUseCount: prompts.reduce((s, p) => s + (p.useCount || 0), 0),
    },
    youtube: {
      total: jobs.length,
      byStatus: countBy(jobs, 'status'),
      totalGeneratedAssets: jobs.reduce((s, j) => s + (j.generatedAssets?.length || 0), 0),
    },
  };
}

/**
 * 전체 데이터 내보내기 (JSON)
 */
function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    assets: getData(KEYS.ASSETS),
    prompts: getData(KEYS.PROMPTS),
    youtubeJobs: getData(KEYS.YOUTUBE_JOBS),
  };
}

/**
 * 전체 데이터 가져오기 (JSON)
 */
function importAll(jsonData) {
  if (jsonData.assets) saveData(KEYS.ASSETS, jsonData.assets);
  if (jsonData.prompts) saveData(KEYS.PROMPTS, jsonData.prompts);
  if (jsonData.youtubeJobs) saveData(KEYS.YOUTUBE_JOBS, jsonData.youtubeJobs);
}

window.Storage = {
  KEYS,
  generateId,
  getData,
  saveData,
  addItem,
  updateItem,
  deleteItem,
  searchItems,
  filterItems,
  getStats,
  exportAll,
  importAll,
};
