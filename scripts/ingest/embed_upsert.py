"""stagingのチャンクを差分のみembedding生成してNeon(pgvector)にupsertする。

- 既存チャンクとSHA256ハッシュ比較 → 変更なしはskip（embedding課金ゼロ）
- --issue-slug 指定チャンクは IssueEvidenceLink を pinned=true で張る
  （pinnedが無くてもEvidenceChunkはグローバル検索の対象になる＝リンクは必須ではない）
- 実行は冪等（何度実行しても壊れない）

使い方:
  DATABASE_URL=... OPENAI_API_KEY=... python embed_upsert.py
"""
from __future__ import annotations

import os
import uuid

import psycopg
from openai import OpenAI

from common import database_url, read_all_staging

EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 100


def embed_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    res = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [d.embedding for d in res.data]


def cuid_like() -> str:
    # Prismaのcuid()と衝突しない一意ID（形式は異なるが主キーとしては同等）
    return f"ing_{uuid.uuid4().hex}"


def main() -> None:
    rows = read_all_staging()
    if not rows:
        raise SystemExit("stagingが空です。先に fetch_egov.py / fetch_kokkai.py / fetch_manual.py を実行してください")

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ.get("OPENAI_BASE_URL"))
    conn = psycopg.connect(database_url())
    conn.autocommit = False
    cur = conn.cursor()

    # 既存チャンクのハッシュを取得（text本文のsha256をDB側で計算）
    cur.execute('SELECT id, "sourceId", encode(sha256(text::bytea), \'hex\') FROM "EvidenceChunk"')
    existing = {(source_id, h): chunk_id for chunk_id, source_id, h in cur.fetchall()}

    new_rows = [r for r in rows if (r["source_id"], r["hash"]) not in existing]
    skipped = len(rows) - len(new_rows)
    print(f"チャンク: 全{len(rows)}件 / 新規{len(new_rows)}件 / 変更なしskip {skipped}件")

    changed_source_ids: set[str] = set()

    inserted = 0
    for i in range(0, len(new_rows), BATCH_SIZE):
        batch = new_rows[i : i + BATCH_SIZE]
        embeddings = embed_batch(client, [r["text"] for r in batch])
        for row, emb in zip(batch, embeddings):
            chunk_id = cuid_like()
            cur.execute(
                """
                INSERT INTO "EvidenceChunk"
                  (id, "sourceType", "sourceId", "sourceName", "articleRef", text, "sourceUrl",
                   category, keywords, "isActive", embedding, "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::text[]::"IssueCategory"[], %s, true, %s::vector, now(), now())
                """,
                (
                    chunk_id,
                    row.get("source_type") or "LAW",
                    row["source_id"],
                    row["source_name"],
                    row["article_ref"],
                    row["text"],
                    row["source_url"],
                    row.get("category") or [],
                    row.get("keywords") or [],
                    str(emb),
                ),
            )
            if row.get("issue_slug"):
                cur.execute('SELECT id FROM "Issue" WHERE slug = %s', (row["issue_slug"],))
                issue = cur.fetchone()
                if issue:
                    cur.execute(
                        """
                        INSERT INTO "IssueEvidenceLink" (id, "issueId", "chunkId", pinned)
                        VALUES (%s, %s, %s, true)
                        ON CONFLICT ("issueId", "chunkId") DO UPDATE SET pinned = true
                        """,
                        (cuid_like(), issue[0], chunk_id),
                    )
                else:
                    print(f"  ⚠️ 争点 {row['issue_slug']} が未作成のためリンクをskip（記事生成後に再実行でOK）")
            inserted += 1
            changed_source_ids.add(row["source_id"])
        conn.commit()
        print(f"  {inserted}/{len(new_rows)} 投入済み")

    # 改正で消えた条文の無効化（廃止された条文を根拠にFCさせない）。
    # 会議録(kokkai_*)・手動投入(manual_*)は追記型なので対象外、法令はスナップショット型なので全量比較。
    egov_source_ids = {r["source_id"] for r in rows if r.get("source_type", "LAW") == "LAW"}
    for source_id in sorted(egov_source_ids):
        current_hashes = [r["hash"] for r in rows if r["source_id"] == source_id]
        cur.execute(
            """
            UPDATE "EvidenceChunk" SET "isActive" = false, "updatedAt" = now()
            WHERE "sourceId" = %s AND "isActive" = true
              AND encode(sha256(text::bytea), 'hex') != ALL(%s)
            """,
            (source_id, current_hashes),
        )
        if cur.rowcount:
            print(f"  {source_id}: 改正で消えた{cur.rowcount}チャンクを無効化")
            changed_source_ids.add(source_id)
    conn.commit()

    # 根拠が変わった争点のFCキャッシュを無効化（次のタップ時に最新根拠で再判定・¥0.01/件）
    if changed_source_ids:
        cur.execute(
            """
            DELETE FROM "FcCache"
            WHERE "commentId" IN (
              SELECT c.id FROM "Comment" c
              WHERE c."issueId" IN (
                SELECT DISTINCT iel."issueId"
                FROM "IssueEvidenceLink" iel
                JOIN "EvidenceChunk" ec ON ec.id = iel."chunkId"
                WHERE ec."sourceId" = ANY(%s)
              )
            )
            """,
            (sorted(changed_source_ids),),
        )
        if cur.rowcount:
            print(f"  根拠が更新されたためFCキャッシュ{cur.rowcount}件を無効化（次回タップで再判定）")
        conn.commit()

    conn.close()
    print(f"✅ 完了: 新規{inserted}件をembedding生成してDBに投入しました")


if __name__ == "__main__":
    main()
