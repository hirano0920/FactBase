/**
 * 一回限りのダミー記事投入スクリプト（佐藤二朗さんハラスメント報道・声明対立型）。
 * 実サムネイル(ORICONのog:image)を直接参照し、実際の複数媒体の報道内容に基づいて中立に要約。
 */
import { prisma } from "../src/lib/prisma";

const SLUG = "sato-jiro-harassment-allegation-2026";

const SOURCES = [
  { label: "ORICON NEWS", url: "https://www.oricon.co.jp/news/2465364/full/" },
  {
    label: "文春オンライン",
    url: "https://bunshun.jp/articles/-/90026",
  },
  {
    label: "東洋経済オンライン",
    url: "https://toyokeizai.net/articles/-/950437",
  },
  {
    label: "NEWSポストセブン",
    url: "https://www.news-postseven.com/archives/20260707_2119655.html",
  },
];

const ARTICLE_HTML = `<h2>いま何が論点か</h2>
<p>週刊文春が2026年7月1日に速報、9日発売号で詳報した、俳優・佐藤二朗さんと女優・橋本愛さんの間のトラブルを巡る報道です。両者は2026年4月放送のフジテレビ系ドラマ「夫婦別姓刑事」で共演していました。佐藤さん本人はSNSで報道内容を「完全に創作している」と全面否定しており、事実関係を巡って報道側と本人側の主張が真っ向から対立しています。</p>
<h2>各社は何を伝えているか</h2>
<ul>
<li><strong>週刊文春:</strong> 撮影中の身体的接触と、相手の楽屋を訪れた際にキャリアに関する否定的な発言があったと報じた</li>
<li><strong>フジテレビ:</strong> 佐藤さんに厳重注意し再発防止を求めたと説明。問題視したのは撮影中の接触そのものではなく、橋本さんが体調に配慮した対応を必要とするようになった後の発言だとした</li>
<li><strong>東スポ・東洋経済等:</strong> 報道を受けた佐藤さんの態度の変化や、フジテレビの対応を疑問視する業界の反応を伝えている</li>
</ul>
<h2>どこで意見が分かれるか</h2>
<ul>
<li><strong>週刊文春・報道側:</strong> 複数の関係者取材に基づく報道であり、内容は事実だとする立場</li>
<li><strong>佐藤二朗さん本人・所属事務所:</strong> 報道内容は虚偽・捏造であり、専門家の確認でもハラスメントに当たらないとする立場</li>
</ul>
<h2>佐藤二朗さん側が言うこと</h2>
<ul>
<li>SNSで「嘘はやめて下さい」「完全に創作してる」と、報道内容を明確に否定</li>
<li>事務所は「事実と異なる内容が含まれる」とコメントを発表</li>
<li>専門家の見解として、指摘された行為がハラスメントの定義に該当しないとの説明があるとする</li>
</ul>
<h2>報道内容・橋本愛さん周辺が示すこと</h2>
<ul>
<li>週刊文春が複数の関係者取材をもとに、撮影中の接触と楽屋での発言を報道</li>
<li>橋本さんが体調面で撮影に配慮を要する状態になったとされる</li>
<li>フジテレビが佐藤さんへの厳重注意という形で、発言面について一定の問題を認める対応を取った</li>
</ul>
<h2>まだ分からないこと</h2>
<ul>
<li>接触・発言の詳細な経緯や具体的な言葉の内容は、報道側と本人側で食い違ったまま確定していない</li>
<li>フジテレビの厳重注意がどの行為を対象にしたものか、公式に詳細は明らかにされていない</li>
</ul>
<h2>出典</h2>
<ul>
${SOURCES.map((s) => `<li><a href="${s.url}">${s.label}</a></li>`).join("\n")}
</ul>`;

async function main() {
  const issue = await prisma.issue.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      title: "佐藤二朗さんのハラスメント報道、本人は「完全に創作」と全面否定",
      shareTitle: "佐藤二朗「嘘はやめて」報道否定、橋本愛さんとの間に何が",
      category: "ENTERTAINMENT",
      status: "ACTIVE",
      confirmation: "REPORTED",
      debateType: "declaration",
      keywords: ["佐藤二朗", "橋本愛", "ハラスメント", "フジテレビ", "週刊文春"],
      thumbnailUrl:
        "https://contents.oricon.co.jp/upimg/news/2466000/2465364/20260702_132753_p_o_42908125.jpg",
      thumbnailSourceUrl: "https://www.oricon.co.jp/news/2465364/full/",
      thumbnailSourceFeed: "ORICON NEWS",
      voteLabelsJson: {
        for: "本人・事務所の説明を支持",
        against: "週刊文春の報道を支持",
        undecided: "わからない",
      },
      summaryJson: {
        lead:
          "俳優・佐藤二朗さんと女優・橋本愛さんを巡るハラスメント疑惑を週刊文春が報道。佐藤さんは「完全に創作」と全面否定し、事実関係を巡って双方の主張が対立しています。",
        bullets: [
          "いま分かっていること: 2026年4月放送のドラマ共演時のトラブルを週刊文春が報道。フジテレビは佐藤さんに厳重注意済み",
          "佐藤二朗さん側: 報道内容は事実と異なる捏造だとして全面否定",
          "週刊文春・報道側: 複数の関係者取材に基づく報道であり内容は事実だとする立場",
        ],
        sources: SOURCES,
      },
      articleHtml: ARTICLE_HTML,
      articleGeneratedAt: new Date(),
    },
  });

  console.log(`Seeded issue: ${issue.slug} (id=${issue.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
