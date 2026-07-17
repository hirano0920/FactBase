import { composeVoteQuestion } from "./src/lib/ai.ts";

// ①賛否そのもの(org_response)
const r1 = await composeVoteQuestion({
  issueTitle: "高市政権の決定",
  lead: "高市政権は物価高対策として給付金の追加支給を決定したと発表しました。財源は国債発行で賄うとしています。",
  bullets: [
    "いま分かっていること: 政府は追加給付金の支給を閣議決定した",
    "支持する側: 物価高への即効性ある対策だと評価",
    "問題視する側: 財源が国債頼みで将来世代への負担だと批判",
  ],
  debateType: "org_response",
  fallbackQuestion: "高市政権の対応は妥当ですか？",
  fallbackChoices: { for: "対応を支持", against: "問題視", undecided: "どちらとも言えない" },
});
console.log("①賛否:", r1);

// ②責任・帰属の当事者比較(geopolitics)
const r2 = await composeVoteQuestion({
  issueTitle: "貿易摩擦の責任論",
  lead: "米国と中国の貿易交渉が決裂し、トランプ大統領と習近平主席がそれぞれ相手側に責任があると主張しています。",
  bullets: [
    "いま分かっていること: 米中貿易交渉が決裂し関税再燃",
    "米国側: 中国の知的財産侵害が原因だと主張",
    "中国側: 米国の一方的な関税引き上げが原因だと主張",
  ],
  debateType: "geopolitics",
  fallbackQuestion: "どちらの主張が妥当ですか？",
  fallbackChoices: { for: "米国側", against: "中国側", undecided: "どちらとも言えない" },
});
console.log("②責任比較:", r2);

// ③是非・正誤の判断(norm_flare)
const r3 = await composeVoteQuestion({
  issueTitle: "佐藤大臣の辞任判断",
  lead: "佐藤経済産業大臣が失言問題の責任を取り辞任しました。野党は対応が遅すぎたと批判しています。",
  bullets: [
    "いま分かっていること: 佐藤大臣が失言問題を受け辞任した",
    "擁護する側: 早期の辞任判断は責任の取り方として妥当",
    "批判する側: 発覚から辞任まで時間がかかりすぎたと指摘",
  ],
  debateType: "norm_flare",
  fallbackQuestion: "佐藤大臣の辞任は妥当ですか？",
  fallbackChoices: { for: "擁護する", against: "批判する", undecided: "どちらとも言えない" },
});
console.log("③正誤判断:", r3);
