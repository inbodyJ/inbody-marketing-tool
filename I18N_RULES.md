# 인바디 마케팅툴 — 언어 처리 규칙 (I18N Rules)

## 핵심 원칙
이 앱은 한국어(ko) / 영어(en) 두 언어를 완벽하게 지원한다.
어떤 기능을 추가하거나 수정할 때도 아래 규칙을 반드시 따른다.

---

## 규칙 1 — HTML에 텍스트를 절대 하드코딩하지 않는다
모든 사용자에게 보이는 텍스트는 반드시 data-i18n 속성을 사용한다.

✅ 올바른 방법:
```html
<button data-i18n="common.save">저장</button>
<input data-i18n-placeholder="assets.keywordPlaceholder" placeholder="검색...">
<span data-i18n-title="common.download" title="다운로드">⬇️</span>
```

❌ 잘못된 방법:
```html
<button>저장</button>
<input placeholder="검색...">
```

---

## 규칙 2 — JS에서 텍스트를 직접 삽입하지 않는다
innerHTML, textContent, alert(), confirm(), showToast() 등에
한국어/영어를 직접 쓰지 않는다. 반드시 t() 함수를 사용한다.

✅ 올바른 방법:
```javascript
showToast(t('toast.saved'));
confirm(t('assets.deleteConfirm'));
el.textContent = t('dashboard.title');
el.innerHTML = `<p>${t('assets.noAssets')}</p>`;
```

❌ 잘못된 방법:
```javascript
showToast("저장되었습니다 ✅");
confirm("삭제하시겠습니까?");
el.textContent = "대시보드";
```

---

## 규칙 3 — 새 텍스트 추가 시 ko/en 동시에 추가한다
i18n.js에 새 키를 추가할 때 반드시 ko와 en 둘 다 작성한다.
하나만 추가하면 한 언어에서 키 문자열 그대로 노출된다.

✅ 올바른 방법:
```javascript
ko: { newFeature: { title: "새 기능" } }
en: { newFeature: { title: "New Feature" } }
```

❌ 잘못된 방법:
```javascript
ko: { newFeature: { title: "새 기능" } }
// en 누락 → EN 전환 시 "newFeature.title" 출력됨
```

---

## 규칙 4 — 국가 표기 통일
국가는 항상 아래 i18n 키를 사용한다:

| 키 | KO | EN |
|---|---|---|
| `t('common.country_all')` | 전체 | All |
| `t('common.country_au')` | 호주 | AU |
| `t('common.country_uk')` | 영국 | UK |

❌ 금지 표기: `"AU AU"`, `"GB UK"`, `"🇦🇺 호주"`, `"🇬🇧 영국"`, 이모지 단독 사용

---

## 규칙 5 — 동적 렌더링 후 applyLang() 호출 또는 등록
새 기능에서 동적으로 DOM을 생성하는 함수가 있으면:

**방법 A: 함수 내부에서 t() 직접 사용 (권장)**
```javascript
function renderMyFeature() {
  el.innerHTML = `<p>${t('myFeature.title')}</p>`;
}
```

**방법 B: applyLang() 내부에 재실행 등록**
```javascript
// i18n.js의 applyLang() 하단에 추가
if (typeof renderMyFeature === 'function') renderMyFeature();
```

---

## 규칙 6 — 단위 표기 처리 (개/items)
숫자 단위는 아래 키를 사용한다:
```javascript
// KO: "12개" / EN: "12"
`${count}${t('common.items')}`
```

`common.items`의 값은 ko: `"개"`, en: `""` (빈 문자열)

---

## 규칙 7 — 새 페이지 추가 시 체크리스트
새 HTML 파일을 만들 때 반드시 확인:

- [ ] `<script src="/js/i18n.js">` 로드됐는지 (index.html의 스크립트 순서 확인)
- [ ] IIFE 상단에 `const _t = (key, fallback) => window.t ? window.t(key) : fallback;` 선언
- [ ] 모든 정적 텍스트에 `data-i18n` 속성 추가
- [ ] 모든 동적 innerHTML에 `t()` 함수 사용
- [ ] i18n.js의 ko/en 양쪽에 해당 페이지 번역 키 추가
- [ ] applyLang()에 동적 렌더 함수 등록 (필요시)
- [ ] KO/EN 전환 후 깨지는 텍스트 없는지 직접 확인

---

## 현재 번역 키 구조 (i18n.js)

```
common.*      — 공통 텍스트 (저장, 취소, 삭제, 국가명 등)
nav.*         — 사이드바 내비게이션 + 로딩 메시지
dashboard.*   — 대시보드 페이지
assets.*      — 에셋 라이브러리 페이지
create.*      — 에셋 생성 마법사 (wizard.js)
library.*     — 프롬프트 라이브러리 페이지
youtube.*     — 유튜브 처리 페이지
toast.*       — 모든 토스트/알림 메시지
```

---

## 파일별 _t 헬퍼 패턴

모든 페이지 IIFE 상단과 JS 모듈 상단에 아래 패턴을 사용한다:

```javascript
const _t = (key, fallback) => window.t ? window.t(key) : fallback;
```

이 패턴은 i18n.js 로드 전에 실행되더라도 안전하게 fallback 텍스트를 표시한다.
