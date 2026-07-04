"""週次自動更新オーケストレーター（GitHub Actionsから実行）。

設計原則: 変化がない週はAPIチェックのみでコスト¥0。
  1. registry.json の法令 → e-Gov APIで改正日時チェック → 変わった法令だけ再取得
  2. registry.json の国会キーワード → 前回取得日以降の新規発言のみ取得
     （閉会中は新規発言ゼロ = 自動的にコスト¥0。手動での停止操作は不要）
  3. embed_upsert を呼び、差分のみembedding（ハッシュ一致はskip）
  4. registry.json を更新（コミットはworkflow側）

使い方:
  DATABASE_URL=... OPENAI_API_KEY=... python refresh.py
  python refresh.py --dry-run   # 何が更新されるか表示のみ
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

import embed_upsert
from fetch_egov import (
    API_BASE as EGOV_API,
    build_chunks as egov_chunks,
    extract_articles,
    fetch_law_xml,
    resolve_law_id,
)
from fetch_kokkai import build_chunks as kokkai_chunks, fetch_speeches
from common import write_staging

REGISTRY_PATH = Path(__file__).resolve().parents[2] / "sources" / "registry.json"


def load_registry() -> dict:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def save_registry(registry: dict) -> None:
    REGISTRY_PATH.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def latest_revision(law_id: str) -> str | None:
    """e-Gov APIから法令の最終改正識別子を取得（本文は取得しない＝軽い）。"""
    try:
        res = requests.get(f"{EGOV_API}/laws", params={"law_id": law_id}, timeout=30)
        res.raise_for_status()
        laws = res.json().get("laws", [])
        if not laws:
            return None
        rev = laws[0].get("revision_info", {})
        return str(rev.get("amendment_promulgate_date") or rev.get("updated") or "")
    except requests.RequestException as e:
        print(f"  ⚠️ {law_id}: 改正チェック失敗 ({e})", file=sys.stderr)
        return None


def refresh_laws(registry: dict, dry_run: bool) -> bool:
    changed = False
    for entry in registry.get("laws", []):
        law_id = entry.get("law_id")
        if not law_id and entry.get("law_title"):
            law_id = resolve_law_id(entry["law_title"])
            if not law_id:
                print(f"  ⚠️ {entry['law_title']}: law_idを解決できませんでした（skip）")
                continue
            entry["law_id"] = law_id  # 次回以降は解決済みIDを再利用
        current = latest_revision(law_id)
        if current is None:
            continue
        if current == entry.get("last_revision"):
            print(f"  {entry['name']}: 改正なし（skip・¥0）")
            continue

        print(f"  {entry['name']}: 改正検出 → 再取得")
        changed = True
        if dry_run:
            continue
        root = fetch_law_xml(law_id)
        law_name, articles = extract_articles(root)
        chunks = egov_chunks(
            law_id, law_name, articles, entry.get("issue_slug"),
            entry.get("category", []), entry.get("keywords", []),
        )
        write_staging(f"egov_{law_id}", chunks)
        entry["last_revision"] = current
    return changed


def refresh_kokkai(registry: dict, dry_run: bool) -> bool:
    changed = False
    for entry in registry.get("kokkai_keywords", []):
        if not entry.get("active", True):
            continue
        keyword = entry["keyword"]
        # 前回取得日の翌日から。初回は直近90日
        last = entry.get("last_fetched")
        date_from = last or (date.today() - timedelta(days=90)).isoformat()

        speeches = fetch_speeches(keyword, date_from, max_records=100)
        if not speeches:
            print(f"  「{keyword}」: 新規発言なし（skip・¥0）")
            continue

        print(f"  「{keyword}」: 新規発言 {len(speeches)}件")
        changed = True
        if dry_run:
            continue
        chunks = kokkai_chunks(
            speeches, keyword, entry.get("issue_slug"),
            entry.get("category", []), entry.get("keywords", []),
        )
        write_staging(f"kokkai_{keyword.replace(' ', '_')}_{date.today().isoformat()}", chunks)
        entry["last_fetched"] = date.today().isoformat()
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    registry = load_registry()

    print("1/3 法令の改正チェック…")
    laws_changed = refresh_laws(registry, args.dry_run)

    print("2/3 国会会議録の新規発言チェック…")
    kokkai_changed = refresh_kokkai(registry, args.dry_run)

    if args.dry_run:
        print("dry-run完了")
        return

    if laws_changed or kokkai_changed:
        print("3/3 差分embedding + DB投入…")
        embed_upsert.main()
    else:
        print("3/3 変更なし — embedding生成もDB書き込みもなし（今週のコスト: ¥0）")

    save_registry(registry)
    print("✅ refresh完了")


if __name__ == "__main__":
    main()
