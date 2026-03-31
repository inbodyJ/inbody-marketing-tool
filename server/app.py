"""
app.py — InBody Marketing Tool Flask API Server

텍스트: OpenRouter (meta-llama/llama-3.1-8b-instruct:free)
이미지: Pollinations.ai (API 키 불필요)
영상:   yt-dlp (API 키 불필요)
"""

import os
import re
import json
import base64
import hashlib
import logging
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, urlencode

import requests as req
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from flask import Flask, request, jsonify, send_file, redirect
from flask_cors import CORS
from dotenv import load_dotenv

# ─── 경로 설정 ────────────────────────────────────────────────────────────────
SERVER_DIR  = Path(__file__).resolve().parent   # .../server/
PROJECT_DIR = SERVER_DIR.parent                  # .../inbody-marketing-tool/
TEMP_DIR    = SERVER_DIR / "temp"
TEMP_DIR.mkdir(exist_ok=True)

# .env 자동 생성
_env_file    = SERVER_DIR / ".env"
_env_example = SERVER_DIR / ".env.example"
if not _env_file.exists() and _env_example.exists():
    shutil.copy(_env_example, _env_file)

load_dotenv(_env_file)

# ─── 로깅 ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ─── API 설정 ─────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY",  "")
CANVA_CLIENT_ID     = os.getenv("CANVA_CLIENT_ID",     "")
CANVA_CLIENT_SECRET = os.getenv("CANVA_CLIENT_SECRET", "")
CANVA_REDIRECT_URI  = os.getenv("CANVA_REDIRECT_URI",  "http://127.0.0.1:5000/api/canva/callback")
OR_URL             = "https://openrouter.ai/api/v1/chat/completions"
OR_MODEL           = "google/gemma-3-27b-it:free"
# 429/500 시 순서대로 폴백할 무료 모델 목록
OR_FREE_MODELS = [
    "google/gemma-3-27b-it:free",
    "google/gemma-3-12b-it:free",
    "google/gemma-3-4b-it:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "liquid/lfm-2.5-1.2b-instruct:free",
]
OR_HEADERS         = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    "HTTP-Referer":  "http://localhost:5000",
    "X-Title":       "InBody Marketing Tool",
    "Content-Type":  "application/json",
}

# ─── Flask 앱 ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)


# ── 정적 파일 서빙 ─────────────────────────────────────────────────────────
@app.route("/")
def serve_index():
    return send_file(PROJECT_DIR / "index.html")

@app.route("/favicon.ico")
def favicon():
    return "", 204  # No Content — 404 로그 억제

@app.route("/assets/templates/<filename>")
def serve_template_asset(filename):
    """server/assets/templates/ 폴더를 /assets/templates/ URL로 서빙"""
    safe = Path(filename).name
    path = SERVER_DIR / "assets" / "templates" / safe
    if not path.exists() or not path.is_file():
        return jsonify({"error": "템플릿 파일 없음"}), 404
    return send_file(str(path))

@app.route("/<path:filename>")
def serve_static(filename):
    # /assets/ 로 시작하는 경로는 server/ 폴더도 탐색
    if filename.startswith("assets/"):
        srv_target = SERVER_DIR / filename
        if srv_target.exists() and srv_target.is_file():
            return send_file(str(srv_target))
    target = PROJECT_DIR / filename
    if not target.exists() or not target.is_file():
        return jsonify({"error": "파일을 찾을 수 없습니다.", "path": filename}), 404
    return send_file(str(target))


# ══════════════════════════════════════════════════════════════════════════════
# 공통 헬퍼
# ══════════════════════════════════════════════════════════════════════════════

def call_openrouter(system_prompt: str, user_content: str, max_tokens: int = 1000) -> str:
    """OpenRouter 무료 모델 호출 — 429/오류 시 다음 모델로 자동 폴백"""
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY가 설정되지 않았습니다.")

    last_error = None
    for model in OR_FREE_MODELS:
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_content},
            ],
        }
        try:
            resp = req.post(OR_URL, headers=OR_HEADERS, json=body, timeout=30)
            if resp.status_code in (400, 429, 500, 503):
                try:
                    err_body = resp.json()
                    err_msg  = err_body.get("error", {}).get("message", "") if isinstance(err_body.get("error"), dict) else str(err_body.get("error",""))
                except Exception:
                    err_msg = resp.text[:200]
                logger.warning(f"OpenRouter {model} → HTTP {resp.status_code}: {err_msg}, 다음 모델 시도...")
                last_error = f"HTTP {resp.status_code} ({err_msg}) from {model}"
                continue
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()
            if model != OR_MODEL:
                logger.info(f"폴백 모델 사용: {model}")
            return content
        except req.exceptions.Timeout:
            logger.warning(f"OpenRouter {model} 타임아웃, 다음 모델 시도...")
            last_error = f"timeout from {model}"
            continue

    raise RuntimeError(f"모든 무료 모델 실패. 마지막 오류: {last_error}")


def parse_json_safe(text: str) -> dict:
    """LLM 응답에서 JSON 파싱 — 마크다운 펜스 제거 후 추출"""
    s = text.strip()
    # ```json ... ``` 또는 ``` ... ``` 제거
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$",       "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        # 중괄호 블록만 추출 시도
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            return json.loads(m.group())
        raise ValueError(f"JSON 파싱 실패: {text[:300]}")


def size_preset_to_dimensions(preset: str) -> tuple[int, int]:
    """sizePreset 문자열 → (width, height)"""
    preset = (preset or "").lower()
    mapping = {
        "1:1":          (1080, 1080),
        "인스타그램 피드":    (1080, 1080),
        "instagram feed": (1080, 1080),
        "9:16":         (1080, 1920),
        "스토리":         (1080, 1920),
        "story":        (1080, 1920),
        "shorts":       (1080, 1920),
        "쇼츠":          (1080, 1920),
        "youtube":      (1280,  720),
        "유튜브 썸네일":    (1280,  720),
        "16:9":         (1280,  720),
        "배너":          (1200,  628),
        "banner":       (1200,  628),
        "linkedin":     (1200,  900),
        "a4":           (1200,  900),
    }
    for key, dims in mapping.items():
        if key in preset:
            return dims
    return (1024, 1024)


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/health — 서비스 연결 상태
# ══════════════════════════════════════════════════════════════════════════════

def _ytdlp_cmd() -> list[str]:
    """yt-dlp 실행 명령 — PATH에 없으면 python -m yt_dlp 사용"""
    import shutil, sys
    if shutil.which("yt-dlp"):
        return ["yt-dlp"]
    return [sys.executable, "-m", "yt_dlp"]


_ytdlp_available: bool | None = None   # 캐시 (최초 1회만 확인)

def _check_ytdlp() -> bool:
    global _ytdlp_available
    if _ytdlp_available is not None:
        return _ytdlp_available
    try:
        import yt_dlp as _chk  # noqa: F401
        _ytdlp_available = True
    except ImportError:
        _ytdlp_available = False
    return _ytdlp_available


@app.route("/api/health", methods=["GET"])
def health():
    ytdlp_ok = _check_ytdlp()

    if not ytdlp_ok:
        logger.warning("yt-dlp가 설치되어 있지 않습니다. 설치: pip install yt-dlp")

    return jsonify({
        "status": "ok",
        "services": {
            "openrouter":     bool(OPENROUTER_API_KEY),
            "pollinations":   True,   # API 키 불필요
            "ytdlp":          ytdlp_ok,
        },
        "model":          OR_MODEL if OPENROUTER_API_KEY else None,
        "text_backend":   "openrouter" if OPENROUTER_API_KEY else "none",
        "image_backend":  "pollinations",
        # 하위 호환 필드
        "keys": {
            "anthropic":  False,
            "openrouter": bool(OPENROUTER_API_KEY),
            "gemini":     False,
            "canva":      False,
        },
    })


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/generate-prompt — 이미지 프롬프트 생성
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT_PLANNER = (
    "You are a creative director for InBody, a body composition analysis brand. "
    "Brand colors: #E8001D (red), #1A1A2E (navy). "
    "Australia: outdoor settings, multicultural models, informal tone, Australian English spelling. "
    "UK: indoor premium fitness, sophisticated tone, British English spelling. "
    "Return ONLY this JSON, no other text:\n"
    '{"imagePrompt":"detailed english image generation prompt",'
    '"negativePrompt":"what to avoid",'
    '"canvaKeywords":["keyword1","keyword2"],'
    '"rationale":"한국어로 디자인 선택 이유 설명"}'
)


@app.route("/api/generate-prompt", methods=["POST"])
def generate_prompt():
    try:
        d = request.get_json(force=True) or {}
        # 파라미터 별칭 수용
        product  = d.get("product") or d.get("productName") or "InBody"
        keywords = d.get("conceptKeywords") or d.get("keyMessage") or d.get("message") or ""
        tone     = d.get("tone") or d.get("style") or "professional"

        user_msg = (
            f"카테고리: {d.get('category', 'sns')}\n"
            f"국가: {d.get('country', 'KR')}\n"
            f"채널: {d.get('channel', 'instagram')}\n"
            f"컨셉 키워드: {keywords}\n"
            f"톤: {tone}\n"
            f"제품: {product}\n"
            f"사이즈 프리셋: {d.get('sizePreset', '1:1')}\n\n"
            "위 조건에 맞는 마케팅 이미지 프롬프트를 JSON으로 생성해주세요."
        )

        raw    = call_openrouter(SYSTEM_PROMPT_PLANNER, user_msg, max_tokens=800)
        result = parse_json_safe(raw)
        return jsonify({"success": True, **result})

    except Exception as e:
        logger.error(f"generate-prompt error: {e}")
        return jsonify({"success": False, "error": "프롬프트 생성 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/generate-copy — 마케팅 카피 생성
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT_COPY = (
    "You are a marketing copywriter for InBody, a global body composition analysis brand. "
    "Brand tone: scientific, trustworthy, empowering. "
    "Return ONLY valid JSON, no markdown, no explanation:\n"
    '{"headline":"strong headline under 20 chars",'
    '"subCopy":"supporting copy under 40 chars",'
    '"ctaText":"CTA button text",'
    '"hashtags":["#tag1","#tag2","#tag3"]}'
)

_LANG_RULE = {
    "KR": "Write ALL copy in Korean language.",
    "AU": "Write in Australian English (colour, centre, organise).",
    "UK": "Write in British English (colour, optimise, behaviour).",
}


@app.route("/api/generate-copy", methods=["POST"])
def generate_copy():
    try:
        d        = request.get_json(force=True) or {}
        country  = d.get("country", "KR")
        # 파라미터 별칭 수용 (wizard.js 전송 키 다양성 대응)
        product  = d.get("product") or d.get("productName") or "InBody"
        keywords = d.get("conceptKeywords") or d.get("keyMessage") or d.get("message") or ""
        tone     = d.get("tone") or d.get("style") or "professional"
        lang_rule = _LANG_RULE.get(country, "Write in Korean.")

        system_prompt = SYSTEM_PROMPT_COPY + f"\n{lang_rule}"
        user_msg = (
            f"Category: {d.get('category', 'sns')}\n"
            f"Channel:  {d.get('channel', 'instagram')}\n"
            f"Country:  {country}\n"
            f"Product:  {product}\n"
            f"Key message: {keywords}\n"
            f"Style: {tone}\n"
            "Generate compelling marketing copy."
        )

        raw    = call_openrouter(system_prompt, user_msg, max_tokens=400)
        result = parse_json_safe(raw)
        return jsonify({"success": True, **result})

    except Exception as e:
        logger.error(f"generate-copy error: {e}")
        return jsonify({"success": False, "error": "카피 생성 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/generate-image — Pollinations.ai 이미지 생성
# ══════════════════════════════════════════════════════════════════════════════

def _pollinations_image(prompt: str, width: int, height: int) -> str:
    """Pollinations.ai → base64 data URI 반환 (재시도 1회 포함)"""
    url = f"https://image.pollinations.ai/prompt/{quote(prompt)}"
    params = {
        "width":  width,
        "height": height,
        "nologo": "true",
    }
    import time
    for attempt in range(3):
        resp = req.get(url, params=params, timeout=90)
        ct = resp.headers.get("Content-Type", "")
        if resp.status_code == 200 and ct.startswith("image"):
            break
        wait = 5 if resp.status_code == 429 else 3
        if attempt < 2:
            logger.warning(f"Pollinations HTTP {resp.status_code}, {wait}초 후 재시도 {attempt+2}/3...")
            time.sleep(wait)
    if not (resp.status_code == 200 and resp.headers.get("Content-Type","").startswith("image")):
        resp.raise_for_status()

    ct   = resp.headers.get("Content-Type", "image/jpeg")
    mime = ct.split(";")[0].strip() if ct else "image/jpeg"
    b64  = base64.b64encode(resp.content).decode("utf-8")
    return f"data:{mime};base64,{b64}"


@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    try:
        d            = request.get_json(force=True) or {}
        # 파라미터 별칭 수용 ('prompt' 또는 'imagePrompt')
        image_prompt = (d.get("imagePrompt") or d.get("prompt") or "").strip()
        neg_prompt   = d.get("negativePrompt", "")
        size_preset  = d.get("sizePreset", d.get("aspectRatio", "1:1"))

        if not image_prompt:
            return jsonify({"success": False, "error": "imagePrompt가 필요합니다."}), 400

        # 네거티브 프롬프트 결합
        full_prompt = image_prompt
        if neg_prompt:
            full_prompt += f". Avoid: {neg_prompt}"

        width, height = size_preset_to_dimensions(size_preset)
        image_url     = _pollinations_image(full_prompt, width, height)

        return jsonify({
            "success":  True,
            "imageUrl": image_url,
            "backend":  "pollinations",
            "width":    width,
            "height":   height,
        })

    except req.exceptions.Timeout:
        return jsonify({"success": False, "error": "이미지 생성 시간이 초과되었습니다. (60초)", "detail": "timeout"}), 500
    except Exception as e:
        logger.error(f"generate-image error: {e}")
        return jsonify({"success": False, "error": "이미지 생성 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/youtube/extract — yt-dlp 자막 추출 + OpenRouter 분석
# ══════════════════════════════════════════════════════════════════════════════

def _clean_srt(srt_text: str) -> str:
    """SRT 파일에서 순수 텍스트만 추출 (번호·타임스탬프·HTML 태그 제거)"""
    lines   = srt_text.splitlines()
    result  = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if re.match(r"^\d+$", line):                                  # 자막 번호
            continue
        if re.match(r"\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*", line): # 타임스탬프
            continue
        line = re.sub(r"<[^>]+>", "", line)                           # HTML 태그
        if line:
            result.append(line)

    # 연속 중복 제거
    deduped = []
    for line in result:
        if not deduped or deduped[-1] != line:
            deduped.append(line)
    return " ".join(deduped)


def _parse_json3_caption(data: dict) -> str:
    """YouTube json3 자막 포맷 → 순수 텍스트"""
    lines = []
    for event in data.get('events', []):
        text = ''.join(s.get('utf8', '') for s in event.get('segs', [])).strip()
        if text and text != '\n':
            lines.append(text)
    deduped = []
    for line in lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)
    return ' '.join(deduped)


COOKIES_FILE = SERVER_DIR / "cookies.txt"

_COOKIES_REQUIRED_MSG = (
    "YouTube IP 차단으로 자막을 가져올 수 없습니다.\n"
    "해결 방법: Chrome/Edge 브라우저에서 'Get cookies.txt LOCALLY' 확장을 설치하고,\n"
    "youtube.com에서 쿠키를 내보낸 후 server/cookies.txt 로 저장하세요."
)


def _video_id_from_url(url: str) -> str:
    m = re.search(r'(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else ''


def _extract_transcript_api(video_id: str) -> str:
    """youtube-transcript-api로 자막 추출 (ko → en 우선순위)"""
    kwargs = {}
    if COOKIES_FILE.exists():
        kwargs['cookies'] = str(COOKIES_FILE)
    api = YouTubeTranscriptApi(**kwargs)
    for lang in ['ko', 'en']:
        try:
            snippets = api.fetch(video_id, languages=[lang])
            text = ' '.join(s.text for s in snippets).strip()
            if text:
                logger.info(f"youtube-transcript-api 성공: {lang} ({len(text)}자)")
                return text
        except NoTranscriptFound:
            continue
    return ''


def _extract_subtitle_via_ytdlp(url: str):
    """yt-dlp로 자막 파일을 임시 디렉토리에 다운로드 → (transcript, title, video_id) 반환
    server/cookies.txt 가 있으면 자동으로 사용 (YouTube IP 차단 우회)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        ydl_opts = {
            'writeautomaticsub': True,
            'writesubtitles':    True,
            'subtitleslangs':    ['ko', 'en'],
            'subtitlesformat':   'json3/srt/vtt',
            'skip_download':     True,
            'quiet':             True,
            'outtmpl':           str(Path(tmpdir) / '%(id)s'),
            'noplaylist':        True,
        }
        if COOKIES_FILE.exists():
            ydl_opts['cookiefile'] = str(COOKIES_FILE)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        title    = info.get('title', '')
        video_id = info.get('id', '')

        sub_dir = Path(tmpdir)
        for lang in ['ko', 'en']:
            for ext in ['json3', 'srt', 'vtt']:
                files = list(sub_dir.glob(f'*.{lang}.{ext}'))
                if not files:
                    continue
                try:
                    content = files[0].read_text(encoding='utf-8')
                    transcript = (_parse_json3_caption(json.loads(content))
                                  if ext == 'json3' else _clean_srt(content))
                    if transcript.strip():
                        logger.info(f"yt-dlp 자막 성공: {lang}/{ext} ({len(transcript)}자)")
                        return transcript, title, video_id
                except Exception as parse_err:
                    logger.warning(f"자막 파싱 실패 ({lang}/{ext}): {parse_err}")

        return '', title, video_id


def _extract_subtitle_via_download(url: str):
    """자막 추출 통합 함수: youtube-transcript-api → yt-dlp 순으로 시도"""
    video_id = _video_id_from_url(url)

    # 1차: youtube-transcript-api
    if video_id:
        try:
            transcript = _extract_transcript_api(video_id)
            if transcript:
                # yt-dlp로 제목/video_id만 따로 가져옴
                try:
                    with yt_dlp.YoutubeDL({'quiet': True, 'skip_download': True}) as ydl:
                        info = ydl.extract_info(url, download=False)
                    return transcript, info.get('title', ''), video_id
                except Exception:
                    return transcript, '', video_id
        except (TranscriptsDisabled, Exception) as e:
            logger.warning(f"youtube-transcript-api 실패: {e}")

    # 2차: yt-dlp 파일 다운로드
    try:
        return _extract_subtitle_via_ytdlp(url)
    except yt_dlp.utils.DownloadError as e:
        err_str = str(e)
        if '429' in err_str or 'Too Many Requests' in err_str or 'IpBlocked' in err_str:
            raise RuntimeError(_COOKIES_REQUIRED_MSG)
        raise RuntimeError(err_str)
    except Exception as e:
        if '429' in str(e) or 'IpBlocked' in str(e):
            raise RuntimeError(_COOKIES_REQUIRED_MSG)
        raise


SYSTEM_PROMPT_YOUTUBE = (
    "You are a video content analyst for InBody marketing team. "
    "Analyze the YouTube transcript and return ONLY this JSON, no other text:\n"
    '{"summary":"영상 핵심 요약 (한국어 3문장)",'
    '"timestamps":[{"start":0,"end":60,"description":"구간 설명"},'
    '{"start":120,"end":180,"description":"구간 설명"},'
    '{"start":240,"end":300,"description":"구간 설명"}],'
    '"mainTopic":"핵심 키워드"}'
)


@app.route("/api/youtube/extract", methods=["POST"])
def youtube_extract():
    try:
        d   = request.get_json(force=True) or {}
        url = d.get("url", "").strip()
        if not url:
            return jsonify({"error": "url이 필요합니다."}), 400

        # ── yt-dlp: 자막 파일 임시 다운로드 (영상 다운로드 없음) ──
        transcript, title, video_id = _extract_subtitle_via_download(url)

        if not transcript.strip():
            raise RuntimeError("자막 파일을 찾을 수 없습니다. 자막이 없는 영상일 수 있습니다.")

        # ── OpenRouter: 자막 분석 ─────────────────────────────────────────
        user_msg = (
            f"영상 제목: {title}\n\n"
            f"자막 (최대 5000자):\n{transcript[:5000]}\n\n"
            "위 영상을 분석해서 JSON으로 반환해주세요."
        )
        raw      = call_openrouter(SYSTEM_PROMPT_YOUTUBE, user_msg, max_tokens=600)
        analysis = parse_json_safe(raw)

        return jsonify({
            "title":      title,
            "videoId":    video_id,
            "transcript": transcript[:2000],
            **analysis,
        })

    except Exception as e:
        logger.error(f"youtube/extract error: {e}")
        return jsonify({"error": "유튜브 자막 추출 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/youtube/generate-shorts — yt-dlp + ffmpeg Shorts 편집
# ══════════════════════════════════════════════════════════════════════════════

def _ts_to_seconds(ts) -> float:
    ts = str(ts).strip()
    parts = ts.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(ts)
    except ValueError:
        return 0.0


@app.route("/api/youtube/generate-shorts", methods=["POST"])
def youtube_generate_shorts():
    shorts_dir = TEMP_DIR / "shorts"
    shorts_dir.mkdir(exist_ok=True)

    try:
        d          = request.get_json(force=True) or {}
        url        = d.get("url", "").strip()
        timestamps = d.get("timestamps", [])

        if not url:
            return jsonify({"error": "url이 필요합니다."}), 400
        if not timestamps:
            return jsonify({"error": "timestamps가 필요합니다."}), 400

        # ── 원본 영상 다운로드 ─────────────────────────────────────────────
        raw_path = str(shorts_dir / "source.%(ext)s")
        dl_cmd = _ytdlp_cmd() + [
            "--format",               "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",
            "--merge-output-format",  "mp4",
            "--output",               raw_path,
            url,
        ]
        try:
            dl_proc = subprocess.run(dl_cmd, capture_output=True, text=True, timeout=300)
        except FileNotFoundError:
            return jsonify({"error": "yt-dlp가 설치되어 있지 않습니다.", "detail": "pip install yt-dlp"}), 500

        if dl_proc.returncode != 0:
            raise RuntimeError(dl_proc.stderr.strip() or "영상 다운로드 실패")

        source_files = list(shorts_dir.glob("source.*"))
        if not source_files:
            raise RuntimeError("다운로드된 영상 파일을 찾을 수 없습니다.")
        source_file = str(source_files[0])

        # ── ffmpeg: 구간별 9:16 클리핑 ─────────────────────────────────────
        shorts_result = []
        for idx, ts in enumerate(timestamps):
            start    = _ts_to_seconds(ts.get("start", 0))
            end      = _ts_to_seconds(ts.get("end",   60))
            duration = end - start
            if duration <= 0:
                continue

            desc     = ts.get("description", f"Shorts {idx + 1}")
            out_path = str(shorts_dir / f"shorts_{idx + 1}.mp4")
            safe_desc = desc.replace("'", "\\'").replace(":", "\\:")[:60]

            ff_cmd = [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i",  source_file,
                "-t",  str(duration),
                "-vf", (
                    "crop=ih*9/16:ih,"
                    "scale=1080:1920,"
                    f"drawtext=text='{safe_desc}':"
                    "fontsize=48:fontcolor=white:"
                    "borderw=3:bordercolor=0xE8001D:"
                    "x=(w-text_w)/2:y=h-th-80:"
                    "box=1:boxcolor=0x1A1A2E@0.65:boxborderw=12"
                ),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac",     "-b:a",    "128k",
                "-movflags", "+faststart",
                out_path,
            ]
            ff_proc = subprocess.run(ff_cmd, capture_output=True, text=True, timeout=180)
            if ff_proc.returncode != 0:
                logger.error(f"ffmpeg shorts {idx+1}: {ff_proc.stderr[-400:]}")
                continue

            file_size = Path(out_path).stat().st_size if Path(out_path).exists() else 0
            shorts_result.append({
                "index":       idx + 1,
                "filePath":    out_path,
                "duration":    round(duration, 2),
                "description": desc,
                "fileSize":    file_size,
            })

        if not shorts_result:
            raise RuntimeError("생성된 Shorts 파일이 없습니다. ffmpeg가 설치되어 있는지 확인하세요.")

        return jsonify({"shorts": shorts_result})

    except subprocess.TimeoutExpired:
        return jsonify({"error": "영상 처리 시간이 초과되었습니다.", "detail": "timeout"}), 500
    except Exception as e:
        logger.error(f"youtube/generate-shorts error: {e}")
        return jsonify({"error": "Shorts 생성 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# 하위 호환 별칭
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/claude/copy",    methods=["POST"])
def _compat_copy():    return generate_copy()

@app.route("/api/claude/prompt",  methods=["POST"])
def _compat_prompt():  return generate_prompt()

@app.route("/api/claude/analyze", methods=["POST"])
def _compat_analyze(): return youtube_extract()

@app.route("/api/gemini/image",   methods=["POST"])
def _compat_image():   return generate_image()


# ══════════════════════════════════════════════════════════════════════════════
# 에러 핸들러
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/youtube/thumbnail-prompt", methods=["POST"])
def youtube_thumbnail_prompt():
    try:
        d           = request.get_json(force=True) or {}
        video_title = d.get("videoTitle", "")
        topic       = d.get("topic",      "")
        main_text   = d.get("mainText",   "")
        sub_text    = d.get("subText",    "")
        style       = d.get("style",      "clean")

        style_map = {
            "clickbait":    "bold, dramatic, high contrast, attention-grabbing, vivid colors",
            "clean":        "clean, minimal, professional, easy to read, white background",
            "emotional":    "warm, empathetic, human faces, relatable, lifestyle",
            "professional": "trustworthy, medical, scientific, credible, clinical",
        }
        style_desc = style_map.get(style, "clean and professional")

        system_prompt = (
            "You are a YouTube thumbnail image prompt designer for InBody — a body composition analysis brand.\n"
            "Brand colors: deep red #971B2F and dark navy #101820.\n"
            "Return ONLY valid JSON with exactly two keys:\n"
            '{"imagePrompt":"<detailed English prompt for a 1280×720 YouTube thumbnail>","negativePrompt":"<elements to avoid>"}'
        )
        user_prompt = (
            f"Create a YouTube thumbnail image prompt.\n"
            f"Video title: {video_title}\n"
            f"Topic: {topic}\n"
            f"Main overlay text concept: {main_text}\n"
            f"Sub text concept: {sub_text}\n"
            f"Style: {style_desc}\n"
            f"Requirements: 16:9 ratio, InBody brand colors (#971B2F red / #101820 navy), "
            f"no embedded text or letters in the image itself, photorealistic or high-quality illustration."
        )

        raw = call_openrouter(system_prompt, user_prompt, max_tokens=500)
        # JSON 블록 추출
        raw = re.sub(r"```(?:json)?", "", raw).strip()
        result = json.loads(raw)

        return jsonify({
            "success":       True,
            "imagePrompt":   result.get("imagePrompt",   ""),
            "negativePrompt":result.get("negativePrompt",""),
        })
    except Exception as e:
        logger.error(f"youtube_thumbnail_prompt error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# 블로그 글 생성
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/generate-blog", methods=["POST"])
def generate_blog():
    try:
        d           = request.get_json(force=True) or {}
        country     = d.get("country",     "KR")
        message     = d.get("message",     "")
        product     = d.get("product",     "InBody")
        length      = d.get("length",      "medium")
        tone        = d.get("tone",        "info")
        seo         = d.get("seoKeywords", "")
        cta         = d.get("cta",         "")

        length_map = {
            "short":  "500자 내외",
            "medium": "1000자 내외",
            "long":   "1500자 내외",
        }
        tone_map = {
            "info":   "정보를 명확하고 쉽게 전달하는 정보 전달형",
            "story":  "독자의 공감을 이끌어내는 스토리텔링형",
            "expert": "전문 지식을 바탕으로 신뢰감을 주는 전문가형",
        }
        lang_map = {
            "KR": "한국어로 작성",
            "AU": "Write in Australian English",
            "UK": "Write in British English",
        }

        system_prompt = (
            "당신은 인바디(InBody) 브랜드의 전문 콘텐츠 마케터입니다.\n"
            "인바디는 체성분 분석 기기 글로벌 선도 기업입니다.\n"
            f"{lang_map.get(country, '한국어로 작성')}.\n"
            f"글 톤: {tone_map.get(tone, '정보 전달형')}\n"
            f"글 길이: {length_map.get(length, '1000자 내외')}\n\n"
            "반드시 아래 JSON만 반환하세요 (마크다운 코드블록 없이):\n"
            '{"title":"블로그 제목","body":"블로그 본문 (소제목 포함, 단락 구분)","seoKeywords":"SEO 키워드 3-5개 (쉼표 구분)","cta":"CTA 문구","tags":"#태그1 #태그2 #태그3 ... (네이버 블로그 태그 5-10개, #으로 시작)"}'
        )
        user_prompt = (
            f"제품: {product}\n"
            f"주제/핵심 메시지: {message}\n"
            f"SEO 키워드: {seo or '자동 생성'}\n"
            f"CTA: {cta or '자동 생성'}\n"
            "위 내용으로 인바디 브랜드 블로그 글을 작성해주세요."
        )

        raw    = call_openrouter(system_prompt, user_prompt, max_tokens=2000)
        raw    = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        result = parse_json_safe(raw)

        return jsonify({
            "success":     True,
            "title":       result.get("title",       ""),
            "body":        result.get("body",        ""),
            "seoKeywords": result.get("seoKeywords", ""),
            "cta":         result.get("cta",         ""),
            "tags":        result.get("tags",        ""),
        })

    except Exception as e:
        logger.error(f"generate_blog error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Canva OAuth 2.0 (PKCE)
# ══════════════════════════════════════════════════════════════════════════════

# state → {code_verifier} 임시 저장소 (단일 프로세스용 인메모리)
_canva_oauth_states: dict = {}

# 토큰 파일 경로 (서버 재시작 후에도 유지)
_CANVA_TOKEN_FILE = SERVER_DIR / ".canva_token.json"

def _load_canva_token() -> dict:
    try:
        if _CANVA_TOKEN_FILE.exists():
            return json.loads(_CANVA_TOKEN_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}

def _save_canva_token(data: dict):
    try:
        _CANVA_TOKEN_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning(f"토큰 파일 저장 실패: {e}")

# 발급된 토큰 저장소 — 시작 시 파일에서 복원
_canva_token: dict = _load_canva_token()

CANVA_AUTH_URL  = "https://www.canva.com/api/oauth/authorize"
CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token"
CANVA_API_BASE  = "https://api.canva.com/rest/v1"
CANVA_SCOPES    = "design:content:read design:content:write design:meta:read profile:read brandtemplate:meta:read brandtemplate:content:read"


@app.route("/api/canva/auth", methods=["GET"])
def canva_auth():
    """Canva OAuth 2.0 PKCE 인증 시작 — authUrl 반환"""
    if not CANVA_CLIENT_ID:
        return jsonify({"error": "CANVA_CLIENT_ID가 설정되지 않았습니다. server/.env를 확인하세요."}), 500

    # PKCE: code_verifier / code_challenge 생성
    code_verifier  = secrets.token_urlsafe(64)[:128]
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()

    state = secrets.token_urlsafe(32)
    _canva_oauth_states[state] = {"code_verifier": code_verifier}

    auth_url = CANVA_AUTH_URL + "?" + urlencode({
        "client_id":             CANVA_CLIENT_ID,
        "redirect_uri":          CANVA_REDIRECT_URI,
        "response_type":         "code",
        "scope":                 CANVA_SCOPES,
        "code_challenge":        code_challenge,
        "code_challenge_method": "S256",
        "state":                 state,
    })

    logger.info(f"Canva OAuth 시작: state={state[:8]}…")

    # ?json=1 이면 API 응답 (프론트엔드 팝업용), 아니면 브라우저 직접 리다이렉트
    if request.args.get("json"):
        return jsonify({"authUrl": auth_url, "state": state})
    return redirect(auth_url, code=302)


@app.route("/api/canva/callback", methods=["GET"])
def canva_callback():
    """Canva OAuth 2.0 콜백 — 코드를 액세스 토큰으로 교환"""

    def _html(title, body_html):
        return (
            f"<!DOCTYPE html><html><head><meta charset='UTF-8'>"
            f"<title>{title}</title>"
            f"<style>body{{font-family:sans-serif;padding:2rem;max-width:480px;margin:auto}}"
            f"a{{color:#971B2F}}</style></head>"
            f"<body>{body_html}</body></html>"
        )

    # ── Canva가 오류를 반환한 경우 ──────────────────────────────────────────
    error = request.args.get("error")
    if error:
        desc = request.args.get("error_description", error)
        logger.warning(f"Canva OAuth 오류: {desc}")
        retry_url = "/api/canva/auth"
        return _html("인증 오류", (
            f"<h2>⚠️ Canva 인증 오류</h2>"
            f"<p>{desc}</p>"
            f"<p><a href='{retry_url}'>🔄 다시 인증하기</a></p>"
        )), 400

    # ── state 검증 ──────────────────────────────────────────────────────────
    code  = request.args.get("code",  "")
    state = request.args.get("state", "")

    stored = _canva_oauth_states.pop(state, None)
    if not stored:
        logger.warning(f"Canva callback: state 없음 (만료 또는 서버 재시작) state={state[:8]}…")
        return _html("인증 만료", (
            "<h2>⚠️ 인증 세션 만료</h2>"
            "<p>서버가 재시작되었거나 인증 시간이 초과됐습니다.</p>"
            "<p><a href='/api/canva/auth'>🔄 처음부터 다시 인증하기</a></p>"
        )), 400

    # ── 코드 → 액세스 토큰 교환 ────────────────────────────────────────────
    token_resp = req.post(
        CANVA_TOKEN_URL,
        data={
            "grant_type":    "authorization_code",
            "client_id":     CANVA_CLIENT_ID,
            "client_secret": CANVA_CLIENT_SECRET,
            "code":          code,
            "code_verifier": stored["code_verifier"],
            "redirect_uri":  CANVA_REDIRECT_URI,
        },
        timeout=15,
    )

    if not token_resp.ok:
        logger.error(f"Canva 토큰 교환 실패: {token_resp.status_code} {token_resp.text[:200]}")
        return _html("토큰 오류", (
            f"<h2>⚠️ 토큰 발급 실패</h2>"
            f"<p>{token_resp.status_code}: {token_resp.text[:200]}</p>"
            f"<p><a href='/api/canva/auth'>🔄 다시 인증하기</a></p>"
        )), 500

    token_data    = token_resp.json()
    access_token  = token_data.get("access_token",  "")
    refresh_token = token_data.get("refresh_token", "")
    expires_in    = token_data.get("expires_in",    3600)

    logger.info(f"Canva OAuth 완료: 액세스 토큰 발급 (expires_in={expires_in}s)")

    # 서버 메모리 + 파일에 토큰 저장 (재시작 후에도 유지)
    _canva_token.clear()
    _canva_token.update({
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "expires_in":    expires_in,
    })
    _save_canva_token(dict(_canva_token))

    # ── 성공: 팝업이면 부모에 토큰 전달, 일반 탭이면 SPA로 리다이렉트 ──────
    payload = json.dumps({
        "accessToken":  access_token,
        "refreshToken": refresh_token,
        "expiresIn":    expires_in,
    })
    return _html("Canva 인증 완료", (
        f"<h2>✅ Canva 인증 완료</h2>"
        f"<p>액세스 토큰이 발급됐습니다.</p>"
        f"<script>"
        f"var data={payload};"
        f"if(window.opener){{"
        f"  window.opener.postMessage({{canvaToken:data}},'*');"
        f"  window.close();"
        f"}}else{{"
        f"  setTimeout(function(){{window.location='/';}},2000);"
        f"}}"
        f"</script>"
        f"<p><small>2초 후 앱으로 돌아갑니다...</small></p>"
    )), 200


# ── Canva API 공통 헬퍼 ────────────────────────────────────────────────────

def _canva_headers():
    """저장된 액세스 토큰으로 Canva API 요청 헤더 반환"""
    token = _canva_token.get("access_token", "")
    if not token:
        raise RuntimeError("Canva 액세스 토큰이 없습니다. /api/canva/auth 로 먼저 인증해주세요.")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@app.route("/api/canva/token-status", methods=["GET"])
def canva_token_status():
    """토큰 발급 여부 확인"""
    if _canva_token.get("access_token"):
        return jsonify({"authenticated": True,  "expiresIn": _canva_token.get("expires_in")})
    return jsonify({"authenticated": False})


@app.route("/api/canva/templates", methods=["GET"])
def canva_templates():
    """Canva 브랜드 템플릿 목록 조회
    Query params:
      q         — 검색어 (선택)
      ownership — any | owned | liked (기본: any)
      limit     — 반환 개수 (기본: 20, 최대: 50)
    """
    try:
        headers = _canva_headers()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 401

    params = {}
    q         = request.args.get("q", "").strip()
    ownership = request.args.get("ownership", "any")
    limit     = request.args.get("limit", "20")

    if q:
        params["query"] = q
    if ownership in ("any", "owned", "liked"):
        params["ownership"] = ownership

    try:
        r = req.get(
            f"{CANVA_API_BASE}/brand-templates",
            headers=headers,
            params=params,
            timeout=15,
        )
        logger.info(f"Canva brand-templates: {r.status_code}")

        if r.status_code == 401:
            _canva_token.clear()
            return jsonify({"error": "토큰이 만료됐습니다. /api/canva/auth 로 재인증해주세요."}), 401

        if not r.ok:
            return jsonify({"error": f"Canva API 오류 {r.status_code}", "detail": r.text[:300]}), r.status_code

        data  = r.json()
        items = data.get("items", [])

        # 필요한 필드만 추려서 반환
        templates = [
            {
                "id":          t.get("id", ""),
                "title":       t.get("title", "(제목 없음)"),
                "thumbnail":   (t.get("thumbnail") or {}).get("url", ""),
                "url":         t.get("url", ""),
                "createdAt":   t.get("created_at", ""),
                "updatedAt":   t.get("updated_at", ""),
            }
            for t in items
        ]

        return jsonify({
            "total":        len(templates),
            "templates":    templates,
            "continuation": data.get("continuation"),   # 다음 페이지 커서
        })

    except Exception as e:
        logger.error(f"canva/templates error: {e}")
        return jsonify({"error": "템플릿 조회 중 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Canva Autofill + Export
# ══════════════════════════════════════════════════════════════════════════════

# 브랜드 템플릿 ID 매핑
CANVA_TEMPLATES = {
    "a": "EAHFHBN47dg",   # 화이트 클린
    "b": "EAHFHF2CBNg",   # 다크 프리미엄
    "c": "EAHFHE0kmds",   # 아이스버그
    "d": "EAHFHDq7_NE",   # 웨이브 데이터
}


def _canva_upload_image(image_url: str) -> str:
    """외부 이미지 URL → Canva Asset ID 변환"""
    import time as _t
    headers = _canva_headers()

    img_resp = req.get(
        image_url, timeout=20,
        headers={"User-Agent": "Mozilla/5.0 (compatible; InBodyMarketingTool/1.0)"},
    )
    img_resp.raise_for_status()

    content_type = img_resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
    ext = "jpg" if "jpeg" in content_type else content_type.split("/")[-1]
    filename = f"asset_{secrets.token_hex(6)}.{ext}"

    upload_resp = req.post(
        f"{CANVA_API_BASE}/assets",
        headers={
            "Authorization": headers["Authorization"],
            "Content-Type":  content_type,
            "Asset-Name":    filename,
        },
        data=img_resp.content,
        timeout=30,
    )
    if not upload_resp.ok:
        raise RuntimeError(f"이미지 업로드 실패 {upload_resp.status_code}: {upload_resp.text[:200]}")

    upload_data = upload_resp.json()
    job_id = upload_data.get("job", {}).get("id") or upload_data.get("asset", {}).get("id")
    if not job_id:
        raise RuntimeError(f"Asset 업로드 응답 이상: {upload_data}")

    if "job" in upload_data:
        for _ in range(20):
            _t.sleep(1.5)
            poll = req.get(f"{CANVA_API_BASE}/assets/{job_id}", headers=headers, timeout=10)
            poll_data = poll.json()
            status = poll_data.get("job", {}).get("status") or poll_data.get("asset", {}).get("status")
            if status == "success":
                return poll_data.get("job", {}).get("asset", {}).get("id") or job_id
            if status == "failed":
                raise RuntimeError("Asset 업로드 job 실패")
        raise RuntimeError("Asset 업로드 타임아웃")

    return upload_data.get("asset", {}).get("id", job_id)


def _canva_create_design_copy(template_id: str, title: str) -> str:
    """브랜드 템플릿 → 편집 가능한 디자인 복사본 생성, design_id 반환

    시도 순서:
    1) POST /designs  (brand_template_id)
    2) POST /designs  (asset_id)
    3) POST /autofills (data:{}) — 빈 autofill로 복사본만 생성
    """
    import time as _t
    headers = _canva_headers()

    # ── 시도 1·2: designs 엔드포인트 ──────────────────────────────────────
    for payload in [
        {"title": title, "brand_template_id": template_id},
        {"title": title, "asset_id":          template_id},
    ]:
        r = req.post(f"{CANVA_API_BASE}/designs", headers=headers, json=payload, timeout=20)
        if r.ok:
            did = r.json().get("design", {}).get("id")
            if did:
                logger.info(f"POST /designs 성공: design_id={did}")
                return did
        logger.info(f"POST /designs 실패 ({r.status_code}) payload={list(payload)}: {r.text[:120]}")

    # ── 시도 3: autofill with empty data ─────────────────────────────────
    r3 = req.post(
        f"{CANVA_API_BASE}/autofills",
        headers=headers,
        json={"brand_template_id": template_id, "title": title, "data": {}},
        timeout=20,
    )
    if r3.ok:
        job_id = r3.json().get("job", {}).get("id")
        if job_id:
            for _ in range(30):
                _t.sleep(2)
                poll = req.get(f"{CANVA_API_BASE}/autofills/{job_id}", headers=headers, timeout=10)
                job  = poll.json().get("job", {})
                if job.get("status") == "success":
                    did = job.get("result", {}).get("design", {}).get("id")
                    if did:
                        logger.info(f"autofill copy 성공: design_id={did}")
                        return did
                if job.get("status") == "failed":
                    break

    raise RuntimeError(
        f"디자인 복사본 생성 실패 (template={template_id}). "
        f"마지막 응답: {r3.status_code} {r3.text[:150]}"
    )


def _canva_get_pages(design_id: str) -> list:
    """디자인의 모든 페이지+요소 반환"""
    headers = _canva_headers()
    r = req.get(f"{CANVA_API_BASE}/designs/{design_id}/pages", headers=headers, timeout=15)
    if not r.ok:
        raise RuntimeError(f"페이지 조회 실패 {r.status_code}: {r.text[:300]}")
    return r.json().get("pages", [])


def _canva_update_text_element(
    design_id: str, page_id: str, element_id: str, text: str
) -> bool:
    """텍스트 요소 내용 교체 (PUT → PATCH 폴백)"""
    headers = _canva_headers()
    payload = {"text": {"plaintext": text}}
    for method in (req.put, req.patch):
        r = method(
            f"{CANVA_API_BASE}/designs/{design_id}/pages/{page_id}/elements/{element_id}",
            headers=headers, json=payload, timeout=15,
        )
        if r.ok:
            return True
        logger.warning(f"  {method.__name__.upper()} element 실패 {r.status_code}: {r.text[:150]}")
    return False


def _canva_export_png(design_id: str) -> str:
    """Export job 생성 → 완료 대기 → PNG URL 반환"""
    import time as _t
    headers = _canva_headers()

    resp = req.post(
        f"{CANVA_API_BASE}/exports",
        headers=headers,
        json={"design_id": design_id, "format": {"type": "png"}},
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Export 생성 실패 {resp.status_code}: {resp.text[:300]}")

    job_id = resp.json().get("job", {}).get("id")
    if not job_id:
        raise RuntimeError(f"Export job ID 없음: {resp.json()}")

    logger.info(f"Export job 시작: {job_id}")

    for _ in range(30):
        _t.sleep(2)
        poll = req.get(
            f"{CANVA_API_BASE}/exports/{job_id}",
            headers=headers, timeout=10,
        )
        job = poll.json().get("job", {})
        status = job.get("status")
        logger.info(f"  export status: {status}")
        if status == "success":
            urls = job.get("urls", [])
            if not urls:
                raise RuntimeError(f"Export URL 없음: {job}")
            return urls[0]
        if status == "failed":
            raise RuntimeError(f"Export job 실패: {job.get('error')}")

    raise RuntimeError("Export 타임아웃 (60초)")


@app.route("/api/canva/fill-template", methods=["POST"])
def canva_fill_template():
    """design:content:write — 브랜드 템플릿 텍스트 직접 교체 → PNG URL 반환

    Body (JSON):
      type       — "a" | "b" | "c" | "d"  (필수)
      headline   — 헤드라인 텍스트          (필수)
      body_copy  — 본문 텍스트              (필수)
      image      — 이미지 URL               (선택)

    Flow:
      1. 브랜드 템플릿 → 새 디자인 복사본 생성
      2. GET /designs/{id}/pages 로 전체 요소 목록 조회
      3. element.name 이 "headline" / "body_copy" / "image" 인 요소를 찾아 교체
      4. PNG export → URL 반환
    """
    try:
        _canva_headers()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 401

    body      = request.get_json(silent=True) or {}
    tmpl_type = (body.get("type") or "").lower().strip()
    if tmpl_type not in CANVA_TEMPLATES:
        return jsonify({"error": f"type은 a/b/c/d 중 하나여야 합니다. 받은 값: {tmpl_type!r}"}), 400

    headline  = (body.get("headline")  or "").strip()
    body_copy = (body.get("body_copy") or "").strip()
    image_url = (body.get("image")     or "").strip()

    if not headline:
        return jsonify({"error": "headline 필드가 필요합니다."}), 400

    template_id = CANVA_TEMPLATES[tmpl_type]
    title       = f"InBody_{tmpl_type.upper()}_{headline[:20]}"

    try:
        # ── 1. 브랜드 템플릿 → 편집 가능한 디자인 복사본 ──────────────────
        logger.info(f"[fill] 디자인 복사 시작: template={template_id}")
        design_id = _canva_create_design_copy(template_id, title)
        logger.info(f"[fill] design_id={design_id}")

        # ── 2. 페이지·요소 조회 ────────────────────────────────────────────
        pages = _canva_get_pages(design_id)
        logger.info(f"[fill] 페이지 수={len(pages)}")

        # ── 3. 이름 기반 텍스트 교체 ───────────────────────────────────────
        text_map = {"headline": headline, "body_copy": body_copy}
        updated, skipped = [], []

        for page in pages:
            pid = page.get("id", "")
            for el in page.get("elements", []):
                el_name = (el.get("name") or "").strip()
                el_id   = el.get("id", "")
                el_type = el.get("type", "")

                if el_type == "text" and el_name in text_map:
                    ok = _canva_update_text_element(design_id, pid, el_id, text_map[el_name])
                    (updated if ok else skipped).append(el_name)
                    logger.info(f"  {'✓' if ok else '✗'} text/{el_name} (el={el_id[:12]})")

        logger.info(f"[fill] 교체 완료={updated}, 실패={skipped}")

        # ── 4. 이미지 교체 (선택) ──────────────────────────────────────────
        image_asset_id = None
        if image_url:
            try:
                logger.info(f"[fill] 이미지 업로드: {image_url[:60]}")
                image_asset_id = _canva_upload_image(image_url)
                headers = _canva_headers()
                for page in pages:
                    pid = page.get("id", "")
                    for el in page.get("elements", []):
                        if (el.get("name") or "").strip() == "image" and el.get("type") == "image":
                            el_id = el.get("id", "")
                            for method in (req.put, req.patch):
                                r = method(
                                    f"{CANVA_API_BASE}/designs/{design_id}/pages/{pid}/elements/{el_id}",
                                    headers=headers,
                                    json={"image": {"asset_id": image_asset_id}},
                                    timeout=15,
                                )
                                if r.ok:
                                    updated.append("image")
                                    logger.info(f"  ✓ image/{el_id[:12]}")
                                    break
            except Exception as img_err:
                logger.warning(f"[fill] 이미지 교체 실패 (계속 진행): {img_err}")

        # ── 5. PNG Export ──────────────────────────────────────────────────
        logger.info(f"[fill] PNG export 시작")
        png_url = _canva_export_png(design_id)
        logger.info(f"[fill] PNG export 완료: {png_url[:80]}")

        return jsonify({
            "ok":            True,
            "type":          tmpl_type,
            "template_id":   template_id,
            "design_id":     design_id,
            "updated_fields": updated,
            "skipped_fields": skipped,
            "png_url":       png_url,
        })

    except RuntimeError as e:
        logger.error(f"[fill] error: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.exception("[fill] unexpected error")
        return jsonify({"error": "예상치 못한 오류", "detail": str(e)}), 500


@app.route("/api/canva/fill-template/inspect", methods=["POST"])
def canva_inspect_template():
    """디버그: 브랜드 템플릿의 디자인 복사본을 생성하고 페이지·요소 구조를 그대로 반환
    Body: {"type": "a"}
    """
    try:
        _canva_headers()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 401

    body      = request.get_json(silent=True) or {}
    tmpl_type = (body.get("type") or "a").lower().strip()
    template_id = CANVA_TEMPLATES.get(tmpl_type)
    if not template_id:
        return jsonify({"error": "type은 a/b/c/d 중 하나여야 합니다."}), 400

    try:
        design_id = _canva_create_design_copy(template_id, f"inspect_{tmpl_type}")
        pages     = _canva_get_pages(design_id)

        summary = []
        for page in pages:
            for el in page.get("elements", []):
                summary.append({
                    "page_id":    page.get("id"),
                    "element_id": el.get("id"),
                    "name":       el.get("name"),
                    "type":       el.get("type"),
                    "text":       el.get("text", {}).get("plaintext", "")[:80] if el.get("type") == "text" else None,
                })

        return jsonify({
            "design_id": design_id,
            "page_count": len(pages),
            "elements":   summary,
        })
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Canva create-design  (design:content:write — 복제 + 요소 교체 시도)
# ══════════════════════════════════════════════════════════════════════════════

# 사용자 소유 템플릿 디자인 (브랜드 템플릿의 복사본, 실제 편집 가능)
CANVA_TEMPLATE_DESIGNS = {
    "a": "DAHFHCtFb48",   # Copy of Type A  (화이트 클린)
    "b": "DAHFHJgQh2s",   # Copy of Type B  (다크 프리미엄)
    "c": "DAHFHOMxH0E",   # Copy of Type C  (아이스버그)
    "d": "DAHFHI6ywZQ",   # Copy of Type D  (웨이브 데이터)
}


def _canva_resize_copy(source_id: str, title: str) -> str:
    """Resize API로 디자인 복제 (동일 크기) → 새 design_id 반환

    Canva Connect REST API에 전용 '복제' 엔드포인트가 없으므로
    Resize API(같은 치수)를 이용해 사실상의 복사본을 생성한다.
    """
    import time as _t
    headers = _canva_headers()

    # ── 원본 크기 조회 ──────────────────────────────────────────────────────
    pages_r = req.get(
        f"{CANVA_API_BASE}/designs/{source_id}/pages",
        headers=headers, timeout=15,
    )
    if not pages_r.ok:
        raise RuntimeError(f"원본 페이지 조회 실패 {pages_r.status_code}: {pages_r.text[:200]}")

    dims = (pages_r.json().get("items") or [{}])[0].get("dimensions", {})
    width  = int(dims.get("width",  1080))
    height = int(dims.get("height", 1350))
    logger.info(f"[resize-copy] source={source_id} size={width}x{height}")

    # ── Resize job 생성 ─────────────────────────────────────────────────────
    resp = req.post(
        f"{CANVA_API_BASE}/resizes",
        headers=headers,
        json={
            "design_id":   source_id,
            "design_type": {"type": "custom", "width": width, "height": height},
            "title":       title,
        },
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Resize job 생성 실패 {resp.status_code}: {resp.text[:300]}")

    job_id = resp.json().get("job", {}).get("id")
    if not job_id:
        raise RuntimeError(f"Resize job ID 없음: {resp.json()}")

    logger.info(f"[resize-copy] job_id={job_id}")

    # ── 완료 대기 (폴링) ─────────────────────────────────────────────────────
    for _ in range(30):
        _t.sleep(2)
        poll = req.get(f"{CANVA_API_BASE}/resizes/{job_id}", headers=headers, timeout=10)
        job  = poll.json().get("job", {})
        status = job.get("status")
        logger.info(f"  resize status: {status}")
        if status == "success":
            did = job.get("result", {}).get("design", {}).get("id")
            if not did:
                raise RuntimeError(f"복제된 design_id 없음: {job}")
            logger.info(f"[resize-copy] 새 design_id={did}")
            return did
        if status == "failed":
            raise RuntimeError(f"Resize job 실패: {job.get('error')}")

    raise RuntimeError("Resize 타임아웃 (60초)")


def _canva_probe_elements(design_id: str) -> list:
    """복제된 디자인의 요소 목록을 가능한 모든 경로로 시도해 반환

    Canva Connect REST API는 현재 /pages/{n}/elements 를 공식 지원하지 않으나
    향후 지원될 가능성을 고려해 여러 경로를 순서대로 시도한다.
    반환값: [{"page": n, "id": "...", "name": "...", "type": "..."}, ...]
    """
    headers = _canva_headers()
    elements: list = []

    pages_r = req.get(f"{CANVA_API_BASE}/designs/{design_id}/pages",
                      headers=headers, timeout=15)
    pages = (pages_r.json().get("items") or []) if pages_r.ok else []

    for page in pages:
        idx = page.get("index", 1)

        # 시도할 경로 목록 (현재 공식 지원 여부 불확실한 경로 포함)
        candidates = [
            f"designs/{design_id}/pages/{idx}/elements",
            f"designs/{design_id}/pages/{idx}",
        ]
        for path in candidates:
            r = req.get(f"{CANVA_API_BASE}/{path}", headers=headers, timeout=10)
            if r.ok:
                body = r.json()
                raw = body.get("elements") or body.get("items") or []
                for el in raw:
                    elements.append({
                        "page":  idx,
                        "id":    el.get("id", ""),
                        "name":  (el.get("name") or "").strip(),
                        "type":  el.get("type", ""),
                        "text":  el.get("text", {}).get("plaintext", "")[:80]
                                 if el.get("type") == "text" else None,
                    })
                if raw:
                    break  # 요소를 찾았으면 다음 페이지로
            else:
                logger.info(f"  probe {path}: {r.status_code} {r.text[:80]}")

    logger.info(f"[probe] 발견된 요소 수: {len(elements)}")
    return elements


def _canva_update_element(design_id: str, page_idx: int, el_id: str,
                          el_type: str, value) -> bool:
    """텍스트/이미지 요소 업데이트 (PUT → PATCH 폴백)"""
    headers = _canva_headers()

    if el_type == "text":
        payload = {"text": {"plaintext": str(value)}}
    elif el_type == "image":
        payload = {"image": {"asset_id": str(value)}}
    else:
        return False

    for method in (req.put, req.patch):
        r = method(
            f"{CANVA_API_BASE}/designs/{design_id}/pages/{page_idx}/elements/{el_id}",
            headers=headers, json=payload, timeout=15,
        )
        if r.ok:
            return True
        logger.info(f"  {method.__name__.upper()} element {el_id[:10]} → {r.status_code}: {r.text[:100]}")

    return False


# ══════════════════════════════════════════════════════════════════════════════
# PPTX 경유 텍스트/이미지 치환 헬퍼
# ══════════════════════════════════════════════════════════════════════════════

def _canva_export_bytes(design_id: str, fmt: str = "pptx") -> bytes:
    """Canva 디자인 → 파일 바이트 반환 (pptx / pdf / jpg / png)"""
    import time as _t
    headers = _canva_headers()

    resp = req.post(
        f"{CANVA_API_BASE}/exports",
        headers=headers,
        json={"design_id": design_id, "format": {"type": fmt}},
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Export 생성 실패 {resp.status_code}: {resp.text[:300]}")

    job_id = resp.json().get("job", {}).get("id")
    if not job_id:
        raise RuntimeError(f"Export job ID 없음: {resp.json()}")

    logger.info(f"[export-bytes] job_id={job_id} fmt={fmt}")

    for _ in range(30):
        _t.sleep(2)
        poll = req.get(f"{CANVA_API_BASE}/exports/{job_id}", headers=headers, timeout=10)
        job = poll.json().get("job", {})
        status = job.get("status")
        logger.info(f"  export status: {status}")
        if status == "success":
            urls = job.get("urls", [])
            if not urls:
                raise RuntimeError(f"Export URL 없음: {job}")
            dl = req.get(urls[0], timeout=60)
            dl.raise_for_status()
            return dl.content
        if status == "failed":
            raise RuntimeError(f"Export job 실패: {job.get('error')}")

    raise RuntimeError("Export 타임아웃 (60초)")


def _pptx_replace_texts(pptx_bytes: bytes, replacements: dict) -> bytes:
    """python-pptx로 텍스트 치환 — 폰트 크기 내림차순으로 headline→body_copy→type 매핑

    replacements: {"headline": "...", "body_copy": "...", "type": "..."}
    """
    from pptx import Presentation
    from pptx.oxml.ns import qn
    from lxml import etree
    import io

    prs = Presentation(io.BytesIO(pptx_bytes))

    # 모든 슬라이드의 텍스트프레임 수집 (최대 폰트 크기 기준)
    text_frames = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            tf = shape.text_frame
            max_size = 0
            for para in tf.paragraphs:
                for run in para.runs:
                    if run.font.size:
                        sz = run.font.size.pt
                        if sz > max_size:
                            max_size = sz
            if max_size == 0 and any(p.runs for p in tf.paragraphs):
                max_size = 12  # 폰트 크기 없는 경우 기본값
            if max_size > 0:
                text_frames.append((max_size, tf, shape.name))

    # 폰트 크기 내림차순
    text_frames.sort(key=lambda x: x[0], reverse=True)

    field_order = ["headline", "body_copy", "type"]
    for i, (size, tf, shape_name) in enumerate(text_frames):
        if i >= len(field_order):
            break
        field = field_order[i]
        new_text = replacements.get(field, "")
        if not new_text:
            continue
        logger.info(f"[pptx] '{shape_name}'(size={size:.0f}pt) → {field}: {new_text[:40]}")

        # 첫 번째 런의 서식 저장
        first_para = tf.paragraphs[0] if tf.paragraphs else None
        first_run  = first_para.runs[0] if (first_para and first_para.runs) else None

        saved_size  = first_run.font.size  if first_run else None
        saved_bold  = first_run.font.bold  if first_run else None
        saved_color = None
        if first_run:
            try:
                if first_run.font.color.type is not None:
                    saved_color = str(first_run.font.color.rgb)
            except Exception:
                pass

        # txBody에서 기존 단락 제거 후 새 단락 삽입
        txBody = tf._txBody
        for p_elem in list(txBody.findall(qn("a:p"))):
            txBody.remove(p_elem)

        new_p  = etree.SubElement(txBody, qn("a:p"))
        new_r  = etree.SubElement(new_p,  qn("a:r"))
        new_rPr = etree.SubElement(new_r, qn("a:rPr"), lang="ko-KR")

        if saved_size:
            new_rPr.set("sz", str(int(saved_size.pt * 100)))
        if saved_bold:
            new_rPr.set("b", "1")
        if saved_color:
            solidFill = etree.SubElement(new_rPr, qn("a:solidFill"))
            srgbClr   = etree.SubElement(solidFill, qn("a:srgbClr"))
            srgbClr.set("val", saved_color)

        new_t      = etree.SubElement(new_r, qn("a:t"))
        new_t.text = new_text

    output = io.BytesIO()
    prs.save(output)
    return output.getvalue()


def _pptx_replace_image(pptx_bytes: bytes, image_url: str) -> bytes:
    """python-pptx로 가장 큰 Picture 도형에 이미지 교체"""
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from pptx.oxml.ns import qn
    import io

    img_resp = req.get(image_url, timeout=30)
    img_resp.raise_for_status()
    img_bytes = img_resp.content

    prs = Presentation(io.BytesIO(pptx_bytes))

    largest_pic  = None
    largest_area = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                area = shape.width * shape.height
                if area > largest_area:
                    largest_area = area
                    largest_pic  = shape

    if largest_pic is None:
        logger.warning("[pptx] Picture 도형 없음 — 이미지 교체 생략")
    else:
        img_part, rId = largest_pic.part.get_or_add_image_part(io.BytesIO(img_bytes))
        blip = largest_pic._element.find(".//" + qn("a:blip"))
        if blip is not None:
            blip.set(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed",
                rId,
            )

    output = io.BytesIO()
    prs.save(output)
    return output.getvalue()


def _pptx_to_png(pptx_bytes: bytes, png_path: Path) -> bool:
    """PPTX → PNG 변환 (LibreOffice → PowerPoint COM → PyMuPDF 순서로 시도)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp       = Path(tmpdir)
        pptx_file = tmp / "slide.pptx"
        pptx_file.write_bytes(pptx_bytes)

        # ── 1. LibreOffice 직접 PNG ─────────────────────────────────────────
        for lo_cmd in ("libreoffice", "libreoffice7.6", "soffice"):
            try:
                r = subprocess.run(
                    [lo_cmd, "--headless", "--convert-to", "png",
                     "--outdir", str(tmp), str(pptx_file)],
                    capture_output=True, timeout=60,
                )
                if r.returncode == 0:
                    out_files = list(tmp.glob("*.png"))
                    if out_files:
                        shutil.copy(out_files[0], png_path)
                        logger.info(f"[pptx2png] LibreOffice PNG 성공")
                        return True
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue

        # ── 2. PowerPoint COM (Windows) ──────────────────────────────────────
        try:
            import comtypes.client
            ppt = comtypes.client.CreateObject("Powerpoint.Application")
            ppt.Visible = 1
            prs = ppt.Presentations.Open(str(pptx_file.resolve()))
            prs.Slides(1).Export(str(png_path.resolve()), "PNG")
            prs.Close()
            ppt.Quit()
            if png_path.exists():
                logger.info("[pptx2png] PowerPoint COM 성공")
                return True
        except Exception as e:
            logger.warning(f"[pptx2png] COM 실패: {e}")

        # ── 3. LibreOffice → PDF → PyMuPDF ───────────────────────────────────
        for lo_cmd in ("libreoffice", "libreoffice7.6", "soffice"):
            try:
                r = subprocess.run(
                    [lo_cmd, "--headless", "--convert-to", "pdf",
                     "--outdir", str(tmp), str(pptx_file)],
                    capture_output=True, timeout=60,
                )
                if r.returncode == 0:
                    pdf_files = list(tmp.glob("*.pdf"))
                    if pdf_files:
                        import fitz
                        doc  = fitz.open(str(pdf_files[0]))
                        pix  = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2))
                        pix.save(str(png_path))
                        doc.close()
                        if png_path.exists():
                            logger.info("[pptx2png] LibreOffice+PyMuPDF 성공")
                            return True
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
            except Exception as e:
                logger.warning(f"[pptx2png] PDF 경유 실패: {e}")
                break

    logger.error("[pptx2png] 모든 변환 방법 실패")
    return False


OUTPUT_DIR = SERVER_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


@app.route("/api/canva/output/<filename>")
def canva_output_file(filename):
    """로컬 변환 결과물 서빙"""
    safe_name = Path(filename).name  # path traversal 방지
    file_path = OUTPUT_DIR / safe_name
    if not file_path.exists():
        return jsonify({"error": "파일 없음"}), 404
    return send_file(file_path)


@app.route("/api/canva/create-design", methods=["POST"])
def canva_create_design():
    """PPTX 경유 텍스트/이미지 치환 → PNG 반환

    Flow:
      1. Canva 디자인 → PPTX export (bytes)
      2. python-pptx 로 headline/body_copy/type 텍스트 치환 (폰트 크기 기준)
      3. 최대 Picture 도형에 image 교체 (선택)
      4. PPTX → PNG 변환 (LibreOffice / PowerPoint COM / PyMuPDF)
      5. 로컬 PNG URL 반환

    Body (JSON):
      type        — "a" | "b" | "c" | "d"  (필수)
      headline    — 헤드라인 텍스트          (필수)
      body_copy   — 본문 텍스트              (선택)
      type_label  — 타입 라벨 텍스트         (선택, PPTX 세 번째 텍스트프레임)
      image       — 이미지 URL               (선택)
    """
    try:
        _canva_headers()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 401

    body       = request.get_json(silent=True) or {}
    tmpl_type  = (body.get("type") or "").lower().strip()
    if tmpl_type not in CANVA_TEMPLATE_DESIGNS:
        return jsonify({"error": f"type은 a/b/c/d 중 하나여야 합니다. 받은 값: {tmpl_type!r}"}), 400

    headline   = (body.get("headline")   or "").strip()
    body_copy  = (body.get("body_copy")  or "").strip()
    type_label = (body.get("type_label") or "").strip()
    image_url  = (body.get("image")      or "").strip()

    if not headline:
        return jsonify({"error": "headline 필드가 필요합니다."}), 400

    source_id = CANVA_TEMPLATE_DESIGNS[tmpl_type]
    out_name  = f"inbody_{tmpl_type}_{secrets.token_hex(6)}.png"
    png_path  = OUTPUT_DIR / out_name

    try:
        # ── 1. PPTX export ──────────────────────────────────────────────────
        logger.info(f"[create-design] PPTX export: design={source_id}")
        pptx_bytes = _canva_export_bytes(source_id, "pptx")
        logger.info(f"[create-design] PPTX 다운로드 완료 ({len(pptx_bytes):,} bytes)")

        # ── 2. 텍스트 치환 ──────────────────────────────────────────────────
        replacements = {}
        if headline:   replacements["headline"]  = headline
        if body_copy:  replacements["body_copy"] = body_copy
        if type_label: replacements["type"]      = type_label

        if replacements:
            pptx_bytes = _pptx_replace_texts(pptx_bytes, replacements)
            logger.info(f"[create-design] 텍스트 치환 완료: {list(replacements.keys())}")

        # ── 3. 이미지 치환 ──────────────────────────────────────────────────
        if image_url:
            try:
                pptx_bytes = _pptx_replace_image(pptx_bytes, image_url)
                logger.info("[create-design] 이미지 치환 완료")
            except Exception as img_e:
                logger.warning(f"[create-design] 이미지 치환 실패(계속): {img_e}")

        # ── 4. PPTX → PNG 변환 ──────────────────────────────────────────────
        converted = _pptx_to_png(pptx_bytes, png_path)

        if converted and png_path.exists():
            local_url = f"http://127.0.0.1:5000/api/canva/output/{out_name}"
            logger.info(f"[create-design] 완료: {local_url}")
            return jsonify({
                "ok":      True,
                "type":    tmpl_type,
                "png_url": local_url,
                "source":  "pptx_conversion",
                "note":    "PPTX 경유 텍스트 치환 후 PNG 변환 완료",
            })

        # PNG 변환 실패 시 PPTX 파일 자체 반환
        pptx_name = out_name.replace(".png", ".pptx")
        pptx_path = OUTPUT_DIR / pptx_name
        pptx_path.write_bytes(pptx_bytes)
        pptx_url = f"http://127.0.0.1:5000/api/canva/output/{pptx_name}"
        logger.warning(f"[create-design] PNG 변환 실패, PPTX 반환: {pptx_url}")
        return jsonify({
            "ok":       False,
            "type":     tmpl_type,
            "pptx_url": pptx_url,
            "png_url":  None,
            "source":   "pptx_fallback",
            "note":     "PNG 변환 실패 (LibreOffice/PowerPoint 미설치). PPTX를 직접 다운로드하세요.",
        })

    except RuntimeError as e:
        logger.error(f"[create-design] error: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.exception("[create-design] unexpected error")
        return jsonify({"error": "예상치 못한 오류", "detail": str(e)}), 500


@app.route("/api/canva/create-design/inspect", methods=["POST"])
def canva_create_design_inspect():
    """PPTX 구조 검사 — 텍스트프레임/이미지 도형 목록 반환 (디버깅용)

    Body (JSON):
      type — "a" | "b" | "c" | "d"  (필수)
    """
    try:
        _canva_headers()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 401

    body      = request.get_json(silent=True) or {}
    tmpl_type = (body.get("type") or "").lower().strip()
    if tmpl_type not in CANVA_TEMPLATE_DESIGNS:
        return jsonify({"error": f"type은 a/b/c/d 중 하나여야 합니다. 받은 값: {tmpl_type!r}"}), 400

    source_id = CANVA_TEMPLATE_DESIGNS[tmpl_type]

    try:
        from pptx import Presentation
        from pptx.enum.shapes import MSO_SHAPE_TYPE
        import io

        pptx_bytes = _canva_export_bytes(source_id, "pptx")
        prs = Presentation(io.BytesIO(pptx_bytes))
        shapes_info = []

        for slide_idx, slide in enumerate(prs.slides):
            for shape in slide.shapes:
                info = {
                    "slide":      slide_idx + 1,
                    "name":       shape.name,
                    "shape_type": str(shape.shape_type),
                    "left":  shape.left,  "top":    shape.top,
                    "width": shape.width, "height": shape.height,
                }
                if shape.has_text_frame:
                    tf = shape.text_frame
                    runs_info = []
                    for para in tf.paragraphs:
                        for run in para.runs:
                            runs_info.append({
                                "text":      run.text[:80],
                                "font_size": run.font.size.pt if run.font.size else None,
                                "bold":      run.font.bold,
                            })
                    info["text_frame"] = {
                        "full_text": tf.text[:120],
                        "runs":      runs_info,
                    }
                elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                    info["picture"] = True
                shapes_info.append(info)

        return jsonify({
            "ok":          True,
            "type":        tmpl_type,
            "design_id":   source_id,
            "pptx_size":   len(pptx_bytes),
            "slide_count": len(prs.slides),
            "shapes":      shapes_info,
        })

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        logger.exception("[inspect] unexpected error")
        return jsonify({"error": "예상치 못한 오류", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Pillow 브랜드 이미지 생성  (/api/image/create)
# ══════════════════════════════════════════════════════════════════════════════
import io as _io
from types import SimpleNamespace as _NS
from PIL import Image as _Img, ImageDraw as _Draw, ImageFont as _Font

BRAND = _NS(
    red        = (151, 27, 47),
    black      = (16, 24, 32),
    dark_gray  = (75, 79, 90),
    light_gray = (178, 180, 184),
    ice_gray   = (162, 178, 200),
    white      = (255, 255, 255),
)

FONTS_DIR = SERVER_DIR / "fonts"
FONTS_DIR.mkdir(exist_ok=True)

TEMPLATES_DIR = SERVER_DIR / "assets" / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

def _try_download_fonts():
    """Noto Sans KR TTF 자동 다운로드 (서버 시작 시 1회)"""
    # 각 variant별로 여러 소스 URL 순서대로 시도
    sources = {
        "Regular": [
            "https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf",
        ],
        "Bold": [
            "https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf",
        ],
    }
    for name, urls in sources.items():
        dest = FONTS_DIR / f"NotoSansKR-{name}.ttf"
        if dest.exists():
            continue
        for url in urls:
            try:
                logger.info(f"[font] 다운로드 중: NotoSansKR-{name}.ttf")
                r = req.get(url, timeout=20, allow_redirects=True)
                if r.ok and len(r.content) > 10_000:
                    dest.write_bytes(r.content)
                    logger.info(f"[font] 저장 완료: {dest.name} ({len(r.content)//1024}KB)")
                    break
                else:
                    logger.warning(f"[font] 실패 {name} ({r.status_code}): {url[:60]}")
            except Exception as e:
                logger.warning(f"[font] {name} 오류: {e}")

_try_download_fonts()


def _font(size: int, weight: str = "regular"):
    """폰트 로드: Noto Sans KR → Malgun Gothic → Arial → 기본폰트"""
    w = {"bold": "Bold", "medium": "Medium", "regular": "Regular"}.get(weight, "Regular")
    candidates = [
        FONTS_DIR / f"NotoSansKR-{w}.ttf",
        FONTS_DIR / "NotoSansKR-Regular.ttf",
    ]
    if weight == "bold":
        candidates += [Path("C:/Windows/Fonts/malgunbd.ttf"),
                       Path("C:/Windows/Fonts/arialbd.ttf")]
    candidates += [Path("C:/Windows/Fonts/malgun.ttf"),
                   Path("C:/Windows/Fonts/arial.ttf"),
                   Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf")]
    for p in candidates:
        if p.exists():
            try:
                return _Font.truetype(str(p), size)
            except Exception:
                continue
    return _Font.load_default()


def _load_photo(url: str, size: tuple) -> "_Img.Image | None":
    """URL → cover-crop 이미지"""
    try:
        r = req.get(url, timeout=20)
        r.raise_for_status()
        src = _Img.open(_io.BytesIO(r.content)).convert("RGB")
        tw, th = size
        iw, ih = src.size
        scale = max(tw / iw, th / ih)
        nw, nh = int(iw * scale), int(ih * scale)
        src = src.resize((nw, nh), _Img.LANCZOS)
        ox, oy = (nw - tw) // 2, (nh - th) // 2
        return src.crop((ox, oy, ox + tw, oy + th))
    except Exception as e:
        logger.warning(f"[photo] 로드 실패: {e}")
        return None


def _wrap(draw, text: str, font, max_w: int) -> list:
    """문자 단위 줄바꿈"""
    lines, cur = [], ""
    for ch in text:
        test = cur + ch
        w = draw.textbbox((0, 0), test, font=font)[2]
        if w > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines


def _grad_overlay(img, x: int, y: int, w: int, h: int,
                  color: tuple, a_top: int, a_bot: int):
    """수직 그라디언트 오버레이"""
    ov = _Img.new("RGBA", (w, h))
    pix = ov.load()
    for row in range(h):
        a = int(a_top + (a_bot - a_top) * row / h)
        for col in range(w):
            pix[col, row] = (*color, a)
    base = img.convert("RGBA")
    base.paste(ov, (x, y), ov)
    return base.convert("RGB")


# ── Type A: 화이트 클린 ────────────────────────────────────────────────────

def _gen_type_a(headline: str, body_copy: str, type_label: str, image_url: str):
    W, H = 1080, 1080
    img  = _Img.new("RGB", (W, H), BRAND.white)
    d    = _Draw.Draw(img)

    # 좌측 빨간 바 + 상단 빨간 바
    d.rectangle([0, 0, 9, H], fill=BRAND.red)
    d.rectangle([0, 0, W, 7], fill=BRAND.red)

    # 이미지 영역
    IX, IY, IW, IH = 70, 70, 940, 460
    photo = _load_photo(image_url, (IW, IH)) if image_url else None
    if photo:
        img.paste(photo, (IX, IY))
        d = _Draw.Draw(img)
    else:
        d.rectangle([IX, IY, IX + IW, IY + IH], fill=(230, 230, 230))
        d.text((IX + IW // 2, IY + IH // 2), "IMAGE",
               fill=BRAND.light_gray, font=_font(32), anchor="mm")

    y = 555

    # 타입 뱃지
    if type_label:
        bf  = _font(22, "medium")
        tw  = d.textbbox((0, 0), type_label.upper(), font=bf)[2]
        d.rectangle([70, y, 70 + tw + 26, y + 38], fill=BRAND.red)
        d.text((83, y + 7), type_label.upper(), fill=BRAND.white, font=bf)
        y += 55

    # 헤드라인
    hl_f  = _font(54, "bold")
    for line in _wrap(d, headline, hl_f, 940)[:2]:
        d.text((70, y), line, fill=BRAND.black, font=hl_f)
        y += 66
    y += 10

    # 빨간 구분선
    d.rectangle([70, y, 155, y + 4], fill=BRAND.red)
    y += 24

    # 본문
    if body_copy:
        bc_f = _font(30)
        for line in _wrap(d, body_copy, bc_f, 940)[:4]:
            d.text((70, y), line, fill=BRAND.dark_gray, font=bc_f)
            y += 44

    # 브랜드 마크
    d.text((W - 70, H - 48), "InBody", fill=BRAND.dark_gray,
           font=_font(28, "bold"), anchor="rm")
    d.ellipse([W - 44, H - 60, W - 28, H - 44], fill=BRAND.red)
    return img


# ── Type B: 다크 프리미엄 ─────────────────────────────────────────────────

def _gen_type_b(headline: str, body_copy: str, type_label: str, image_url: str):
    W, H = 1080, 1080
    img  = _Img.new("RGB", (W, H), BRAND.black)
    d    = _Draw.Draw(img)

    # 상단 이미지 (전체 너비, h=560)
    IH = 560
    photo = _load_photo(image_url, (W, IH)) if image_url else None
    if photo:
        img.paste(photo, (0, 0))

    # 이미지 하단 다크 그라디언트
    img = _grad_overlay(img, 0, IH - 220, W, 220, BRAND.black, 0, 230)
    d   = _Draw.Draw(img)

    # 빨간 구분선
    d.rectangle([0, IH, W, IH + 4], fill=BRAND.red)
    y = IH + 26

    # 타입 라벨
    if type_label:
        d.text((70, y), type_label.upper(), fill=BRAND.ice_gray, font=_font(22, "medium"))
        y += 40

    # 헤드라인
    hl_f = _font(58, "bold")
    for line in _wrap(d, headline, hl_f, 940)[:2]:
        d.text((70, y), line, fill=BRAND.white, font=hl_f)
        y += 70
    y += 10

    # 본문
    if body_copy:
        bc_f = _font(30)
        for line in _wrap(d, body_copy, bc_f, 940)[:3]:
            d.text((70, y), line, fill=BRAND.light_gray, font=bc_f)
            y += 44

    # 브랜드 마크 (빨간)
    d.text((W - 70, H - 48), "InBody", fill=BRAND.red,
           font=_font(30, "bold"), anchor="rm")
    return img


# ── Type C: 아이스버그 ─────────────────────────────────────────────────────

def _gen_type_c(headline: str, body_copy: str, type_label: str, image_url: str):
    W, H = 1080, 1080
    img  = _Img.new("RGB", (W, H), BRAND.white)
    d    = _Draw.Draw(img)

    # 우상단 원형 장식 (아이스)
    for r, lw in [(320, 55), (180, 20)]:
        cx, cy = 960, 140
        d.arc([cx - r, cy - r, cx + r, cy + r], 0, 360,
              fill=BRAND.ice_gray, width=lw)

    # 좌측 이미지 패널 (w=480, 전체 높이)
    IW = 480
    photo = _load_photo(image_url, (IW, H)) if image_url else None
    if photo:
        img.paste(photo, (0, 0))
        img = _grad_overlay(img, 0, 0, IW, 180, BRAND.ice_gray, 140, 0)
        d   = _Draw.Draw(img)
    else:
        d.rectangle([0, 0, IW, H], fill=(215, 225, 235))

    # 수직 구분선
    d.rectangle([IW, 0, IW + 4, H], fill=BRAND.ice_gray)

    # 우측 텍스트 영역
    TX, TW = IW + 54, W - IW - 104
    y = 110

    d.rectangle([TX, y, TX + 60, y + 3], fill=BRAND.ice_gray)
    y += 20

    if type_label:
        d.text((TX, y), type_label.upper(), fill=BRAND.ice_gray, font=_font(22, "medium"))
        y += 42

    # 헤드라인
    hl_f = _font(50, "bold")
    for line in _wrap(d, headline, hl_f, TW)[:3]:
        d.text((TX, y), line, fill=BRAND.black, font=hl_f)
        y += 62
    y += 16

    # 빨간 왼쪽 악센트 바 + 본문
    if body_copy:
        bc_f  = _font(28)
        lines = _wrap(d, body_copy, bc_f, TW - 22)[:5]
        bar_h = len(lines) * 42 + 10
        d.rectangle([TX, y, TX + 4, y + bar_h], fill=BRAND.red)
        by = y + 6
        for line in lines:
            d.text((TX + 18, by), line, fill=BRAND.dark_gray, font=bc_f)
            by += 42
        y = by + 20

    # 하단 ice gray 선 + 브랜드
    d.rectangle([TX, H - 78, W - 48, H - 75], fill=BRAND.ice_gray)
    d.text((TX, H - 58), "InBody", fill=BRAND.dark_gray, font=_font(26, "bold"))
    return img


# ── Type D: 웨이브 데이터 ─────────────────────────────────────────────────

def _gen_type_d(headline: str, body_copy: str, type_label: str, image_url: str):
    W, H = 1080, 1080
    img  = _Img.new("RGB", (W, H), BRAND.black)
    d    = _Draw.Draw(img)

    # 배경 점 그리드
    for gx in range(40, W, 50):
        for gy in range(40, H, 50):
            d.ellipse([gx - 1, gy - 1, gx + 1, gy + 1], fill=(38, 48, 58))

    # 우측 이미지 (w=520, h=520, 빨간 테두리)
    IW, IH_PIC = 520, 520
    IX, IY = W - IW - 44, 62
    photo = _load_photo(image_url, (IW, IH_PIC)) if image_url else None
    if photo:
        img.paste(photo, (IX, IY))
        d = _Draw.Draw(img)
    else:
        d.rectangle([IX, IY, IX + IW, IY + IH_PIC], fill=(28, 38, 48))
    d.rectangle([IX - 4, IY - 4, IX + IW + 4, IY + IH_PIC + 4],
                outline=BRAND.red, width=4)

    # 좌측 텍스트 영역
    TX, TW = 60, IX - 60 - 40
    y = 100

    # [TYPE] 뱃지
    if type_label:
        lbl = f"[ {type_label.upper()} ]"
        d.text((TX, y), lbl, fill=BRAND.red, font=_font(22, "medium"))
        y += 46

    # 헤드라인
    hl_f = _font(50, "bold")
    for line in _wrap(d, headline, hl_f, TW)[:3]:
        d.text((TX, y), line, fill=BRAND.white, font=hl_f)
        y += 62
    y += 14

    # 구분선
    d.rectangle([TX, y, TX + TW, y + 2], fill=BRAND.ice_gray)
    y += 20

    # 본문
    if body_copy:
        bc_f = _font(26)
        for line in _wrap(d, body_copy, bc_f, TW)[:5]:
            d.text((TX, y), line, fill=BRAND.ice_gray, font=bc_f)
            y += 40

    # 하단 데이터 바 장식
    by = H - 210
    for label, val in [("MUSCLE", 0.72), ("FAT", 0.45), ("WATER", 0.88)]:
        d.text((TX, by), label, fill=BRAND.light_gray, font=_font(18, "medium"))
        d.rectangle([TX, by + 26, TX + TW, by + 34], fill=(38, 50, 62))
        d.rectangle([TX, by + 26, TX + int(TW * val), by + 34], fill=BRAND.red)
        by += 54

    # 하단 빨간 아크 장식
    d.arc([W - 500, H - 200, W + 100, H + 300], start=200, end=310,
          fill=BRAND.red, width=6)

    # 브랜드 마크
    d.text((TX, H - 48), "InBody", fill=BRAND.white, font=_font(26, "bold"))
    return img


def _gen_with_template(tmpl_path: Path, tmpl_type: str,
                       headline: str, body_copy: str,
                       type_label: str, image_url: str):
    """Canva 템플릿 PNG 배경 + 업로드 이미지 합성 + 하단 30% 텍스트 오버레이.

    레이아웃:
      - 템플릿 PNG를 1080×1080 배경으로 사용
      - 업로드 이미지: 상단 60% 영역 중앙 cover 배치
      - 하단 30% (y=756~1080): 반투명 검정 그라디언트 오버레이
      - headline : 오버레이 내 중앙 정렬, 흰색 Bold 60px
      - body_copy: headline 아래 24px, 흰색 40px
    """
    W, H = 1080, 1080
    OVERLAY_Y = int(H * 0.70)          # 756px — 하단 30% 시작

    # ── 1. 템플릿 배경 ────────────────────────────────────────────────────
    bg = _Img.open(str(tmpl_path)).convert("RGBA").resize((W, H), _Img.LANCZOS)

    # ── 2. 업로드 이미지: 상단 60% 영역에 cover 배치 ─────────────────────
    if image_url:
        photo = _load_photo(image_url, (W, OVERLAY_Y))
        if photo:
            photo_rgba = photo.convert("RGBA")
            bg.paste(photo_rgba, (0, 0), photo_rgba)

    # ── 3. 하단 30% 반투명 검정 그라디언트 오버레이 ───────────────────────
    overlay_h = H - OVERLAY_Y
    overlay   = _Img.new("RGBA", (W, overlay_h), (0, 0, 0, 0))
    for row in range(overlay_h):
        alpha = int(200 * (row / overlay_h))   # 0→200 페이드인
        for col in range(W):
            overlay.putpixel((col, row), (0, 0, 0, alpha))
    bg.paste(overlay, (0, OVERLAY_Y), overlay)

    # ── 4. 텍스트 합성 ────────────────────────────────────────────────────
    result = bg.convert("RGB")
    d = _Draw.Draw(result)

    pad   = 80                          # 오버레이 상단 여백
    y     = OVERLAY_Y + pad

    hl_f  = _font(60, "bold")
    hl_lh = 74
    for line in _wrap(d, headline, hl_f, W - 120)[:2]:
        tw = d.textbbox((0, 0), line, font=hl_f)[2]
        d.text(((W - tw) // 2, y), line, fill=BRAND.white, font=hl_f)
        y += hl_lh

    if body_copy:
        y += 24
        bc_f  = _font(40)
        bc_lh = 52
        for line in _wrap(d, body_copy, bc_f, W - 160)[:3]:
            tw = d.textbbox((0, 0), line, font=bc_f)[2]
            d.text(((W - tw) // 2, y), line, fill=(220, 220, 220), font=bc_f)
            y += bc_lh

    return result


@app.route("/api/image/upload", methods=["POST"])
def image_upload():
    """이미지 파일 업로드 → 서버 로컬 URL 반환 (multipart/form-data)"""
    if "file" not in request.files:
        return jsonify({"error": "file 필드가 없습니다."}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "파일이 비어있습니다."}), 400
    ext = Path(f.filename).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return jsonify({"error": f"지원하지 않는 형식입니다: {ext}"}), 400
    out_name = f"upload_{secrets.token_hex(8)}{ext}"
    out_path = OUTPUT_DIR / out_name
    f.save(str(out_path))
    url = f"http://127.0.0.1:5000/api/canva/output/{out_name}"
    logger.info(f"[image/upload] 저장: {out_name}")
    return jsonify({"ok": True, "url": url})


@app.route("/api/image/create", methods=["POST"])
def image_create():
    """Pillow 브랜드 이미지 생성 (1080×1080 PNG)

    Body (JSON):
      type        — "a" | "b" | "c" | "d"   (필수)
      headline    — 헤드라인 텍스트           (필수)
      body_copy   — 본문 텍스트               (선택)
      type_label  — 타입 라벨 (예: "Type A") (선택)
      image       — 이미지 URL                (선택)
    """
    body       = request.get_json(silent=True) or {}
    tmpl_type  = (body.get("type") or "").lower().strip()
    headline   = (body.get("headline")   or "").strip()
    body_copy  = (body.get("body_copy")  or "").strip()
    type_label = (body.get("type_label") or "").strip()
    image_url  = (body.get("image")      or "").strip()

    if tmpl_type not in ("a", "b", "c", "d"):
        return jsonify({"error": "type은 a/b/c/d 중 하나여야 합니다."}), 400
    if not headline:
        return jsonify({"error": "headline 필드가 필요합니다."}), 400

    try:
        tmpl_path = TEMPLATES_DIR / f"template_{tmpl_type}.png"
        if tmpl_path.exists():
            logger.info(f"[image/create] 템플릿 사용: {tmpl_path.name}")
            result = _gen_with_template(tmpl_path, tmpl_type, headline, body_copy, type_label, image_url)
        else:
            gen = {"a": _gen_type_a, "b": _gen_type_b,
                   "c": _gen_type_c, "d": _gen_type_d}[tmpl_type]
            result = gen(headline, body_copy, type_label, image_url)
        out_name = f"brand_{tmpl_type}_{secrets.token_hex(6)}.png"
        out_path = OUTPUT_DIR / out_name
        result.save(str(out_path), "PNG")
        png_url = f"http://127.0.0.1:5000/api/canva/output/{out_name}"
        logger.info(f"[image/create] 완료: {png_url}")
        return jsonify({"ok": True, "type": tmpl_type, "png_url": png_url})
    except Exception as e:
        logger.exception("[image/create] error")
        return jsonify({"error": str(e)}), 500


@app.route("/api/canva/set-token", methods=["POST"])
def canva_set_token():
    """개발/테스트용: 액세스 토큰 직접 주입
    Body: {"access_token": "...", "expires_in": 3600}
    """
    body = request.get_json(silent=True) or {}
    token = body.get("access_token", "").strip()
    if not token:
        return jsonify({"error": "access_token 필드가 필요합니다."}), 400

    _canva_token.clear()
    _canva_token.update({
        "access_token":  token,
        "refresh_token": body.get("refresh_token", ""),
        "expires_in":    body.get("expires_in", 3600),
    })
    _save_canva_token(dict(_canva_token))
    logger.info("Canva 토큰 수동 설정 완료")
    return jsonify({"ok": True, "message": "토큰이 설정됐습니다. /api/canva/templates 로 테스트하세요."})


@app.route("/api/canva/test", methods=["GET"])
def canva_test():
    """Canva API 연결 전체 진단"""
    result = {
        "step1_client_id":    bool(CANVA_CLIENT_ID),
        "step2_client_secret": bool(CANVA_CLIENT_SECRET),
        "step3_token":        bool(_canva_token.get("access_token")),
        "step4_api_call":     None,
        "auth_url":           None,
    }

    # OAuth URL 생성
    if CANVA_CLIENT_ID:
        import secrets as _s, hashlib as _h, base64 as _b
        cv  = _s.token_urlsafe(64)[:128]
        cc  = _b.urlsafe_b64encode(_h.sha256(cv.encode()).digest()).rstrip(b"=").decode()
        st  = _s.token_urlsafe(32)
        _canva_oauth_states[st] = {"code_verifier": cv}
        result["auth_url"] = CANVA_AUTH_URL + "?" + urlencode({
            "client_id": CANVA_CLIENT_ID, "redirect_uri": CANVA_REDIRECT_URI,
            "response_type": "code", "scope": CANVA_SCOPES,
            "code_challenge": cc, "code_challenge_method": "S256", "state": st,
        })

    # 토큰 있으면 실제 API 호출 테스트
    if _canva_token.get("access_token"):
        try:
            r = req.get(
                f"{CANVA_API_BASE}/brand-templates",
                headers={"Authorization": f"Bearer {_canva_token['access_token']}"},
                params={"limit": "1"},
                timeout=10,
            )
            result["step4_api_call"] = {
                "status": r.status_code,
                "ok":     r.ok,
                "body":   r.json() if r.ok else r.text[:200],
            }
        except Exception as e:
            result["step4_api_call"] = {"error": str(e)}
    else:
        result["step4_api_call"] = "토큰 없음 — 먼저 auth_url로 인증하거나 /api/canva/set-token 으로 토큰 주입"

    all_ok = result["step1_client_id"] and result["step2_client_secret"]
    return jsonify({"status": "ok" if all_ok else "설정 필요", **result})


# ══════════════════════════════════════════════════════════════════════════════
# 오류 핸들러
# ══════════════════════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "엔드포인트를 찾을 수 없습니다.", "detail": str(e)}), 404
    return send_file(PROJECT_DIR / "index.html")

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "허용되지 않는 HTTP 메서드입니다.", "detail": str(e)}), 405

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "서버 내부 오류가 발생했습니다.", "detail": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# 실행
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    ytdlp_ok = _check_ytdlp()

    logger.info(f"InBody Marketing Tool — port {port}")
    logger.info(f"  텍스트 : OpenRouter ({OR_MODEL}) {'✓' if OPENROUTER_API_KEY else '✗ 키 없음'}")
    logger.info(f"  이미지 : Pollinations.ai ✓ (API 키 불필요)")
    logger.info(f"  영상   : yt-dlp {'✓' if ytdlp_ok else '✗ 미설치 → pip install yt-dlp'}")
    logger.info(f"  Canva  : {'✓ Client ID 설정됨' if CANVA_CLIENT_ID else '✗ CANVA_CLIENT_ID 없음'}")

    if not OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY가 없습니다. server/.env 파일에 키를 추가하세요.")
    if not ytdlp_ok:
        logger.warning("yt-dlp가 설치되어 있지 않습니다: pip install yt-dlp")

    app.run(host="0.0.0.0", port=port, debug=debug)
