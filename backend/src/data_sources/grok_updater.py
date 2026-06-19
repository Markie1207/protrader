"""
grok_updater.py — Grok API 自動更新產業鏈資料
每日呼叫 xAI Grok，更新 key_theme / key_risk / market_size / growth_rate
公司結構（ticker / name / role / relationships）維持不變，防止 AI 亂改
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).parent.parent.parent / 'industry_map.json'
_GROK_URL  = 'https://api.x.ai/v1/chat/completions'
_MODEL     = os.getenv('GROK_MODEL', 'grok-3')
_BATCH     = 7   # 每次 API 呼叫幾條，控制 prompt 長度

# 記憶體快取（主進程共用）
_cache: dict = {}


# ─────────────────────────────────────────
# 公開介面
# ─────────────────────────────────────────

def load_data() -> dict:
    """從磁碟載入 industry_map.json 並更新快取"""
    global _cache
    try:
        with open(_DATA_PATH, encoding='utf-8') as f:
            _cache = json.load(f)
        log.info(f'[GrokUpdater] 載入 {len(_cache.get("industries", []))} 條產業鏈')
    except FileNotFoundError:
        log.error(f'[GrokUpdater] 找不到 {_DATA_PATH}')
        _cache = {'meta': {}, 'industries': []}
    return _cache


def get_data() -> dict:
    """取得快取中的最新資料（若未載入則先讀磁碟）"""
    if not _cache:
        load_data()
    return _cache


def run_update():
    """排程入口：分批呼叫 Grok，更新描述性欄位"""
    api_key = os.getenv('XAI_API_KEY', '').strip()
    if not api_key:
        log.warning('[GrokUpdater] XAI_API_KEY 未設定，略過本次更新')
        return

    data = get_data()
    industries = data.get('industries', [])
    if not industries:
        log.error('[GrokUpdater] 無產業鏈資料')
        return

    log.info(f'[GrokUpdater] 開始更新 {len(industries)} 條產業鏈（model={_MODEL}）')
    success = 0

    for i in range(0, len(industries), _BATCH):
        batch = industries[i : i + _BATCH]
        try:
            _update_batch(batch, api_key)
            success += len(batch)
            log.info(f'[GrokUpdater] 已更新 {success}/{len(industries)}')
        except Exception as e:
            log.error(f'[GrokUpdater] batch {i // _BATCH + 1} 失敗：{e}')

    data['meta']['generated_at'] = datetime.now().strftime('%Y-%m-%d')
    _save(data)
    log.info(f'[GrokUpdater] 完成，成功 {success}/{len(industries)} 條')


# ─────────────────────────────────────────
# 內部實作
# ─────────────────────────────────────────

def _update_batch(batch: list, api_key: str):
    """呼叫 Grok API，更新一批產業鏈的描述欄位"""
    chain_list = [
        {'id': c['id'], 'name': c['name'], 'category': c['category']}
        for c in batch
    ]

    prompt = (
        f'你是台股產業分析師。根據當前最新市況，為以下 {len(batch)} 條產業鏈更新 4 個欄位：\n'
        '- market_size：全球或台灣相關市場規模（一句話，含金額）\n'
        '- growth_rate：年增率預測（如 "YoY +25%"）\n'
        '- key_theme：目前最重要的投資主題（1-2 句，重點明確）\n'
        '- key_risk：主要風險（1-2 句）\n\n'
        '請直接回傳 JSON 陣列，不要任何說明或 markdown：\n'
        '[{"id":"...","market_size":"...","growth_rate":"...","key_theme":"...","key_risk":"..."}, ...]\n\n'
        f'產業鏈：\n{json.dumps(chain_list, ensure_ascii=False)}'
    )

    resp = requests.post(
        _GROK_URL,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        json={
            'model': _MODEL,
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.3,
            'max_tokens': 3000,
        },
        timeout=90,
    )
    resp.raise_for_status()

    text = resp.json()['choices'][0]['message']['content'].strip()
    # 去除可能的 ```json ... ``` 包裝
    if text.startswith('```'):
        lines = text.splitlines()
        text = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])

    updates: list = json.loads(text)
    update_map = {u['id']: u for u in updates if 'id' in u}

    for chain in batch:
        u = update_map.get(chain['id'])
        if not u:
            continue
        for field in ('market_size', 'growth_rate', 'key_theme', 'key_risk'):
            val = u.get(field, '').strip()
            if val:
                chain[field] = val


def _save(data: dict):
    """寫回磁碟並更新記憶體快取"""
    global _cache
    try:
        with open(_DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _cache = data
        log.info(f'[GrokUpdater] 已寫入 {_DATA_PATH}')
    except Exception as e:
        log.error(f'[GrokUpdater] 寫入失敗：{e}')
