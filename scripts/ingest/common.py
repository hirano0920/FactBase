"""共通処理: チャンク化・ハッシュ・ステージングファイル入出力。

パイプラインは2段階:
  fetch_*.py  → sources/staging/*.jsonl にチャンクを書き出す（API取得のみ、課金なし）
  embed_upsert.py → staging を読み、差分のみ embedding + DB upsert
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

STAGING_DIR = Path(__file__).resolve().parents[2] / "sources" / "staging"

MIN_CHUNK = 200
MAX_CHUNK = 600


@dataclass
class Chunk:
    law_id: str          # 法令番号 or 会議録ID
    law_name: str        # 法令名 or 「第X回国会 委員会名」
    article_ref: str | None  # 第X条 / 発言番号
    text: str
    source_url: str
    issue_slug: str | None   # 紐づける争点（任意）

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def split_long_text(text: str, max_len: int = MAX_CHUNK) -> list[str]:
    """長文を文境界（。）で max_len 以内に分割。"""
    if len(text) <= max_len:
        return [text]
    sentences = re.split(r"(?<=。)", text)
    parts: list[str] = []
    buf = ""
    for s in sentences:
        if len(buf) + len(s) > max_len and buf:
            parts.append(buf)
            buf = s
        else:
            buf += s
    if buf:
        parts.append(buf)
    return parts


def write_staging(name: str, chunks: list[Chunk]) -> Path:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    path = STAGING_DIR / f"{name}.jsonl"
    with path.open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps({**asdict(c), "hash": c.content_hash}, ensure_ascii=False) + "\n")
    return path


def read_all_staging() -> list[dict]:
    if not STAGING_DIR.exists():
        return []
    rows: list[dict] = []
    for path in sorted(STAGING_DIR.glob("*.jsonl")):
        with path.open(encoding="utf-8") as f:
            rows.extend(json.loads(line) for line in f if line.strip())
    return rows


def database_url() -> str:
    url = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL または DIRECT_URL を設定してください")
    # Prisma形式のURLはpsycopgでもそのまま使える（postgresql://）
    return url
