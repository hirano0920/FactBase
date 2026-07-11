import { ImageResponse } from "next/og";
import { getIssueBySlug } from "@/lib/data";
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

  const textForFont = `${title}${lead}${SITE.name}${SITE.tagline}賛成反対わからない%0123456789.`;
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
