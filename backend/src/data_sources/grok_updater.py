"""
grok_updater.py — Gemini API 自動更新產業鏈資料

兩種更新模式：
  A. 描述更新（每日）：只改 key_theme / key_risk / market_size / growth_rate
  B. 完整更新（每週）：補公司清單、新增鏈 → 存為草稿，需人工審核後套用
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import requests

from src.data_sources import github_storage

log = logging.getLogger(__name__)

_DATA_PATH  = Path(__file__).parent.parent.parent / 'industry_map.json'
_DRAFT_PATH = Path(__file__).parent.parent.parent / 'industry_map_draft.json'
# GitHub 上的對應路徑（根目錄，供 Vercel 靜態服務）
_REPO_JSON_PATH  = 'industry_map.json'
_REPO_DRAFT_PATH = 'industry_map_draft.json'
# Gemini OpenAI-compatible 端點（描述更新 / 公司更新用）
_AI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
_MODEL  = os.getenv('GEMINI_MODEL', 'gemini-3.1-flash-lite')
# Gemini native API（Google Search grounding 用）
_NATIVE_URL   = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
_SEARCH_MODEL = os.getenv('GEMINI_SEARCH_MODEL', 'gemini-2.5-flash-lite')
_THEMES_PATH  = Path(__file__).parent.parent.parent / 'industry_themes.json'
_BATCH_DESC = 7   # 描述更新每批幾條
_BATCH_CO   = 4   # 公司更新每批幾條（內容更多，批次縮小）

_cache: dict = {}


# ══════════════════════════════════════════
# 公開介面
# ══════════════════════════════════════════

def load_data() -> dict:
    """從 GitHub（優先）或本地磁碟載入 industry_map.json 並更新快取"""
    global _cache
    # 優先從 GitHub 取最新版本，解決 Railway 重啟後本地檔案過舊的問題
    try:
        content = github_storage.fetch_file(_REPO_JSON_PATH)
        if content:
            data = json.loads(content)
            with open(_DATA_PATH, 'w', encoding='utf-8') as f:
                f.write(content)
            _cache = data
            log.info(f'[Gemini] 從 GitHub 載入 {len(_cache.get("industries", []))} 條產業鏈')
            _restore_draft_from_github()
            return _cache
    except Exception as e:
        log.warning(f'[Gemini] GitHub 載入失敗，改用本地檔案：{e}')

    # Fallback：本地檔案
    try:
        with open(_DATA_PATH, encoding='utf-8') as f:
            _cache = json.load(f)
        log.info(f'[Gemini] 從本地載入 {len(_cache.get("industries", []))} 條產業鏈')
    except FileNotFoundError:
        log.error(f'[Gemini] 找不到 {_DATA_PATH}')
        _cache = {'meta': {}, 'industries': []}
    return _cache


def _restore_draft_from_github():
    """啟動時從 GitHub 還原草稿，避免 Railway 重啟後草稿消失"""
    if _DRAFT_PATH.exists():
        return  # 本地已有草稿，不覆蓋
    try:
        content = github_storage.fetch_file(_REPO_DRAFT_PATH)
        if content:
            with open(_DRAFT_PATH, 'w', encoding='utf-8') as f:
                f.write(content)
            log.info('[Gemini] 從 GitHub 還原草稿')
    except Exception as e:
        log.warning(f'[Gemini] 草稿還原失敗：{e}')


def get_data() -> dict:
    """取得記憶體快取（未載入則先讀磁碟）"""
    if not _cache:
        load_data()
    return _cache


def get_draft_status() -> dict:
    """回傳草稿狀態"""
    if not _DRAFT_PATH.exists():
        return {'has_draft': False}
    try:
        with open(_DRAFT_PATH, encoding='utf-8') as f:
            draft = json.load(f)
        meta = draft.get('meta', {})
        return {
            'has_draft': True,
            'generated_at': meta.get('draft_generated_at', ''),
            'total_industries': len(draft.get('industries', [])),
            'note': meta.get('draft_note', ''),
        }
    except Exception:
        return {'has_draft': False}


def get_draft_data() -> dict | None:
    """回傳完整草稿資料"""
    if not _DRAFT_PATH.exists():
        return None
    try:
        with open(_DRAFT_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def approve_draft() -> bool:
    """套用草稿：草稿 → 正式資料，並同步到 GitHub"""
    draft = get_draft_data()
    if not draft:
        return False
    try:
        draft['meta']['generated_at'] = datetime.now().strftime('%Y-%m-%d')
        draft['meta'].pop('draft_generated_at', None)
        draft['meta'].pop('draft_note', None)
        _save_live(draft)  # 寫本地 + commit industry_map.json 到 GitHub
        _DRAFT_PATH.unlink(missing_ok=True)
        github_storage.delete_file(_REPO_DRAFT_PATH, '[ProTrader] 草稿已套用，移除草稿檔')
        log.info('[Gemini] 草稿已套用')
        return True
    except Exception as e:
        log.error(f'[Gemini] 套用草稿失敗：{e}')
        return False


def reject_draft() -> bool:
    """捨棄草稿（本地 + GitHub）"""
    try:
        _DRAFT_PATH.unlink(missing_ok=True)
        github_storage.delete_file(_REPO_DRAFT_PATH, '[ProTrader] 草稿已捨棄')
        log.info('[Gemini] 草稿已捨棄')
        return True
    except Exception:
        return False


# ──────────────────────────────────────────
# A. 每日描述更新（直接覆蓋，風險低）
# ──────────────────────────────────────────

def run_update_descriptions():
    """排程：每日呼叫 Grok 更新描述性欄位（直接生效）"""
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        log.warning('[Gemini] GEMINI_API_KEY 未設定，略過描述更新')
        return

    data = get_data()
    industries = data.get('industries', [])
    if not industries:
        return

    log.info(f'[Gemini] 開始描述更新，共 {len(industries)} 條')
    success = 0
    for i in range(0, len(industries), _BATCH_DESC):
        batch = industries[i: i + _BATCH_DESC]
        try:
            _update_descriptions_batch(batch, api_key)
            success += len(batch)
        except Exception as e:
            log.error(f'[Gemini] 描述更新 batch {i//_BATCH_DESC+1} 失敗：{e}')

    data['meta']['generated_at'] = datetime.now().strftime('%Y-%m-%d')
    _save_live(data)
    log.info(f'[Gemini] 描述更新完成：{success}/{len(industries)} 條')


def _update_descriptions_batch(batch: list, api_key: str):
    chain_list = [{'id': c['id'], 'name': c['name'], 'category': c['category']} for c in batch]
    prompt = (
        f'你是台股產業分析師。根據最新市況，為以下 {len(batch)} 條產業鏈更新 4 個欄位：\n'
        '- market_size：市場規模（一句，含金額）\n'
        '- growth_rate：年增率（如 "YoY +25%"）\n'
        '- key_theme：最重要投資主題（1-2 句）\n'
        '- key_risk：主要風險（1-2 句）\n\n'
        '直接回傳 JSON 陣列，不要 markdown 或說明：\n'
        '[{"id":"...","market_size":"...","growth_rate":"...","key_theme":"...","key_risk":"..."}, ...]\n\n'
        f'產業鏈：{json.dumps(chain_list, ensure_ascii=False)}'
    )
    text = _call_ai(prompt, api_key, max_tokens=2500)
    updates = json.loads(_strip_md(text))
    update_map = {u['id']: u for u in updates if 'id' in u}
    for chain in batch:
        u = update_map.get(chain['id'])
        if not u:
            continue
        for field in ('market_size', 'growth_rate', 'key_theme', 'key_risk'):
            val = str(u.get(field, '')).strip()
            if val:
                chain[field] = val


# ──────────────────────────────────────────
# B. 每週公司清單更新（存為草稿，需審核）
# ──────────────────────────────────────────

def run_update_companies():
    """排程：每週呼叫 Grok 更新公司清單並新增缺少的產業鏈，存為草稿"""
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        log.warning('[Gemini] GEMINI_API_KEY 未設定，略過公司更新')
        return

    data = get_data()
    industries = list(data.get('industries', []))   # 複本，不動 live

    import copy
    draft_industries = copy.deepcopy(industries)

    log.info(f'[Gemini] 開始公司更新，共 {len(draft_industries)} 條')
    success = 0
    for i in range(0, len(draft_industries), _BATCH_CO):
        batch = draft_industries[i: i + _BATCH_CO]
        try:
            _update_companies_batch(batch, api_key)
            success += len(batch)
            log.info(f'[Gemini] 公司更新進度 {success}/{len(draft_industries)}')
        except Exception as e:
            log.error(f'[Gemini] 公司更新 batch {i//_BATCH_CO+1} 失敗：{e}')

    # 詢問 Grok 是否有缺少的重要產業鏈
    try:
        new_chains = _suggest_new_chains(draft_industries, api_key)
        if new_chains:
            draft_industries.extend(new_chains)
            log.info(f'[Gemini] 新增 {len(new_chains)} 條新產業鏈')
    except Exception as e:
        log.error(f'[Gemini] 新增產業鏈失敗：{e}')

    # 只有至少一批成功才存草稿，避免存入全為原始資料的假草稿
    if success == 0:
        log.error('[Gemini] 公司更新：所有批次均失敗，不產生草稿')
        return

    # 存為草稿
    draft = copy.deepcopy(data)
    draft['industries'] = draft_industries
    draft['meta']['draft_generated_at'] = datetime.now().strftime('%Y-%m-%d %H:%M')
    draft['meta']['draft_note'] = (
        f'Grok 公司更新草稿，共 {len(draft_industries)} 條產業鏈'
        f'（成功更新 {success}/{len(industries)} 條）'
    )
    draft['meta']['total_industries'] = len(draft_industries)

    try:
        content = json.dumps(draft, ensure_ascii=False, indent=2)
        with open(_DRAFT_PATH, 'w', encoding='utf-8') as f:
            f.write(content)
        # 同步草稿到 GitHub，防止 Railway 重啟後遺失
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M')
        github_storage.commit_file(
            _REPO_DRAFT_PATH,
            content,
            f'[ProTrader] Gemini 週更新草稿 {now_str}（{success}/{len(industries)} 條）',
        )
        log.info(f'[Gemini] 草稿已儲存：{_DRAFT_PATH}，成功 {success}/{len(industries)} 條')
    except Exception as e:
        log.error(f'[Gemini] 草稿儲存失敗：{e}')


def _update_companies_batch(batch: list, api_key: str):
    """請 Grok 審核並補強一批產業鏈的公司清單"""
    prompt = f"""你是台股產業鏈分析師。請審核並補強以下 {len(batch)} 條產業鏈的公司清單。

任務：
1. 補充遺漏的重要台股公司到 upstream/midstream/downstream
2. 修正錯誤的公司角色描述
3. 可刪除不相關或已下市的公司
4. 同時更新 market_size / growth_rate / key_theme / key_risk

台股 ticker 規則（重要！）：
- 台股代碼為 4 位數字字串，如 "2330"
- 若不確定某公司的正確代碼，ticker 設為 null，不要猜測
- 外國公司（美/日/韓）ticker 一律設為 null
- 每個 upstream/midstream/downstream 各保持 2-6 家，不要過多

回傳格式：JSON 陣列（與輸入格式完全相同，包含所有欄位）
只回傳 JSON，不要任何說明或 markdown。

現有資料：
{json.dumps(batch, ensure_ascii=False, indent=2)}"""

    text = _call_ai(prompt, api_key, max_tokens=4000)
    updated = json.loads(_strip_md(text))

    if not isinstance(updated, list) or len(updated) != len(batch):
        raise ValueError(f'回傳筆數不符：期望 {len(batch)}，實得 {len(updated) if isinstance(updated, list) else "非陣列"}')

    for i, chain in enumerate(batch):
        u = updated[i]
        if u.get('id') != chain.get('id'):
            log.warning(f'[Gemini] id 不符：{chain.get("id")} vs {u.get("id")}，略過')
            continue
        for field in ('upstream', 'midstream', 'downstream', 'relationships',
                      'market_size', 'growth_rate', 'key_theme', 'key_risk'):
            if field in u:
                chain[field] = u[field]


def _suggest_new_chains(existing: list, api_key: str) -> list:
    """請 Grok 建議目前缺少的重要產業鏈"""
    existing_names = [c['name'] for c in existing]
    categories = list({c['category'] for c in existing})

    prompt = f"""你是台股產業鏈分析師。目前已有以下 {len(existing_names)} 條產業鏈：
{json.dumps(existing_names, ensure_ascii=False)}

分類：{json.dumps(categories, ensure_ascii=False)}

請建議 3-8 條目前市場上重要但清單中缺少的台灣相關產業鏈（例如：玻璃基板、CoWoS-R、CoPos、ABF 載板替代等）。

每條鏈請提供完整資料，格式與現有資料相同：
{{
  "id": "snake_case_id",
  "name": "中文名稱",
  "emoji": "適合的 emoji",
  "category": "從現有分類中選一個",
  "market_size": "市場規模描述",
  "growth_rate": "YoY 成長率",
  "key_theme": "投資主題",
  "key_risk": "主要風險",
  "upstream": [{{"ticker": "台股4碼或null", "name": "公司名", "role": "角色"}}],
  "midstream": [...],
  "downstream": [...],
  "relationships": [{{"from": "公司名", "to": "公司名", "type": "關係"}}]
}}

台股 ticker 若不確定請設 null。只回傳 JSON 陣列，不要說明。"""

    text = _call_ai(prompt, api_key, max_tokens=4000)
    result = json.loads(_strip_md(text))
    if not isinstance(result, list):
        return []
    # 基本驗證：必須有 id 和 name
    return [c for c in result if c.get('id') and c.get('name')]


# ──────────────────────────────────────────
# 內部工具
# ──────────────────────────────────────────

def _call_ai(prompt: str, api_key: str, max_tokens: int = 3000) -> str:
    resp = requests.post(
        _AI_URL,
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        json={
            'model': _MODEL,
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.2,
            'max_tokens': max_tokens,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()['choices'][0]['message']['content'].strip()


def _strip_md(text: str) -> str:
    """去除可能的 ```json ... ``` 包裝"""
    if text.startswith('```'):
        lines = text.splitlines()
        start = 1 if lines[0].startswith('```') else 0
        end = -1 if lines[-1] == '```' else len(lines)
        text = '\n'.join(lines[start:end])
    return text.strip()


# ──────────────────────────────────────────
# Google Search Grounding（native Gemini API）
# ──────────────────────────────────────────

def _call_ai_with_search(prompt: str, api_key: str, max_tokens: int = 3000) -> tuple[str, list]:
    """
    呼叫 Gemini native API + Google Search grounding。
    回傳 (text, sources)，sources 為搜尋來源清單。
    """
    url = _NATIVE_URL.format(model=_SEARCH_MODEL)
    resp = requests.post(
        url,
        params={'key': api_key},
        json={
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'tools': [{'google_search': {}}],
            'generationConfig': {
                'temperature': 0.3,
                'maxOutputTokens': max_tokens,
            },
        },
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    candidate = data['candidates'][0]
    text = ''.join(p.get('text', '') for p in candidate['content']['parts'])
    sources = []
    for chunk in candidate.get('groundingMetadata', {}).get('groundingChunks', []):
        web = chunk.get('web', {})
        if web.get('uri'):
            sources.append({'title': web.get('title', ''), 'url': web['uri']})
    return text.strip(), sources


def test_search_connection() -> dict:
    """測試 Google Search grounding 連線，回傳詳細結果"""
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        return {'ok': False, 'error': 'GEMINI_API_KEY 未設定', 'model': _SEARCH_MODEL}
    try:
        now_str = datetime.now().strftime('%Y年%m月')
        text, sources = _call_ai_with_search(
            f'搜尋 {now_str} 台股最熱門的一個投資題材，用一句話回答。',
            api_key,
            max_tokens=200,
        )
        return {
            'ok': True,
            'model': _SEARCH_MODEL,
            'reply': text[:300],
            'sources_count': len(sources),
            'sources': sources[:3],
        }
    except Exception as e:
        return {'ok': False, 'model': _SEARCH_MODEL, 'error': str(e)}


def run_discover_themes() -> dict | None:
    """
    使用 Google Search grounding 搜尋最新台股熱門題材。
    回傳建議清單並儲存到 industry_themes.json。
    """
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        log.warning('[Gemini+Search] GEMINI_API_KEY 未設定')
        return None

    data = get_data()
    existing_names = [c['name'] for c in data.get('industries', [])]
    now_str = datetime.now().strftime('%Y年%m月')

    prompt = f"""請搜尋 {now_str} 台灣股市最新熱門的投資題材與新興產業鏈。

已有的產業鏈（不需重複建議）：
{json.dumps(existing_names, ensure_ascii=False)}

根據最新新聞與市場動態，建議 3-5 條目前最受資金關注但清單中沒有的台股產業鏈。

直接回傳 JSON 陣列，不要 markdown 或說明：
[
  {{
    "id": "snake_case_id",
    "name": "產業鏈中文名稱",
    "emoji": "適合的 emoji",
    "category": "從這些選一個：AI/算力, 半導體, 被動元件, 散熱, 電池/儲能, 電源, 系統整機, 機器人, 電動車/能源, 通訊, 消費電子, 其他",
    "why_hot": "根據最新新聞說明熱門原因（一句話）",
    "market_size": "市場規模描述",
    "growth_rate": "YoY 成長率",
    "key_theme": "投資主題（1-2 句）",
    "key_risk": "主要風險（1-2 句）",
    "upstream": [{{"ticker": "台股4碼或null", "name": "公司名", "role": "角色"}}],
    "midstream": [{{"ticker": "台股4碼或null", "name": "公司名", "role": "角色"}}],
    "downstream": [{{"ticker": "台股4碼或null", "name": "公司名", "role": "角色"}}],
    "relationships": []
  }}
]"""

    try:
        text, sources = _call_ai_with_search(prompt, api_key, max_tokens=4000)
        chains = json.loads(_strip_md(text))
        if not isinstance(chains, list):
            raise ValueError('回傳不是 JSON 陣列')
        chains = [c for c in chains if c.get('id') and c.get('name')]

        result = {
            'chains': chains,
            'sources': sources[:10],
            'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
            'model': _SEARCH_MODEL,
        }

        # 儲存到本地
        with open(_THEMES_PATH, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        log.info(f'[Gemini+Search] 發現 {len(chains)} 條熱門題材，來源 {len(sources)} 則')
        return result
    except Exception as e:
        log.error(f'[Gemini+Search] 題材發現失敗：{e}')
        return None


def get_themes() -> dict | None:
    """取得最近一次 discover_themes 的結果"""
    if not _THEMES_PATH.exists():
        return None
    try:
        with open(_THEMES_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def apply_themes_to_draft(chain_ids: list[str]) -> dict:
    """
    將 themes 結果中選定的產業鏈加入草稿。
    若草稿已存在則追加，否則以當前正式資料為基底建立新草稿。
    回傳 {'ok': bool, 'added': int, 'total': int}
    """
    import copy

    themes = get_themes()
    if not themes:
        return {'ok': False, 'error': '尚未執行 discover-themes，找不到題材資料'}

    # 從 themes 中篩選指定 ID
    selected = [c for c in themes.get('chains', []) if c.get('id') in chain_ids]
    if not selected:
        return {'ok': False, 'error': f'找不到指定的產業鏈 ID：{chain_ids}'}

    # 取得草稿（若存在）或以正式資料為基底
    draft = get_draft_data()
    if draft:
        base = copy.deepcopy(draft)
    else:
        base = copy.deepcopy(get_data())

    # 避免重複加入（以 id 判斷）
    existing_ids = {c['id'] for c in base.get('industries', [])}
    to_add = [c for c in selected if c.get('id') not in existing_ids]

    if not to_add:
        return {'ok': False, 'error': '選定的產業鏈已存在於草稿或正式資料中'}

    base.setdefault('industries', []).extend(to_add)
    base.setdefault('meta', {})
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M')
    base['meta']['draft_generated_at'] = now_str
    base['meta']['draft_note'] = (
        f'加入 {len(to_add)} 條 Grounding 搜尋題材：'
        f'{", ".join(c["name"] for c in to_add)}'
    )
    base['meta']['total_industries'] = len(base['industries'])

    try:
        content = json.dumps(base, ensure_ascii=False, indent=2)
        with open(_DRAFT_PATH, 'w', encoding='utf-8') as f:
            f.write(content)
        github_storage.commit_file(
            _REPO_DRAFT_PATH,
            content,
            f'[ProTrader] 加入 Grounding 題材草稿 {now_str}',
        )
        log.info(f'[Gemini+Search] 已將 {len(to_add)} 條題材加入草稿')
        return {'ok': True, 'added': len(to_add), 'total': len(base['industries']),
                'chains': [c['name'] for c in to_add]}
    except Exception as e:
        log.error(f'[Gemini+Search] 加入草稿失敗：{e}')
        return {'ok': False, 'error': str(e)}


def _save_live(data: dict):
    """寫回正式資料、更新快取，並 commit industry_map.json 到 GitHub"""
    global _cache
    try:
        content = json.dumps(data, ensure_ascii=False, indent=2)
        with open(_DATA_PATH, 'w', encoding='utf-8') as f:
            f.write(content)
        _cache = data
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M')
        github_storage.commit_file(
            _REPO_JSON_PATH,
            content,
            f'[ProTrader] Gemini 自動更新產業鏈資料 {now_str}',
        )
    except Exception as e:
        log.error(f'[Gemini] 寫入失敗：{e}')


def test_connection() -> dict:
    """同步測試 Grok 連線，回傳詳細結果（供診斷用）"""
    api_key = os.getenv('GEMINI_API_KEY', '').strip()
    if not api_key:
        return {'ok': False, 'error': 'GEMINI_API_KEY 未設定', 'model': _MODEL}
    try:
        resp = requests.post(
            _AI_URL,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': _MODEL,
                'messages': [{'role': 'user', 'content': '請用一句話介紹台積電，直接回答。'}],
                'temperature': 0.1,
                'max_tokens': 80,
            },
            timeout=30,
        )
        if resp.status_code == 200:
            content = resp.json()['choices'][0]['message']['content'].strip()
            return {'ok': True, 'model': _MODEL, 'reply': content}
        else:
            return {'ok': False, 'model': _MODEL,
                    'status_code': resp.status_code, 'error': resp.text[:500]}
    except Exception as e:
        return {'ok': False, 'model': _MODEL, 'error': str(e)}


# 向下相容：原本 run_update() 維持描述更新
run_update = run_update_descriptions
