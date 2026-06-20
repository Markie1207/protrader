"""
github_storage.py — 透過 GitHub API 持久化存儲 JSON 檔案

解決 Railway ephemeral filesystem 問題：
將 industry_map.json / industry_map_draft.json commit 回 GitHub，
讓 Railway 重啟後能從 GitHub 取回最新版本。

必要環境變數：
  GITHUB_TOKEN  — Personal Access Token（repo 或 contents 寫入權限）
  GITHUB_REPO   — 倉庫路徑，如 markie856123/protrader
選用環境變數：
  GITHUB_BRANCH — 目標分支（預設 main）
"""

import base64
import logging
import os

import requests

log = logging.getLogger(__name__)

_API_BASE = 'https://api.github.com'
_TIMEOUT = 15


def is_configured() -> bool:
    """確認必要環境變數是否已設定"""
    return bool(os.getenv('GITHUB_TOKEN') and os.getenv('GITHUB_REPO'))


def _headers() -> dict:
    return {
        'Authorization': f'token {os.getenv("GITHUB_TOKEN")}',
        'Accept': 'application/vnd.github.v3+json',
    }


def _branch() -> str:
    return os.getenv('GITHUB_BRANCH', 'main')


def _get_sha(path_in_repo: str) -> str | None:
    """取得檔案的 blob SHA（PUT 時更新既有檔案需要）"""
    repo = os.getenv('GITHUB_REPO')
    try:
        resp = requests.get(
            f'{_API_BASE}/repos/{repo}/contents/{path_in_repo}',
            headers=_headers(),
            params={'ref': _branch()},
            timeout=_TIMEOUT,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json().get('sha')
    except Exception:
        return None


def fetch_file(path_in_repo: str) -> str | None:
    """
    從 GitHub 取得檔案內容（UTF-8 字串）。
    找不到或失敗回傳 None。
    """
    if not is_configured():
        return None
    repo = os.getenv('GITHUB_REPO')
    try:
        resp = requests.get(
            f'{_API_BASE}/repos/{repo}/contents/{path_in_repo}',
            headers=_headers(),
            params={'ref': _branch()},
            timeout=_TIMEOUT,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        raw = resp.json().get('content', '').replace('\n', '')
        return base64.b64decode(raw).decode('utf-8')
    except Exception as e:
        log.error(f'[GitHub] fetch {path_in_repo} 失敗：{e}')
        return None


def commit_file(path_in_repo: str, content: str, message: str) -> bool:
    """
    建立或更新 GitHub 上的檔案。
    成功回傳 True，失敗回傳 False（不拋例外，不阻塞主流程）。
    """
    if not is_configured():
        return False
    repo = os.getenv('GITHUB_REPO')
    sha = _get_sha(path_in_repo)
    body: dict = {
        'message': message,
        'content': base64.b64encode(content.encode('utf-8')).decode('ascii'),
        'branch': _branch(),
    }
    if sha:
        body['sha'] = sha
    try:
        resp = requests.put(
            f'{_API_BASE}/repos/{repo}/contents/{path_in_repo}',
            headers=_headers(),
            json=body,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        log.info(f'[GitHub] commit {path_in_repo} 成功')
        return True
    except Exception as e:
        log.error(f'[GitHub] commit {path_in_repo} 失敗：{e}')
        return False


def test_connection() -> dict:
    """
    測試 GitHub API 連線：commit 一個測試檔再刪除，回傳詳細結果。
    """
    if not is_configured():
        missing = []
        if not os.getenv('GITHUB_TOKEN'):
            missing.append('GITHUB_TOKEN')
        if not os.getenv('GITHUB_REPO'):
            missing.append('GITHUB_REPO')
        return {'ok': False, 'error': f'環境變數未設定：{", ".join(missing)}'}

    test_path = '.protrader_github_test'
    test_content = '{"test": true}'
    try:
        ok = commit_file(test_path, test_content, '[ProTrader] GitHub 連線測試（可忽略）')
        if not ok:
            return {'ok': False, 'error': 'commit 失敗，請確認 GITHUB_TOKEN 有 repo 寫入權限'}
        delete_file(test_path, '[ProTrader] 刪除 GitHub 連線測試檔')
        return {
            'ok': True,
            'repo': os.getenv('GITHUB_REPO'),
            'branch': _branch(),
            'message': 'commit + delete 測試成功',
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def delete_file(path_in_repo: str, message: str) -> bool:
    """
    從 GitHub 刪除檔案。
    檔案不存在視為成功，失敗回傳 False。
    """
    if not is_configured():
        return False
    repo = os.getenv('GITHUB_REPO')
    sha = _get_sha(path_in_repo)
    if not sha:
        return True  # 已不存在
    try:
        resp = requests.delete(
            f'{_API_BASE}/repos/{repo}/contents/{path_in_repo}',
            headers=_headers(),
            json={'message': message, 'sha': sha, 'branch': _branch()},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        log.info(f'[GitHub] 刪除 {path_in_repo} 成功')
        return True
    except Exception as e:
        log.error(f'[GitHub] 刪除 {path_in_repo} 失敗：{e}')
        return False
