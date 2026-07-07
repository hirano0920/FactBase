import { describe, expect, it } from "vitest";
import type { RadarCluster } from "../../../../src/lib/ai";
import { splitIncoherentPrimaryClusters } from "../split-clusters";

const baseCluster = (overrides: Partial<RadarCluster>): RadarCluster => ({
  title: "EU関連",
  member_indices: [0, 1],
  classification: "official",
  category: "international",
  risk_flags: [],
  question: "EU公式発表をどう見る？",
  choices: { for: "支持", against: "反対", undecided: "わからない" },
  match_issue_id: null,
  match_candidate_id: null,
  ...overrides,
});

describe("splitIncoherentPrimaryClusters", () => {
  const recent = [
    {
      feedName: "eu-commission",
      title: "Opening statement by Commissioner Dombrovskis on energy policy reform",
      url: "https://ec.europa.eu/commission/presscorner/detail/en/statement_24_1001",
    },
    {
      feedName: "eu-commission",
      title: "Speech by Commissioner Šuica at the Dubrovnik youth conference",
      url: "https://ec.europa.eu/commission/presscorner/detail/en/speech_24_2002",
    },
  ];

  it("無関係なEU声明2本は1クラスタにせず2つに分割", () => {
    const clusters = splitIncoherentPrimaryClusters([baseCluster({})], recent);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].member_indices).toEqual([0]);
    expect(clusters[1].member_indices).toEqual([1]);
    expect(clusters[0].match_issue_id).toBeNull();
  });

  it("同じ出来事の省庁見出し2本は分割しない", () => {
    const sameEventRecent = [
      {
        feedName: "kantei-news",
        title: "政府、新経済対策を閣議決定",
        url: "https://www.kantei.go.jp/jp/headline/2024/001.html",
      },
      {
        feedName: "kantei-news",
        title: "閣議決定、新経済対策パッケージを正式決定",
        url: "https://www.kantei.go.jp/jp/headline/2024/001.html",
      },
    ];
    const clusters = splitIncoherentPrimaryClusters(
      [baseCluster({ member_indices: [0, 1], title: "新経済対策" })],
      sameEventRecent,
    );
    expect(clusters).toHaveLength(1);
  });

  it("一次情報＋報道の混在クラスタは分割しない", () => {
    const mixedRecent = [
      { feedName: "eu-commission", title: "EU energy policy statement" },
      { feedName: "bbc-world", title: "EU unveils major energy policy shift" },
    ];
    const clusters = splitIncoherentPrimaryClusters([baseCluster({})], mixedRecent);
    expect(clusters).toHaveLength(1);
  });
});
