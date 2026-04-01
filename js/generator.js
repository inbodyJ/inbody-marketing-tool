// js/generator.js
// API_BASE는 api.js에서 전역으로 선언됨 ('/api')

async function generate() {
  const type    = document.getElementById('contentType').value;
  const market  = document.getElementById('market').value;
  const product = document.getElementById('product').value;
  const keywords= document.getElementById('keywords').value;

  showLoading();

  try {
    if (type === 'ppt') {
      // PPT는 파일 다운로드
      const res = await fetch(`${API_BASE}/generate/ppt`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ product, market, target: keywords })
      });
      const blob = await res.blob();
      triggerDownload(blob, `InBody_${product}_proposal.pptx`);

    } else {
      // 블로그·SNS는 텍스트 미리보기
      const endpoint = type === 'blog' ? '/generate/blog' : '/generate/sns';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          product,
          market,
          target: keywords,
          keywords,
          tone: getTone(market)
        })
      });
      const data = await res.json();
      showResult(data.content);
    }

  } catch(e) {
    showError('생성 중 오류가 발생했습니다. 다시 시도해주세요.');
  }
}

function getTone(market) {
  return market === 'KR'         ? '감성적·정보형'  :
         market === 'AU_FITNESS' ? '캐주얼·활기차게' :
                                   '전문적·신뢰감';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download  = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyResult() {
  const text = document.getElementById('result-preview').innerText;
  navigator.clipboard.writeText(text);
  alert('📋 복사 완료!');
}

// ── UI 헬퍼 ──────────────────────────────────────────────────────────────────

function showLoading() {
  const section = document.getElementById('result-section');
  const preview = document.getElementById('result-preview');
  if (!section || !preview) return;
  section.style.display = '';
  preview.innerHTML = `
    <div class="flex-center" style="padding: 2rem;">
      <div class="spinner"></div>
      <span style="margin-left:0.75rem; color:var(--text-muted);">생성 중...</span>
    </div>`;
  document.getElementById('downloadBtn')?.style && (document.getElementById('downloadBtn').style.display = 'none');
}

function showResult(text) {
  const section = document.getElementById('result-section');
  const preview = document.getElementById('result-preview');
  if (!section || !preview) return;
  section.style.display = '';
  preview.textContent = text;
  section.scrollIntoView({ behavior: 'smooth' });
}

function showError(message) {
  const section = document.getElementById('result-section');
  const preview = document.getElementById('result-preview');
  if (!section || !preview) return;
  section.style.display = '';
  preview.innerHTML = `
    <div class="empty-state" style="padding:1.5rem;">
      <span class="empty-icon">⚠️</span>
      <p style="color:var(--text-muted); margin-top:0.5rem;">${message}</p>
    </div>`;
}
