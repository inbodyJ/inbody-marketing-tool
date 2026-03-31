/**
 * brand.js — 브랜드 이미지 생성 페이지
 * /api/image/create 엔드포인트와 연동
 */

window.BrandGenerator = (() => {
  let selectedType     = 'a';
  let uploadedImageUrl = null;
  let currentPngUrl    = null;

  // ── 초기화 ──────────────────────────────────────────────────────────────

  function init() {
    selectedType     = 'a';
    uploadedImageUrl = null;
    currentPngUrl    = null;

    _initTypeCards();
    _initCharCounters();
    _initImageUpload();
    _resetPreview();
  }

  function _initTypeCards() {
    document.querySelectorAll('.brand-type-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.brand-type-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedType = card.dataset.type;
      });
    });
  }

  function _initCharCounters() {
    const hl = document.getElementById('brand-headline');
    const hlC = document.getElementById('brand-headline-count');
    hl?.addEventListener('input', () => { if (hlC) hlC.textContent = hl.value.length; });

    const bc = document.getElementById('brand-body-copy');
    const bcC = document.getElementById('brand-body-count');
    bc?.addEventListener('input', () => { if (bcC) bcC.textContent = bc.value.length; });
  }

  function _initImageUpload() {
    const zone      = document.getElementById('brand-upload-zone');
    const input     = document.getElementById('brand-image-file');
    const removeBtn = document.getElementById('brand-upload-remove');

    // 클릭 → 파일 선택
    zone?.addEventListener('click', e => {
      if (removeBtn && (e.target === removeBtn || removeBtn.contains(e.target))) return;
      input?.click();
    });

    // 드래그 앤 드롭
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone?.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) _handleImageFile(file);
    });

    input?.addEventListener('change', () => {
      if (input.files?.[0]) _handleImageFile(input.files[0]);
    });

    removeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      _clearImage();
    });
  }

  function _handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      window.showToast?.('이미지 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      window.showToast?.('파일 크기는 10MB 이하여야 합니다.', 'error');
      return;
    }

    // 로컬 썸네일 미리보기
    const reader = new FileReader();
    reader.onload = e => {
      const thumb   = document.getElementById('brand-upload-thumb');
      const preview = document.getElementById('brand-upload-preview');
      const inner   = document.getElementById('brand-upload-inner');
      if (thumb)   thumb.src = e.target.result;
      if (preview) preview.hidden = false;
      if (inner)   inner.hidden  = true;
    };
    reader.readAsDataURL(file);

    // 서버 업로드
    const uploading = document.getElementById('brand-upload-uploading');
    if (uploading) uploading.hidden = false;

    API.uploadBrandImage(file)
      .then(url => {
        uploadedImageUrl = url;
        if (uploading) uploading.hidden = true;
      })
      .catch(err => {
        if (uploading) uploading.hidden = true;
        window.showToast?.('이미지 업로드 실패: ' + err.message, 'error');
        _clearImage();
      });
  }

  function _clearImage() {
    uploadedImageUrl = null;
    const inner    = document.getElementById('brand-upload-inner');
    const preview  = document.getElementById('brand-upload-preview');
    const input    = document.getElementById('brand-image-file');
    if (inner)   inner.hidden   = false;
    if (preview) preview.hidden = true;
    if (input)   input.value   = '';
  }

  // ── 이미지 생성 ──────────────────────────────────────────────────────────

  async function generate() {
    const headline = document.getElementById('brand-headline')?.value.trim();
    if (!headline) {
      window.showToast?.(window.t?.('brand.errorHeadline') || '헤드라인을 입력하세요.', 'error');
      document.getElementById('brand-headline')?.focus();
      return;
    }

    const bodyCopy  = document.getElementById('brand-body-copy')?.value.trim()  || '';
    const typeLabel = document.getElementById('brand-type-label')?.value.trim() || '';

    _setLoading(true);

    try {
      const data = await API.createBrandImage({
        type:       selectedType,
        headline,
        body_copy:  bodyCopy,
        type_label: typeLabel,
        image:      uploadedImageUrl || '',
      });

      if (data.ok && data.png_url) {
        _showResult(data.png_url);
      } else {
        throw new Error(data.error || '이미지 생성 실패');
      }
    } catch (e) {
      window.showToast?.(e.message, 'error');
      _setLoading(false);
      _resetPreview();
    }
  }

  // ── UI 상태 ───────────────────────────────────────────────────────────────

  function _setLoading(on) {
    const btn    = document.getElementById('brand-generate-btn');
    const label  = document.getElementById('brand-generate-label');
    const icon   = document.getElementById('brand-generate-icon');
    const empty  = document.getElementById('brand-preview-empty');
    const loading = document.getElementById('brand-preview-loading');
    const img    = document.getElementById('brand-preview-img');
    const actions = document.getElementById('brand-preview-actions');

    if (btn)   btn.disabled = on;
    if (icon)  icon.textContent  = on ? '' : '✨';
    if (label) label.textContent = on
      ? (window.t?.('brand.generating') || '생성 중...')
      : (window.t?.('brand.generateBtn') || '이미지 생성');

    if (on) {
      if (empty)   empty.hidden   = true;
      if (img)     img.hidden     = true;
      if (actions) actions.hidden = true;
      if (loading) loading.hidden = false;
    } else {
      if (loading) loading.hidden = true;
    }
  }

  function _showResult(pngUrl) {
    currentPngUrl = pngUrl;

    const loading  = document.getElementById('brand-preview-loading');
    const img      = document.getElementById('brand-preview-img');
    const actions  = document.getElementById('brand-preview-actions');
    const dlBtn    = document.getElementById('brand-download-btn');
    const btn      = document.getElementById('brand-generate-btn');
    const label    = document.getElementById('brand-generate-label');
    const icon     = document.getElementById('brand-generate-icon');

    if (loading) loading.hidden = true;

    if (img) {
      img.src    = pngUrl;
      img.hidden = false;
    }
    if (actions) actions.hidden = false;
    if (dlBtn)   dlBtn.href    = pngUrl;

    if (btn)   btn.disabled      = false;
    if (icon)  icon.textContent  = '🔄';
    if (label) label.textContent = window.t?.('brand.regenerateBtn') || '다시 생성';
  }

  function _resetPreview() {
    const empty   = document.getElementById('brand-preview-empty');
    const loading = document.getElementById('brand-preview-loading');
    const img     = document.getElementById('brand-preview-img');
    const actions = document.getElementById('brand-preview-actions');

    if (empty)   empty.hidden   = false;
    if (loading) loading.hidden = true;
    if (img)     img.hidden     = true;
    if (actions) actions.hidden = true;
  }

  // ── URL 복사 ──────────────────────────────────────────────────────────────

  function copyUrl() {
    if (!currentPngUrl) return;
    navigator.clipboard.writeText(currentPngUrl)
      .then(() => window.showToast?.(window.t?.('common.copied') || '복사됨', 'success'))
      .catch(() => window.showToast?.('복사 실패', 'error'));
  }

  return { init, generate, copyUrl };
})();
