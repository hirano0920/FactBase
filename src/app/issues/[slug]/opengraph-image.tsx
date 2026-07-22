import { ImageResponse } from "next/og";
import { getIssueBySlug, isDbEnabled } from "@/lib/data";
import { getVoteSwing } from "@/lib/vote-swing";
import { SITE } from "@/lib/constants";

export const runtime = "nodejs";
export const alt = "争点の要約";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** 表示テキストに必要なグリフだけGoogle Fontsからサブセット取得 */
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@600&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(url)).text();
    const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype|woff)'\)/);
    if (!match) return null;
    const res = await fetch(match[1]);
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);

  // shareTitle（自分ごとフック）優先。無ければ中立な投票設問（title）にフォールバック
  const title = issue?.shareTitle || issue?.title || SITE.name;
  const lead = issue?.summary.lead ?? SITE.tagline;
  const tally = issue?.voteTally;

  // スイングカード: 直近数時間の「揺れ」があればOG画像の主役にする。
  // 「今、空気が動いている」瞬間のスクリーンショット自体が煽りゼロで拡散される設計（戦略§3.4）
  const swing = issue && isDbEnabled() ? await getVoteSwing(issue.id) : null;
  const swingCallout = (() => {
    if (!swing) return null;
    const sides = [
      { label: issue?.voteLabels?.for ?? "賛成", delta: swing.deltaPoints.for, color: "#3D6B4F" },
      { label: issue?.voteLabels?.against ?? "反対", delta: swing.deltaPoints.against, color: "#8B4A4A" },
    ];
    const top = sides.sort((a, b) => b.delta - a.delta)[0];
    if (top.delta < 0.5) return null;
    return {
      text: `直近${swing.hoursAgo}時間で「${top.label}」へ +${top.delta}pt`,
      color: top.color,
      sub: `新しい投票 ${swing.newVotes}件`,
    };
  })();

  const textForFont = `${title}${lead}${SITE.name}${SITE.tagline}${swingCallout ? `${swingCallout.text}${swingCallout.sub}` : ""}賛成反対わからない直近時間で新しい投票件%0123456789.+「」`;
  const fontData = await loadFont(textForFont);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#FAFAF8",
          padding: 64,
          fontFamily: fontData ? "NotoSansJP" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, color: "#6B6B6B", marginBottom: 24 }}>
            {SITE.name} — {SITE.tagline}
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 600,
              color: "#1A1A1A",
              lineHeight: 1.3,
            }}
          >
            {title.slice(0, 40)}
          </div>
          <div
            style={{
              fontSize: 26,
              color: "#6B6B6B",
              marginTop: 24,
              lineHeight: 1.6,
            }}
          >
            {lead.slice(0, 80)}
          </div>
        </div>

        {tally && tally.totalVotes > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {swingCallout && (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                <span style={{ fontSize: 34, fontWeight: 600, color: swingCallout.color }}>
                  {swingCallout.text}
                </span>
                <span style={{ fontSize: 22, color: "#6B6B6B" }}>{swingCallout.sub}</span>
              </div>
            )}
            <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ width: `${tally.percents.for}%`, backgroundColor: "#3D6B4F" }} />
              <div style={{ width: `${tally.percents.against}%`, backgroundColor: "#8B4A4A" }} />
              <div style={{ width: `${tally.percents.undecided}%`, backgroundColor: "#B8B5B0" }} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 16,
                fontSize: 24,
                color: "#2C3E50",
              }}
            >
              <span>賛成 {tally.percents.for}%</span>
              <span>反対 {tally.percents.against}%</span>
              <span>わからない {tally.percents.undecided}%</span>
            </div>
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: fontData
        ? [{ name: "NotoSansJP", data: fontData, weight: 600 as const, style: "normal" as const }]
        : undefined,
    },
  );
}
