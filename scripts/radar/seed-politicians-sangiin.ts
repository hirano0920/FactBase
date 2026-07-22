/**
 * 参議院公式サイトの議員名簿（50音順）から全議員をPoliticianテーブルに一括投入する。
 * https://www.sangiin.go.jp/japanese/joho1/kousei/giin/giin.htm
 *
 * 衆議院は同等の規則的な公開ページが見つからなかったため対応していない
 * （scripts/radar/sources/diet-votes.tsの投票結果スクレイピングが既に同じ理由で
 * 参議院のみに絞っている、と同種の制約）。衆議院分は既存の自動タグ付け
 * （tagPoliticiansFromDietVote等）による自然増、または将来的なCSV手動投入に委ねる。
 *
 * 名簿ページのURLは会期ごとに末尾の数字（例: /221/giin.htm）が変わるため固定リンクを使わず、
 * 基点URL（giin.htm）が返すJSリダイレクト先を都度読み取ってから本体を取得する。
 *
 * 実行: npx tsx scripts/radar/seed-politicians-sangiin.ts [--dry-run]
 */
import { prisma } from "../../src/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const BASE_URL = "https://www.sangiin.go.jp/japanese/joho1/kousei/giin/current/giin.htm";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

interface SangiinMember {
  name: string;
  party: string;
  district: string;
}

/** 全角スペース区切りの姓名を1つの半角スペースに正規化する（例:「青木　　　愛」→「青木 愛」） */
function normalizeName(raw: string): string {
  return raw.replace(/[　\s]+/g, " ").trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** giin.htmはJSリダイレクトのみのページ。location.replace("...")の遷移先を抜き出す */
function extractRedirectTarget(html: string): string | null {
  const m = html.match(/location\.replace\(["']([^"']+)["']\)/);
  return m ? m[1] : null;
}

/**
 * 議員一覧テーブルをパースする。
 * ページには2つの<table>があり、1つ目は「あ行/か行/…」のかな見出しジャンプナビ
 * （実測でこれが混入し「あ行」を氏名として誤取込みするバグを起こした）。
 * summary="議員一覧（50音順）"を持つ本体テーブルだけを対象範囲に絞り、
 * さらに各行が実在の議員プロフィールへのリンク（../profile/数字.htm）を持つことを
 * 必須条件にする（かな見出し行・余分な行を二重に弾く）。
 */
function parseMemberTable(html: string): SangiinMember[] {
  const tableMatch = html.match(/<table[^>]*summary="議員一覧[^"]*"[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];

  const rows = tableHtml.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const members: SangiinMember[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 4) continue; // 見出し行(th)や余分な行をスキップ
    const nameCell = cells[0];
    const nameMatch = nameCell.match(/<a[^>]*href="([^"]*profile\/\d+\.htm)"[^>]*>([\s\S]*?)<\/a>/);
    if (!nameMatch) continue; // 議員プロフィールへのリンクが無い行は本体データではない
    const name = normalizeName(nameMatch[2].replace(/<[^>]+>/g, ""));
    const party = cells[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const district = cells[3]?.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim() ?? "";
    if (name.length >= 2 && party) members.push({ name, party, district });
  }
  return members;
}

async function main() {
  console.log(`🏛️ seed-politicians-sangiin 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const landing = await fetchHtml(BASE_URL);
  const redirectPath = extractRedirectTarget(landing);
  const targetUrl = redirectPath
    ? new URL(redirectPath, BASE_URL).toString()
    : BASE_URL; // リダイレクトが無ければ（構造変更等）そのまま本体扱いを試す

  console.log(`  名簿ページ: ${targetUrl}`);
  const html = await fetchHtml(targetUrl);
  const members = parseMemberTable(html);
  console.log(`  抽出 ${members.length}名`);

  if (members.length < 100) {
    // 参議院は242〜248名程度。大きく下回るならページ構造が変わってパース失敗している可能性が高く、
    // 誤った少数データで上書きするより明示的に止める
    throw new Error(
      `抽出数が異常に少ない（${members.length}名）。ページ構造が変わっている可能性があるためパーサの見直しが必要`,
    );
  }

  let created = 0;
  let updated = 0;
  for (const m of members) {
    if (DRY_RUN) {
      created++;
      continue;
    }
    const existing = await prisma.politician.findUnique({ where: { slug: m.name }, select: { id: true } });
    await prisma.politician.upsert({
      where: { slug: m.name },
      create: { slug: m.name, name: m.name, party: m.party, electoralDistrict: m.district || null },
      update: { party: m.party, electoralDistrict: m.district || null },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(`\n🏛️ seed-politicians-sangiin 完了: 新規${created}件 / 更新${updated}件`);
  console.log("  ⚠️ 衆議院は未対応（規則的な公開名簿ページが見つからなかったため）。既存の自動タグ付けによる自然増のみ");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
