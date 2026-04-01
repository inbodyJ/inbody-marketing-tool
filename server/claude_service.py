import anthropic
import os
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

BRAND_CONTEXT = """
InBody는 체성분분석 전문 글로벌 헬스케어 기업입니다.
브랜드 컬러: InBody Red (#971B2F), Dark Gray (#4B4F5A), Black (#101820)
서체: Pretendard / Noto Sans KR
핵심 메시지: 정확한 체성분 측정으로 건강한 삶을 지원
"""

def generate_blog(product, target, keywords):
    prompt = f"""
{BRAND_CONTEXT}
아래 조건으로 네이버 블로그 글을 작성해주세요.
- 제품: {product}
- 타겟: {target}
- 키워드: {keywords}
- 분량: 2,500자 이상
- 구조: 도입부 → 본문(소제목 3개) → 마무리 CTA
- SEO: 키워드 자연스럽게 포함, 네이버 최적화
"""
    return _call_claude(prompt)

def generate_sns(product, target, market, tone):
    prompt = f"""
{BRAND_CONTEXT}
아래 조건으로 인스타그램 포스트 카피를 작성해주세요.
- 제품: {product}
- 타겟 시장: {market} ({target})
- 톤: {tone}
- 언어: {'Australian English' if 'AU' in market else '한국어'}
- 결과: 헤드라인 / 본문(3줄) / 해시태그 5개 형식으로
"""
    return _call_claude(prompt)

def generate_ppt_content(product, target, market):
    prompt = f"""
{BRAND_CONTEXT}
아래 조건으로 B2B 제안서 슬라이드 내용을 JSON 배열로 만들어주세요.
- 제품: {product} / 타겟: {target} / 시장: {market}
- 반드시 아래 슬라이드 타입만 사용하고, JSON 배열만 출력 (다른 텍스트 없이)

슬라이드 구성 (순서대로 7장):
1. {{"type":"cover", "title":"제품명 제안서", "subtitle":"타겟 설명", "author":"InBody", "dept":"Global Sales"}}
2. {{"type":"section", "part":1, "title":"섹션 제목", "subtitle":"간단 설명"}}
3. {{"type":"text", "number":1, "title":"문제 정의", "subtitle":"소제목", "body":["항목1","항목2","항목3"]}}
4. {{"type":"bullets", "number":2, "title":"솔루션", "subtitle":"소제목", "body":["카드1 설명","카드2 설명","카드3 설명"]}}
5. {{"type":"text", "number":3, "title":"주요 기능", "subtitle":"소제목", "body":["항목1","항목2","항목3"]}}
6. {{"type":"bullets", "number":4, "title":"기대 효과", "subtitle":"소제목", "body":["카드1 설명","카드2 설명","카드3 설명"]}}
7. {{"type":"thank", "contact":"inbody.com  |  info@inbody.com"}}

- body 리스트는 각 항목을 한 문장으로 간결하게
- 언어: {'Australian English' if 'AU' in market else '한국어'}
"""
    return _call_claude(prompt)

def _call_claude(prompt):
    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )
    return message.content[0].text
