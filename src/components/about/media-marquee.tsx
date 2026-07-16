/**
 * scripts/radar/feeds.json で実際に横断参照している媒体の一部を、2段の帯を逆方向に
 * 流して見せる（21st.dev の IntegrationHero を参考に、サイトの色トークンだけで再構成）。
 * 外部ロゴ画像は出典・ライセンスの扱いが曖昧になるため使わず、媒体名のバッジで表現する。
 */
const ROW1 = ["NHK", "朝日新聞", "毎日新聞", "共同通信", "時事通信", "TBS NEWS DIG", "東洋経済", "日経Asia", "文春オンライン", "BBC日本語"];
const ROW2 = [
  "Reuters",
  "BBC",
  "Bloomberg",
  "The Guardian",
  "Al Jazeera",
  "CNN",
  "AP",
  "Japan Times",
  "NPR",
  "Axios",
];

function MarqueeRow({ items, direction }: { items: string[]; direction: "left" | "right" }) {
  // ちょうど2回繰り返す。-50%地点で1周分ズレるので継ぎ目なくループする
  const doubled = [...items, ...items];
  return (
    <div className="flex overflow-hidden">
      <div
        className={`flex shrink-0 gap-3 pr-3 ${direction === "left" ? "animate-marquee-left" : "animate-marquee-right"}`}
      >
        {doubled.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="whitespace-nowrap rounded-full border border-border bg-surface-muted px-4 py-2 text-sm font-semibold text-ink-muted"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MediaMarquee() {
  return (
    <div className="relative">
      <div className="space-y-3">
        <MarqueeRow items={ROW1} direction="left" />
        <MarqueeRow items={ROW2} direction="right" />
      </div>
      {/* 左右の縁を背景色にフェードさせ、帯が画面端で唐突に切れないようにする */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-surface to-transparent sm:w-28" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-surface to-transparent sm:w-28" />
    </div>
  );
}
