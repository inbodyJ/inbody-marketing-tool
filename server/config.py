"""
config.py — InBody Marketing Tool shared configuration
"""

import os
import re
import json
import logging
import shutil
import sys
from pathlib import Path

import requests as req
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

# ─── 파일 경로 ────────────────────────────────────────────────────────────────
COOKIES_FILE = SERVER_DIR / "cookies.txt"
OUTPUT_DIR   = SERVER_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


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


def size_preset_to_dimensions(preset: str) -> tuple:
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


def _ytdlp_cmd() -> list:
    """yt-dlp 실행 명령 — PATH에 없으면 python -m yt_dlp 사용"""
    if shutil.which("yt-dlp"):
        return ["yt-dlp"]
    return [sys.executable, "-m", "yt_dlp"]


_ytdlp_available = None   # 캐시 (최초 1회만 확인)

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
