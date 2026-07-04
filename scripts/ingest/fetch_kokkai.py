"""国会会議録検索API から争点キーワードに一致する発言を取得しstagingに書き出す。

使い方:
  python fetch_kokkai.py --keyword "消費税 減税" --from 2026-01-01 --issue-slug consumption-tax --max 50

API仕様: https://kokkai.ndl.go.jp/api.html （認証不要・JSON対応）
発言単位APIを使用。1リクエスト最大30件、ポライトに1秒間隔。
"""
from __future__ import annotations

import argparse
import time

import requests

from common import Chunk, split_long_text, write_staging

API_URL = "https://kokkai.ndl.go.jp/api/speech"


def fetch_speeches(keyword: str, date_from: str | None, max_records: int) -> list[dict]:
    speeches: list[dict] = []
    start = 1
    while len(speeches) < max_records:
        params: dict[str, str | int] = {
            "any": keyword,
            "recordPacking": "json",
            "maximumRecords": min(30, max_records - len(speeches)),
            "startRecord": start,
        }
        if date_from:
            params["from"] = date_from
        res = requests.get(API_URL, params=params, timeout=60)
        res.raise_for_status()
        data = res.json()
        records = data.get("speechRecord", [])
        if not records:
            break
        speeches.extend(records)
        next_pos = data.get("nextRecordPosition")
        if not next_pos:
            break
        start = next_pos
        time.sleep(1)  # 国立国会図書館のサーバーに配慮
    return speeches[:max_records]


def build_chunks(speeches: list[dict], keyword: str, issue_slug: str | None) -> list[Chunk]:
    chunks: list[Chunk] = []
    for sp in speeches:
        speaker = sp.get("speaker", "不明")
        group = sp.get("speakerGroup") or ""
        meeting = sp.get("nameOfMeeting", "")
        session = sp.get("session", "")
        date = sp.get("date", "")
        body = (sp.get("speech") or "").strip()
        url = sp.get("speechURL") or sp.get("meetingURL") or "https://kokkai.ndl.go.jp/"
        if len(body) < 80:  # 「はい」等の短い発言はFC根拠にならないので除外
            continue
        header = f"【{date} 第{session}回国会 {meeting} / {speaker}（{group}）の発言】"
        for i, part in enumerate(split_long_text(body)):
            chunks.append(
                Chunk(
                    law_id=f"kokkai_{keyword.replace(' ', '_')}",
                    law_name=f"国会会議録 {meeting}",
                    article_ref=f"{date} {speaker}" + (f" 続き{i}" if i else ""),
                    text=f"{header}{part}",
                    source_url=url,
                    issue_slug=issue_slug,
                )
            )
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", required=True)
    parser.add_argument("--from", dest="date_from", help="YYYY-MM-DD")
    parser.add_argument("--issue-slug")
    parser.add_argument("--max", type=int, default=50)
    args = parser.parse_args()

    print(f"国会会議録APIで「{args.keyword}」を検索中…")
    speeches = fetch_speeches(args.keyword, args.date_from, args.max)
    print(f"  発言: {len(speeches)}件取得")

    chunks = build_chunks(speeches, args.keyword, args.issue_slug)
    path = write_staging(f"kokkai_{args.keyword.replace(' ', '_')}", chunks)
    print(f"✅ {len(chunks)}チャンクを {path} に書き出しました")
    print("次: python embed_upsert.py で差分embedding + DB投入")


if __name__ == "__main__":
    main()
