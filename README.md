# InBody Marketing Asset Automation Tool

InBody AU/UK 마케팅 에셋 자동 생성 웹 앱입니다.
Claude AI로 카피를 작성하고, Gemini Imagen으로 이미지를 생성하며, YouTube 영상에서 Shorts 클립을 자동으로 추출합니다.

---

## 빠른 시작

### 1. 사전 요구사항

- Python 3.10 이상
- pip
- ffmpeg (YouTube Shorts 생성 시 필요)

### 2. 의존성 설치

```bash
cd inbody-marketing-tool/server
pip install -r requirements.txt
```

### 3. API 키 설정

`server/` 폴더에 `.env` 파일을 생성합니다.
`.env.example`을 복사하여 사용하세요.

```bash
cp server/.env.example server/.env
```

`.env` 파일을 열어 키를 입력합니다:

```
OPENROUTER_API_KEY=sk-or-v1-...      # 필수 (텍스트 AI)
ANTHROPIC_API_KEY=sk-ant-...          # 선택 (직접 연동 폴백)
GEMINI_API_KEY=AIzaSy...              # 선택 (이미지 생성)
CANVA_API_KEY=...                     # 선택 (Canva 폴백)
```

> OpenRouter 키만 있어도 텍스트 생성(카피, 프롬프트)은 정상 작동합니다.

### 4. Flask 서버 실행

```bash
cd server
python app.py
```

서버가 `http://localhost:5000`에서 실행됩니다.

### 5. 앱 열기

`inbody-marketing-tool/index.html`을 브라우저에서 직접 열거나,
간단한 HTTP 서버로 서빙합니다:

```bash
# Python 내장 서버 사용
cd inbody-marketing-tool
python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **에셋 생성 마법사** | 4단계로 SNS/B2B/Event/YouTube/Shorts 에셋 생성 |
| **프롬프트 라이브러리** | AI가 생성한 이미지 프롬프트를 저장·재사용 |
| **에셋 라이브러리** | 생성된 에셋 필터·검색·다운로드·삭제 |
| **YouTube 처리** | URL → 자막 추출 → 카피 생성 → Shorts 자동 편집 |
| **분석 대시보드** | 에셋 통계, 차트, 14일 추이 확인 |

---

## 페이지 구성

```
대시보드      → KPI 카드, 차트, 최근 에셋, 인기 프롬프트
에셋 생성     → 4단계 마법사 (국가/카테고리/채널 → 카피 → 이미지 → 저장)
에셋 라이브러리 → 생성된 에셋 그리드 (필터, 다운로드, 삭제, 상세 모달)
프롬프트 라이브러리 → 프롬프트 카드 (별점, 태그, 복사, 마법사 연동)
YouTube 처리  → URL 입력 → 6단계 파이프라인 → 결과 + 히스토리
```

---

## 데이터 저장

모든 데이터는 **브라우저 localStorage**에 저장됩니다.
서버나 외부 DB가 필요 없습니다.

| 키 | 내용 |
|----|------|
| `inbody_assets` | 생성된 에셋 목록 |
| `inbody_prompts` | 프롬프트 라이브러리 |
| `inbody_youtube_jobs` | YouTube 처리 작업 히스토리 |

### 데이터 초기화

대시보드 → **전체 초기화** 버튼을 사용하거나,
브라우저 개발자 도구 콘솔에서:

```javascript
localStorage.removeItem('inbody_assets');
localStorage.removeItem('inbody_prompts');
localStorage.removeItem('inbody_youtube_jobs');
location.reload();
```

### 백업 / 복원

- **내보내기**: 대시보드 → "전체 내보내기 (JSON)" 버튼
- **가져오기**: 대시보드 → "가져오기" 버튼으로 JSON 파일 선택

---

## 드롭다운 항목 추가

### 카테고리 추가

`pages/create.html`에서 `<select id="category">` 안에 `<option>`을 추가합니다:

```html
<option value="webinar">Webinar</option>
```

동시에 `pages/assets.html`과 `pages/library.html`의 카테고리 필터 드롭다운에도 동일하게 추가합니다.

### 국가 추가

`pages/create.html`에서 국가 칩을 추가합니다:

```html
<button class="chip" data-value="SG">🇸🇬 SG</button>
```

`pages/assets.html`의 `#filter-country` 칩 그룹에도 동일하게 추가합니다.

---

## 파일 구조

```
inbody-marketing-tool/
├── index.html              # SPA 쉘 (사이드바 + 라우터)
├── script.js               # 라우터, 토스트, 유틸리티
├── style.css               # 전역 스타일 (InBody 브랜드 변수)
├── css/
│   └── components.css      # 컴포넌트 스타일
├── js/
│   ├── storage.js          # localStorage CRUD
│   ├── api.js              # Flask API 호출 래퍼
│   ├── wizard.js           # 4단계 에셋 생성 마법사
│   ├── youtube.js          # YouTube 파이프라인
│   └── dashboard.js        # 대시보드 통계 (레거시)
├── pages/
│   ├── dashboard.html      # 분석 대시보드
│   ├── create.html         # 에셋 생성 마법사
│   ├── assets.html         # 에셋 라이브러리
│   ├── library.html        # 프롬프트 라이브러리
│   └── youtube.html        # YouTube 처리
├── server/
│   ├── app.py              # Flask API 서버
│   ├── requirements.txt    # Python 의존성
│   └── .env.example        # 환경변수 예시
└── README.md
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 서버 상태 + 연결된 API 확인 |
| POST | `/api/generate-prompt` | 이미지 프롬프트 생성 (Claude) |
| POST | `/api/generate-copy` | 마케팅 카피 생성 (Claude) |
| POST | `/api/generate-image` | 이미지 생성 (Gemini Imagen 3) |
| POST | `/api/youtube/extract` | YouTube 자막 추출 + 분석 |
| POST | `/api/youtube/generate-shorts` | Shorts 영상 자동 편집 |

---

## 문제 해결

**서버가 연결 안 됨 (빨간 점)**
- `python app.py`가 실행 중인지 확인
- `.env`에 `OPENROUTER_API_KEY`가 입력되어 있는지 확인
- 포트 5000이 다른 프로세스에 의해 점유된 경우: `.env`에서 `PORT=5001`로 변경 후 `js/api.js`의 `BASE_URL`도 수정

**이미지가 생성되지 않음**
- `GEMINI_API_KEY`가 필요합니다
- 키 없이도 프롬프트와 카피는 정상 생성됩니다

**YouTube 처리 실패**
- `yt-dlp`와 `ffmpeg`가 설치되어 있는지 확인
- 일부 YouTube 영상은 자막이 없어 추출이 불가할 수 있습니다
