"""e-Gov法令API v2 から法令本文を取得し、条単位でチャンク化してstagingに書き出す。

使い方:
  python fetch_egov.py --law-title 消費税法 --category ECONOMY FINANCE --keywords 消費税 増税 減税
  python fetch_egov.py --law-id 363AC0000000108 --category ECONOMY   # IDが分かっている場合
  python fetch_egov.py --check-updates   # 取り込み済み法令の更新確認のみ（週次cron用）

API仕様: https://laws.e-gov.go.jp/apitop/ （法令API v2、認証不要）
法令名から law_id を引く場合は GET /laws?law_title=... の完全一致（law_type=Act優先）を使う。
記憶からlaw_idを決め打ちしない（誤ったIDによる誤情報混入を防ぐ）。
"""
from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET

import requests

from common import Chunk, split_long_text, write_staging, read_all_staging

API_BASE = "https://laws.e-gov.go.jp/api/2"


def resolve_law_id(title: str) -> str | None:
    """法令名から law_id を検索。完全一致するActを優先し、無ければ最初の完全一致を返す。"""
    res = requests.get(f"{API_BASE}/laws", params={"law_title": title}, timeout=30)
    res.raise_for_status()
    laws = res.json().get("laws", [])
    exact = [
        law for law in laws
        if law.get("revision_info", {}).get("law_title") == title
    ]
    candidates = exact or laws
    if not candidates:
        return None
    # Act（法律）を政令・省令より優先
    acts = [law for law in candidates if law.get("law_info", {}).get("law_type") == "Act"]
    chosen = (acts or candidates)[0]
    return chosen.get("law_info", {}).get("law_id")


def fetch_law_xml(law_id: str) -> ET.Element:
    res = requests.get(
        f"{API_BASE}/law_data/{law_id}",
        params={"law_full_text_format": "xml"},
        headers={"Accept": "application/xml"},
        timeout=60,
    )
    res.raise_for_status()
    return ET.fromstring(res.content)


def element_text(el: ET.Element) -> str:
    return re.sub(r"\s+", "", "".join(el.itertext()))


def extract_articles(root: ET.Element) -> tuple[str, list[tuple[str, str]]]:
    """(法令名, [(条番号, 本文)]) を返す。"""
    name_el = root.find(".//LawTitle")
    law_name = element_text(name_el) if name_el is not None else "不明な法令"

    articles: list[tuple[str, str]] = []
    for art in root.iter("Article"):
        num = art.get("Num", "")
        title_el = art.find("ArticleTitle")
        ref = element_text(title_el) if title_el is not None else f"第{num}条"
        body = "".join(
            element_text(p) for p in art.iter("Paragraph")
        )
        if body:
            articles.append((ref, body))
    return law_name, articles


def build_chunks(
    law_id: str,
    law_name: str,
    articles: list[tuple[str, str]],
    issue_slug: str | None,
    category: list[str] | None = None,
    keywords: list[str] | None = None,
) -> list[Chunk]:
    source_url = f"https://laws.e-gov.go.jp/law/{law_id}"
    chunks: list[Chunk] = []
    for ref, body in articles:
        for i, part in enumerate(split_long_text(body)):
            chunks.append(
                Chunk(
                    source_id=law_id,
                    source_name=law_name,
                    source_type="LAW",
                    article_ref=ref if i == 0 else f"{ref}（続き{i}）",
                    text=f"{law_name} {ref}: {part}",
                    source_url=source_url,
                    category=category,
                    keywords=keywords,
                    issue_slug=issue_slug,
                )
            )
    return chunks


def check_updates() -> None:
    """staging済み法令の改正有無をAPIの更新日で確認（embedding再生成はしない）。"""
    law_ids = sorted({r["source_id"] for r in read_all_staging() if r.get("source_type", "LAW") == "LAW"})
    if not law_ids:
        print("取り込み済み法令がありません")
        return
    for law_id in law_ids:
        try:
            res = requests.get(f"{API_BASE}/laws", params={"law_id": law_id}, timeout=30)
            res.raise_for_status()
            info = res.json()
            revs = info.get("laws", [{}])[0].get("revision_info", {})
            print(f"{law_id}: 最終更新 {revs.get('updated', '不明')} — 改正があれば fetch_egov.py --law-id で再取得")
        except requests.RequestException as e:
            print(f"{law_id}: 確認失敗 ({e})", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--law-id", help="法令番号（例: 363AC0000000108 = 消費税法）。--law-titleがあれば無視される")
    parser.add_argument("--law-title", help="法令名（例: 消費税法）。e-Gov APIで法令IDを自動解決する")
    parser.add_argument("--issue-slug", help="紐づける争点slug（指定するとpinned=trueでリンク）")
    parser.add_argument("--category", nargs="*", default=[], help="IssueCategory値（例: ECONOMY FINANCE）")
    parser.add_argument("--keywords", nargs="*", default=[], help="検索補助キーワード")
    parser.add_argument("--check-updates", action="store_true")
    args = parser.parse_args()

    if args.check_updates:
        check_updates()
        return

    law_id = args.law_id
    if args.law_title:
        print(f"e-Gov APIで法令名「{args.law_title}」を検索中…")
        law_id = resolve_law_id(args.law_title)
        if not law_id:
            parser.error(f"法令名「{args.law_title}」に一致する法令が見つかりませんでした")
        print(f"  → law_id={law_id}")
    if not law_id:
        parser.error("--law-id または --law-title が必要です")

    print(f"e-Gov API から {law_id} を取得中…")
    root = fetch_law_xml(law_id)
    law_name, articles = extract_articles(root)
    print(f"  法令名: {law_name} / 条文: {len(articles)}件")

    chunks = build_chunks(law_id, law_name, articles, args.issue_slug, args.category, args.keywords)
    path = write_staging(f"egov_{law_id}", chunks)
    print(f"✅ {len(chunks)}チャンクを {path} に書き出しました")
    print("次: python embed_upsert.py で差分embedding + DB投入")


if __name__ == "__main__":
    main()
