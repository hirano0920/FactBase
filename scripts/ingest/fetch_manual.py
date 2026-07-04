"""条約・歴史文書など公式APIが無いソース向けの手動投入ツール。

法令・国会会議録と違い、条約DB(外務省等)にはクリーンなAPIがないため、
人間が公式原文をテキストファイルとして用意し、このスクリプトに渡す。
AIは「本文の生成」は一切行わず、chunk分割の提案のみ行う（法令と同じ厳格さ）。

使い方:
  python fetch_manual.py \
    --source ./sources/manual/nihonkoku-kenpo.txt \
    --source-name "日本国憲法" \
    --source-url "https://laws.e-gov.go.jp/law/321CONSTITUTION" \
    --source-type HISTORICAL_DOC \
    --category POLITICS LAW \
    --keywords 憲法 基本的人権 平和主義
"""
from __future__ import annotations

import argparse
import os

from openai import OpenAI

from common import Chunk, write_staging

PROPOSE_MODEL = "gpt-5-nano"


def propose_chunks(client: OpenAI, source_text: str) -> list[dict]:
    res = client.chat.completions.create(
        model=os.environ.get("RADAR_CLASSIFY_MODEL") or PROPOSE_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "あなたは公式文書の整理係です。与えられた一次情報（条約・歴史文書等）を、"
                    "ファクトチェックの根拠に使える200〜600字のチャンクに分割してください。"
                    "本文を書き換えたり要約したりせず、原文をそのまま分割すること。"
                    '条項番号・前文等の参照があれば article_ref に入れる。JSONのみ: '
                    '{"chunks": [{"article_ref": "第X条" | "前文" | null, "text": "原文そのまま"}]}'
                ),
            },
            {"role": "user", "content": source_text[:30_000]},
        ],
    )
    import json

    parsed = json.loads(res.choices[0].message.content or "{}")
    return parsed.get("chunks", [])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="原文テキストファイルのパス")
    parser.add_argument("--source-name", required=True, help="表示名（例: 日本国憲法）")
    parser.add_argument("--source-url", required=True, help="出典URL")
    parser.add_argument("--source-type", required=True, choices=["TREATY", "HISTORICAL_DOC"])
    parser.add_argument("--category", nargs="*", default=[], help="IssueCategory値")
    parser.add_argument("--keywords", nargs="*", default=[], help="検索補助キーワード")
    parser.add_argument("--source-id", help="省略時は--source-nameから生成")
    args = parser.parse_args()

    with open(args.source, encoding="utf-8") as f:
        source_text = f.read()

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ.get("OPENAI_BASE_URL"))

    print("nanoでチャンク分割を提案中…")
    chunks_raw = propose_chunks(client, source_text)
    print(f"\n提案されたチャンク: {len(chunks_raw)}件")
    for i, c in enumerate(chunks_raw):
        print(f"  [{i}] {c.get('article_ref') or '(参照なし)'} — {c['text'][:60]}…")

    approve = input("\nこのチャンクで進めますか？ 原文と一致しているか必ず確認すること (y/n): ")
    if approve.strip().lower() != "y":
        print("中止しました")
        return

    source_id = args.source_id or args.source_name.replace(" ", "_")
    chunks = [
        Chunk(
            source_id=source_id,
            source_name=args.source_name,
            source_type=args.source_type,
            article_ref=c.get("article_ref"),
            text=c["text"],
            source_url=args.source_url,
            category=args.category,
            keywords=args.keywords,
            issue_slug=None,
        )
        for c in chunks_raw
    ]
    path = write_staging(f"manual_{source_id}", chunks)
    print(f"✅ {len(chunks)}チャンクを {path} に書き出しました")
    print("次: python embed_upsert.py で差分embedding + DB投入")


if __name__ == "__main__":
    main()
