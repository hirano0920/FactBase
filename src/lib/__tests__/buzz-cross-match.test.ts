import { describe, expect, it } from "vitest";
import {
  assembleBuzzScore,
  buzzMatchesSearchTerms,
  buzzMatchesTitleCorpus,
  buildBuzzAnchorCandidates,
  extractBuzzMatchTokens,
} from "@/lib/buzz-cross-match";
import type { BuzzSourceInputs } from "@/lib/radar";

describe("buzz-cross-match", () => {
  const sources: BuzzSourceInputs = {
    googleTerms: ["トランプ"],
    yahooRealtimeTerms: ["高市首相"],
    newsRankingTitles: ["高市首相、NATO首脳会議を欠席へ　トランプ氏との会合なく"],
    youtubeTrendingTitles: ["Trump NATO summit analysis — 日本の外交"],
  };

  it("見出しから争点アンカー語を抽出する", () => {
    const tokens = extractBuzzMatchTokens("高市首相、NATO首脳会議を欠席へ　トランプ氏との会合なく");
    expect(tokens).toContain("高市首相");
    expect(tokens.some((t) => /nato|トランプ/i.test(t))).toBe(true);
  });

  it("表記ゆれでも検索語ソースと一致する", () => {
    expect(buzzMatchesSearchTerms("高市首相のNATO欠席", ["高市首相"])).toBe(true);
    expect(buzzMatchesSearchTerms("トランプ大統領の関税政策", ["トランプ"])).toBe(true);
  });

  it("ニュースとYouTubeをアンカー語で横断一致する", () => {
    const hit = assembleBuzzScore("高市首相", sources);
    expect(hit.inNewsRanking).toBe(true);
    expect(hit.inYahooRealtime).toBe(true);
    expect(hit.score).toBeGreaterThanOrEqual(2);
    expect(hit.effectiveScore).toBeGreaterThanOrEqual(2);
  });

  it("ニュースクラスタ3件以上で effectiveScore +1（YouTubeなしでも promote 可能）", () => {
    const clusterNews = [
      "中国、新型SLBMを原潜から発射か　米国防総省",
      "中国の原潜ミサイル、太平洋到達能力に懸念",
      "米国防総省、中国の潜水艦発射弾道ミサイルを確認",
    ];
    const hit = assembleBuzzScore("中国 SLBM", {
      googleTerms: [],
      yahooRealtimeTerms: [],
      newsRankingTitles: clusterNews,
      youtubeTrendingTitles: [],
    });
    expect(hit.score).toBe(1);
    expect(hit.inNewsCluster).toBe(true);
    expect(hit.newsClusterCount).toBeGreaterThanOrEqual(3);
    expect(hit.effectiveScore).toBe(2);
  });

  it("複数見出しを争点アンカーに集約する", () => {
    const anchors = buildBuzzAnchorCandidates(
      [
        { term: "高市首相、NATO首脳会議を欠席", source: "yahoo_news" },
        { term: "「質問に対応する」高市首相、秘書の陳述書提出後も", source: "yahoo_news" },
        { term: "高市首相", source: "yahoo_rt", genre: "ニュース" },
      ],
      sources,
    );
    const takaichi = anchors.find((a) => a.anchor.includes("高市"));
    expect(takaichi).toBeDefined();
    expect(takaichi!.score).toBeGreaterThanOrEqual(2);
  });

  it("英字トピックは大文字小文字を無視してYouTubeと一致", () => {
    expect(buzzMatchesTitleCorpus("NATO", sources.youtubeTrendingTitles)).toBe(true);
  });
});
