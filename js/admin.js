/**
 * ⚠️ I18N 규칙 (I18N_RULES.md 참고)
 * - 모든 사용자 노출 텍스트는 t('key') 함수 사용
 * - 국가 표기: t('common.country_kr/au/uk')
 */

const DEFAULT_PIN = '0000';
const PIN_KEY     = 'inbody_admin_pin';
const SESSION_KEY = 'inbody_admin_session';

const _t = (key, fallback) => window.t ? window.t(key) : (fallback ?? key);

// ─── 토스트 알림 (admin 전용) ─────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── 날짜 포맷 ──────────────────────────────────────────────────────────
function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const loc = window.getCurrentLang?.() === 'en' ? 'en-AU' : 'ko-KR';
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── 초기화 (DOMContentLoaded) ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. 언어 적용
  if (typeof applyLang === 'function') applyLang(getCurrentLang());

  // 2. 잔여 goals 키 정리
  localStorage.removeItem('inbody_country_goals');

  // 3. PIN 오버레이 강제 표시 — !important CSS 클래스 기반
  _showOverlay();

  // 4. 세션 확인 후 이미 로그인된 경우만 콘텐츠 표시
  const isActive = sessionStorage.getItem(SESSION_KEY) === 'true';
  if (isActive) {
    _showContent();
  } else {
    const pinInput = document.getElementById('pin-input');
    if (pinInput) setTimeout(() => pinInput.focus(), 100);
  }

  // 5. 서버 상태 체크
  checkServerStatus();
});

// ─── PIN 오버레이 표시 (class 기반 — !important CSS로 보장) ────────────
function _showOverlay() {
  const overlay = document.getElementById('admin-pin-overlay');
  const content = document.getElementById('admin-content');

  // 오버레이 표시
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }
  // 콘텐츠 완전 숨김
  if (content) {
    content.classList.remove('visible');
    content.style.display = 'none';
  }

  // PIN 입력창 포커스
  setTimeout(() => {
    const pinInput = document.getElementById('pin-input');
    if (pinInput) pinInput.focus();
  }, 150);
}

// ─── 관리자 콘텐츠 표시 (class 기반 — !important CSS로 보장) ──────────
let _statusInterval = null;

function _showContent() {
  const overlay = document.getElementById('admin-pin-overlay');
  const content = document.getElementById('admin-content');
  if (overlay) overlay.classList.add('hidden');
  if (content) content.classList.add('visible');
  renderSystemInfo();
  updateDMStats();
  if (typeof applyLang === 'function') applyLang(getCurrentLang());

  // 서버 상태 즉시 체크 + 30초 인터벌 (중복 방지)
  checkServerStatus();
  if (_statusInterval) clearInterval(_statusInterval);
  _statusInterval = setInterval(checkServerStatus, 30000);
}

// 하위 호환 — 기존 코드에서 호출될 경우를 위한 별칭
const showPinOverlay   = _showOverlay;
const showAdminContent = _showContent;

// ─── PIN 검증 ────────────────────────────────────────────────────────────
function verifyPin() {
  const input   = document.getElementById('pin-input');
  const errorEl = document.getElementById('pin-error');
  if (!input) return;

  const entered = input.value;
  const saved   = localStorage.getItem(PIN_KEY) || DEFAULT_PIN;

  if (entered === saved) {
    // 1. 세션 저장
    sessionStorage.setItem(SESSION_KEY, 'true');

    // 2. 오류 숨기기
    if (errorEl) errorEl.style.display = 'none';

    // 3. 오버레이 숨기기
    const overlay = document.getElementById('admin-pin-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
    }

    // 4. 콘텐츠 표시
    const content = document.getElementById('admin-content');
    if (content) {
      content.classList.add('visible');
      content.style.display = 'flex';
    }

    // 5. 렌더링
    if (typeof renderSystemInfo === 'function') renderSystemInfo();
    if (typeof updateDMStats    === 'function') updateDMStats();
    if (typeof applyLang        === 'function') applyLang(getCurrentLang());

    // 6. 토스트 (콘텐츠 표시 후)
    setTimeout(() => showToast(_t('admin.pinSuccess')), 300);

  } else {
    if (errorEl) errorEl.style.display = 'block';
    input.value = '';
    input.focus();
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 400);
  }
}

// ─── 관리자 로그아웃 ────────────────────────────────────────────────────
function adminLogout() {
  if (!confirm(_t('admin.logoutConfirm'))) return;

  // 1. 세션 완전 삭제
  sessionStorage.clear();
  localStorage.removeItem('inbody_admin_verified');

  // 2. PIN 입력창 초기화
  const pinInput = document.getElementById('pin-input');
  const errorEl  = document.getElementById('pin-error');
  if (pinInput) pinInput.value = '';
  if (errorEl)  errorEl.style.display = 'none';

  // 3. 콘텐츠 즉시 숨기기
  const content = document.getElementById('admin-content');
  if (content) {
    content.classList.remove('visible');
    content.style.display = 'none';
  }

  // 4. 오버레이 즉시 표시
  const overlay = document.getElementById('admin-pin-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }

  // 5. PIN 포커스
  setTimeout(() => {
    const pin = document.getElementById('pin-input');
    if (pin) pin.focus();
  }, 100);

  // 토스트 없음 — 조용히 종료
}

// ─── 아코디언 토글 ────────────────────────────────────────────────────────
function toggleAccordion(id) {
  const item = document.getElementById(id);
  if (!item) return;
  const isOpen = item.classList.contains('open');

  // 모든 아코디언 닫기
  document.querySelectorAll('.accordion-item').forEach(el => {
    el.classList.remove('open');
  });

  // 클릭한 것만 토글
  if (!isOpen) item.classList.add('open');
}

// ─── PIN 변경 ────────────────────────────────────────────────────────────
function changePin() {
  const current = document.getElementById('current-pin')?.value;
  const newPin  = document.getElementById('new-pin')?.value;
  const saved   = localStorage.getItem(PIN_KEY) || DEFAULT_PIN;

  if (current !== saved) {
    showToast(_t('admin.pinError'), 'error'); return;
  }
  if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
    showToast('PIN은 숫자 4자리여야 합니다.', 'error'); return;
  }
  localStorage.setItem(PIN_KEY, newPin);
  showToast(_t('admin.pinChangeDone'));
  document.getElementById('current-pin').value = '';
  document.getElementById('new-pin').value     = '';
}

// ─── 초기화 ──────────────────────────────────────────────────────────────
function adminReset(type) {
  if (!confirm(_t('admin.resetConfirm'))) return;
  if (type === 'all' || type === 'assets')
    window.Storage.saveData(window.Storage.KEYS.ASSETS, []);
  if (type === 'all' || type === 'prompts')
    window.Storage.saveData(window.Storage.KEYS.PROMPTS, []);
  if (type === 'all' || type === 'youtube')
    window.Storage.saveData(window.Storage.KEYS.YOUTUBE_JOBS, []);
  showToast(_t('admin.resetDone'));
  updateDMStats();
  renderSystemInfo();
}

// ─── 시스템 정보 ─────────────────────────────────────────────────────────
function renderSystemInfo() {
  const grid = document.getElementById('admin-system-grid');
  if (!grid) return;

  const assets  = window.Storage.getData(window.Storage.KEYS.ASSETS)       || [];
  const prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS)      || [];
  const jobs    = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS) || [];
  const total   = JSON.stringify({ assets, prompts, jobs });
  const kb      = (new Blob([total]).size / 1024).toFixed(1);
  const backup  = localStorage.getItem('inbody_last_backup');
  const version = '1.0.1';

  const ua = navigator.userAgent;
  const browser = ua.includes('Edg') ? 'Edge'
    : ua.includes('Chrome') ? 'Chrome'
    : ua.includes('Safari') ? 'Safari'
    : ua.includes('Firefox') ? 'Firefox'
    : 'Other';

  grid.innerHTML = [
    { label: _t('admin.appVersion'),  value: `v${version}` },
    { label: _t('admin.storageUsed'), value: `${kb} KB` },
    { label: _t('admin.lastBackup'),
      value: backup ? formatDate(backup) : _t('dataManagement.backupNever') },
    { label: _t('admin.browser'), value: browser },
  ].map(item => `
    <div class="system-info-chip">
      <div class="system-info-label">${item.label}</div>
      <div class="system-info-value">${item.value}</div>
    </div>`).join('');
}

// ─── 데이터 관리 통계 ────────────────────────────────────────────────────
function updateDMStats() {
  const assets  = window.Storage.getData(window.Storage.KEYS.ASSETS)       || [];
  const prompts = window.Storage.getData(window.Storage.KEYS.PROMPTS)      || [];
  const jobs    = window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS) || [];

  const setStatChip = (elId, value) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = value;
    el.style.color = value > 0 ? 'var(--ib-primary)' : 'var(--color-text-light)';
  };
  setStatChip('dm-stat-assets',  assets.length);
  setStatChip('dm-stat-prompts', prompts.length);
  setStatChip('dm-stat-youtube', jobs.length);

  const totalStr = JSON.stringify({ assets, prompts, jobs });
  const kb = (new Blob([totalStr]).size / 1024).toFixed(1);
  const sizeEl = document.getElementById('dm-stat-size');
  if (sizeEl) {
    sizeEl.textContent = `${kb} KB`;
    sizeEl.style.color = parseFloat(kb) > 0.5 ? 'var(--ib-primary)' : 'var(--color-text-light)';
  }

  const lastBackup = localStorage.getItem('inbody_last_backup');
  const dateEl = document.getElementById('last-backup-date');
  if (dateEl) {
    dateEl.textContent = lastBackup
      ? formatDate(lastBackup)
      : _t('dataManagement.backupNever', '백업 기록 없음');
  }

  const toggle = document.getElementById('auto-backup-toggle');
  if (toggle) toggle.checked = localStorage.getItem('inbody_auto_backup') === 'true';
}

// ─── 내보내기 ────────────────────────────────────────────────────────────
function exportJSON(mode = 'all') {
  const data = {
    exportedAt: new Date().toISOString(),
    version:    '1.0',
    assets:     window.Storage.getData(window.Storage.KEYS.ASSETS),
    prompts:    window.Storage.getData(window.Storage.KEYS.PROMPTS),
    youtube:    window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS),
  };
  const blob    = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `inbody-marketing-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  if (mode === 'backup') {
    localStorage.setItem('inbody_last_backup', new Date().toISOString());
    updateDMStats();
    renderSystemInfo();
  }
  showToast(_t('toast.exportDone', '내보내기 완료!'), 'success');
}

function exportCSV() {
  const assets = window.Storage.getData(window.Storage.KEYS.ASSETS) || [];
  if (assets.length === 0) {
    showToast(_t('assets.noAssets', '에셋이 없습니다.'), 'error'); return;
  }
  const headers = ['id', 'text', 'category', 'country', 'channel', 'copyHeadline', 'createdAt'];
  const rows = assets.map(a =>
    headers.map(h => `"${(a[h] || '').toString().replace(/"/g, '""')}"`).join(',')
  );
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `inbody-assets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(_t('toast.csvDone', 'CSV 내보내기 완료!'), 'success');
}

function openExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'flex';
}

function closeExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'none';
}

function exportFiltered() {
  const type    = document.getElementById('export-type')?.value    || 'all';
  const country = document.getElementById('export-country')?.value || 'all';
  const period  = document.getElementById('export-period')?.value  || 'all';

  const filterByPeriod = arr => arr.filter(a => {
    if (period === 'all') return true;
    const d   = new Date(a.createdAt);
    const now = new Date();
    if (period === 'month')
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'week') {
      const weekAgo = new Date(now - 7 * 86400000);
      return d >= weekAgo;
    }
    return true;
  });
  const filterByCountry = arr => country === 'all' ? arr : arr.filter(a => a.country === country);
  const apply = arr => filterByPeriod(filterByCountry(arr));

  const data = { exportedAt: new Date().toISOString(), version: '1.0' };
  if (type === 'all' || type === 'assets')
    data.assets  = apply(window.Storage.getData(window.Storage.KEYS.ASSETS));
  if (type === 'all' || type === 'prompts')
    data.prompts = apply(window.Storage.getData(window.Storage.KEYS.PROMPTS));
  if (type === 'all' || type === 'youtube')
    data.youtube = apply(window.Storage.getData(window.Storage.KEYS.YOUTUBE_JOBS));

  const blob    = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `inbody-export-${type}-${country}-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  closeExportModal();
  showToast(_t('toast.exportDone', '내보내기 완료!'), 'success');
}

// ─── 가져오기 ────────────────────────────────────────────────────────────
function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const mode   = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.assets && !data.prompts && !data.youtube)
        throw new Error('invalid');

      if (mode === 'replace') {
        if (data.assets)  window.Storage.saveData(window.Storage.KEYS.ASSETS,       data.assets);
        if (data.prompts) window.Storage.saveData(window.Storage.KEYS.PROMPTS,      data.prompts);
        if (data.youtube) window.Storage.saveData(window.Storage.KEYS.YOUTUBE_JOBS, data.youtube);
      } else {
        const merge = (key, incoming) => {
          if (!incoming) return;
          const existing = window.Storage.getData(key) || [];
          const existIds = new Set(existing.map(x => x.id));
          const newItems = incoming.filter(x => !existIds.has(x.id));
          window.Storage.saveData(key, [...existing, ...newItems]);
        };
        merge(window.Storage.KEYS.ASSETS,       data.assets);
        merge(window.Storage.KEYS.PROMPTS,      data.prompts);
        merge(window.Storage.KEYS.YOUTUBE_JOBS, data.youtube);
      }
      showToast(_t('dataManagement.importSuccess', '데이터를 성공적으로 가져왔습니다 ✅'), 'success');
      updateDMStats();
      renderSystemInfo();
    } catch {
      showToast(_t('dataManagement.importError', '파일 형식이 올바르지 않습니다.'), 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ─── 자동 백업 ──────────────────────────────────────────────────────────
function toggleAutoBackup(enabled) {
  localStorage.setItem('inbody_auto_backup', enabled);
  const msg = enabled
    ? _t('dataManagement.backupToggle', '자동 백업 사용') + ' ✅'
    : '자동 백업 비활성화';
  showToast(msg, 'info');
}

// ─── 서버 상태 체크 ─────────────────────────────────────────────────────
function checkServerStatus() {
  const dotEls  = [document.getElementById('status-dot'), document.getElementById('sidebar-status-dot')];
  const textEls = [document.getElementById('status-text'), document.getElementById('sidebar-status-text')];

  fetch('/api/health', { signal: AbortSignal.timeout(3000) })
    .then(r => {
      const ok = r.ok;
      dotEls.forEach(el  => { if (el) el.className = `status-dot ${ok ? 'status-online' : 'status-offline'}`; });
      textEls.forEach(el => {
        if (el) el.textContent = ok
          ? _t('common.serverConnected', '🟢 서버 연결됨')
          : _t('common.serverDisconnected', '🔴 서버 오프라인');
      });
    })
    .catch(() => {
      dotEls.forEach(el  => { if (el) el.className = 'status-dot status-offline'; });
      textEls.forEach(el => { if (el) el.textContent = _t('common.serverDisconnected', '🔴 서버 오프라인'); });
    });
}

// ─── 언어 전환 (standalone 페이지용) ──────────────────────────────────
window.currentPageRender = () => {
  if (sessionStorage.getItem(SESSION_KEY) === 'true') {
    renderSystemInfo();
    updateDMStats();
  }
};

// ─── 전역 노출 (admin.html inline onclick 핸들러용) ───────────────────
window.toggleAccordion  = toggleAccordion;
window.verifyPin        = verifyPin;
window.adminLogout      = adminLogout;
window.changePin        = changePin;
window.adminReset       = adminReset;
window.exportJSON       = exportJSON;
window.exportCSV        = exportCSV;
window.openExportModal  = openExportModal;
window.closeExportModal = closeExportModal;
window.exportFiltered   = exportFiltered;
window.importJSON       = importJSON;
window.toggleAutoBackup = toggleAutoBackup;
