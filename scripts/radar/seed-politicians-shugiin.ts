/**
 * 衆議院公式サイトの会派別議員名簿から全議員をPoliticianテーブルに一括投入する。
 * https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/kaiha_m.htm
 *
 * 参議院（seed-politicians-sangiin.ts）と違い、衆議院は50音順の単一名簿ページが
 * 見つからなかった（scripts/radar/sources/diet-votes.tsのコメント通り、投票結果と
 * 同じ理由で見送っていた）。実際には「会派名簿」（党ごとのページ）が規則的な構造で
 * 存在しており、党一覧ページ→各党のページ、の2段階で全件を辿れる（オーナー発見のURLで確認済み）。
 *
 * 実行: npx tsx scripts/radar/seed-politicians-shugiin.ts [--dry-run]
 */
import { prisma } from "../../src/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const PARTY_LIST_URL =
  "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/kaiha_m.htm";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

interface ShugiinMember {
  name: string;
  party: string;
  district: string;
}

/** 全角スペース区切りの姓名を1つの半角スペースに正規化し、末尾の敬称(君/さん)を除く */
function normalizeName(raw: string): string {
  return raw
    .replace(/(君|さん)\s*$/, "")
    .replace(/[　\s]+/g, " ")
    .trim();
}

async function fetchShiftJisHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("shift_jis").decode(buf);
}

/** 党一覧ページから「党名 + 議員一覧ページURL」の組を抽出する */
function parsePartyLinks(html: string, baseUrl: string): { party: string; url: string }[] {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];
  const parties: { party: string; url: string }[] = [];
  for (const row of rows) {
    const cellMatch = row.match(/<td[^>]*class="kaiha"[^>]*>[\s\S]*?<a\s+href\s*=\s*['"]?([^'">\s]+)['"]?>([\s\S]*?)<\/a>/i);
    if (!cellMatch) continue;
    const url = new URL(cellMatch[1], baseUrl).toString();
    const party = cellMatch[2].replace(/<[^>]+>/g, "").trim();
    if (party) parties.push({ party, url });
  }
  return parties;
}

/** 1党分の議員一覧テーブルをパースする（氏名+プロフィールリンク・選挙区の列を持つ表） */
function parseMemberTable(html: string, party: string): ShugiinMember[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const members: ShugiinMember[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 3) continue;
    const nameMatch = cells[0].match(/<a[^>]*href\s*=\s*['"]?([^'">\s]+profile\/\d+\.html)['"]?[^>]*>([\s\S]*?)<\/a>/i);
    if (!nameMatch) continue; // 見出し行・議員プロフィールへのリンクが無い行はスキップ
    const name = normalizeName(nameMatch[2].replace(/<[^>]+>/g, ""));
    const district = cells[2]?.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim() ?? "";
    if (name.length >= 2) members.push({ name, party, district });
  }
  return members;
}

async function main() {
  console.log(`🏛️ seed-politicians-shugiin 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const partyListHtml = await fetchShiftJisHtml(PARTY_LIST_URL);
  const parties = parsePartyLinks(partyListHtml, PARTY_LIST_URL);
  console.log(`  会派 ${parties.length}件検出: ${parties.map((p) => p.party).join("、")}`);
  if (parties.length === 0) {
    throw new Error("会派一覧を抽出できなかった。ページ構造が変わっている可能性がある");
  }

  const allMembers: ShugiinMember[] = [];
  for (const p of parties) {
    const html = await fetchShiftJisHtml(p.url);
    const members = parseMemberTable(html, p.party);
    console.log(`    ${p.party}: ${members.length}名`);
    allMembers.push(...members);
  }

  console.log(`  合計抽出 ${allMembers.length}名`);
  if (allMembers.length < 300) {
    // 衆議院は465名。会派をまたいだ抽出漏れが無ければ400名は超えるはずなので、
    // 大きく下回るならパーサが一部の党ページで失敗している可能性が高い
    throw new Error(
      `抽出数が異常に少ない（${allMembers.length}名）。ページ構造が変わっている可能性があるためパーサの見直しが必要`,
    );
  }

  let created = 0;
  let updated = 0;
  for (const m of allMembers) {
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

  console.log(`\n🏛️ seed-politicians-shugiin 完了: 新規${created}件 / 更新${updated}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
