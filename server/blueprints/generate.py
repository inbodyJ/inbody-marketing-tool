"""
generate.py — /api/generate-* routes + /api/health
"""

import re
import base64
from urllib.parse import quote

import requests as req
from flask import Blueprint, request, jsonify

from config import call_openrouter, parse_json_safe, size_preset_to_dimensions, logger, OPENROUTER_API_KEY, OR_MODEL, _check_ytdlp, CANVA_CLIENT_ID

generate_bp = Blueprint("generate", __name__, url_prefix="/api")

# ══════════════════════════════════════════════════════════════════════════════
# 시스템 프롬프트 상수
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


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/health — 서비스 연결 상태
# ══════════════════════════════════════════════════════════════════════════════

@generate_bp.route("/health", methods=["GET"])
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
# Pollinations.ai 헬퍼
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


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/generate-prompt — 이미지 프롬프트 생성
# ══════════════════════════════════════════════════════════════════════════════

@generate_bp.route("/generate-prompt", methods=["POST"])
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

@generate_bp.route("/generate-copy", methods=["POST"])
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

@generate_bp.route("/generate-image", methods=["POST"])
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
# POST /api/generate-blog — 블로그 글 생성
# ══════════════════════════════════════════════════════════════════════════════

@generate_bp.route("/generate-blog", methods=["POST"])
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
