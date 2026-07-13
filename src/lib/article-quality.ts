/**
 * 記事の「読みやすさ・構造」を機械判定する（0円・即時）。
 * claims裏取りとは別軸: 嘘でなくても「何の話か分からない」「同じ事実の繰り返し」を落とす。
 */
import {
  splitArticleSections,
  htmlToPlainText,
  isOpeningSectionHeading,
  extractOpeningSummary,
  extractListItems,
} from "@/lib/article-sections";
import type { DebateType } from "@/lib/debate-type";

export type StructureFailReason =
  | "opening_too_thin"
  | "incident_first_missing"
  | "duplicate_facts"
  | "bullets_too_thin"
  | "sides_ungrounded"
  | "sides_asymmetric"
  | "lead_opening_mismatch"
  | "relatability_missing";

export interface StructureIssue {
  reason: StructureFailReason;
  /** Writer差し戻し用の具体文 */
  message: string;
}

const OPENING_MIN_CHARS_REPORTED = 100;
const OPENING_MIN_CHARS_OFFICIAL = 60;

/** 反応・否定だけが先に来るパターン（事件内容の前に出てはいけない） */
const REACTION_FIRST =
  /全面否定|完全に創作|虚偽|捏造|事実と異なる|当たらない|反論|否定して|否定し|否定した|否定しており/;

/**
 * 報道・公式の「何が起きたか」を示す具体トークン。
 * 抽象語（疑惑・トラブル・報道）だけでは足りない。
 */
const INCIDENT_SUBSTANCE =
  /接触|発言|行為|投稿|メール|指示|要求|処分|謝罪|値上げ|改正|決定|発表|起訴|逮捕|判決|議決|可決|否決|金利|関税|制裁|停戦|侵攻|発射|被害|負傷|死亡|解雇|契約解除|厳重注意|楽屋|撮影|キャリア|差別|暴言|暴力|セクハラ|パワハラ|予算|引き上げ|引き下げ|条例|法案|スパイ|潜入|封鎖|海峡|年金|受給|損壊|デモ|工作|部品|選挙|偽情報|ボット|諜報|防諜|封鎖宣言|燃料|タンカー|製油所|[0-9０-９]+(?:\.[0-9０-９]+)?(?:億円|兆円|万円|円|人|件|%|％)/;

/** 否定の引用だけを「具体内容」と誤認しない */
const DENIAL_QUOTE = /「[^」]*(?:創作|嘘|虚偽|捏造|否定|事実と異なる)[^」]*」/g;

function hasIncidentSubstance(text: string): boolean {
  const stripped = text.replace(DENIAL_QUOTE, "");
  return INCIDENT_SUBSTANCE.test(stripped);
}

/** 抽象だけで中身がない冒頭の典型 */
const ABSTRACT_ONLY =
  /(?:を巡る|をめぐる)?(?:トラブル|疑惑|問題|対立|報道)(?:です|だ|である)?[。．]?$/;

const DUPLICATE_MIN_LEN = 18;
const DUPLICATE_MAX_RATIO = 0.28;

function openingSection(articleHtml: string): { heading: string; text: string } | null {
  const opening = splitArticleSections(articleHtml).find((s) => isOpeningSectionHeading(s.heading));
  if (!opening?.heading) return null;
  return { heading: opening.heading, text: htmlToPlainText(opening.bodyHtml) };
}

/**
 * 冒頭で「何が報じられたか／何が起きたか」が先に来ているか。
 * 反応・否定が先で具体トークンが無い／抽象だけの冒頭は不合格。
 * 冒頭見出しが無い旧形式HTMLはスキップ（検証対象外）。
 */
export function checkIncidentFirst(
  articleHtml: string,
  opts?: { isReported?: boolean },
): StructureIssue | null {
  const isReported = opts?.isReported !== false;
  const opening = openingSection(articleHtml);
  if (!opening) return null;

  const text = opening.text;
  const minChars = isReported ? OPENING_MIN_CHARS_REPORTED : OPENING_MIN_CHARS_OFFICIAL;

  if (text.length < minChars) {
    return {
      reason: "opening_too_thin",
      message: `冒頭（いま何が論点か／いま分かっていること）が短すぎます（${text.length}字）。報道・公式の具体内容を①に含めて${minChars}字以上にしてください。`,
    };
  }

  const hasSubstance = hasIncidentSubstance(text);
  const hasReaction = REACTION_FIRST.test(text);
  const looksAbstract =
    ABSTRACT_ONLY.test(text.replace(/\s+/g, "")) ||
    (/疑惑|トラブル|対立/.test(text) && !hasSubstance);

  if (!hasSubstance && (hasReaction || looksAbstract || isReported)) {
    return {
      reason: "incident_first_missing",
      message:
        "冒頭に報道・公式の具体内容（行為・発言・決定など）がありません。否定・反応の前に「何が報じられたか／何が起きたか」を①として書いてください。抽象的な「疑惑・トラブル」だけでは不可です。",
    };
  }

  if (hasSubstance && hasReaction) {
    const stripped = text.replace(DENIAL_QUOTE, "");
    const substanceIdx = stripped.search(INCIDENT_SUBSTANCE);
    const reactionIdx = text.search(REACTION_FIRST);
    // stripped は文字数が減るので、原文上の反応位置と比較するため反応より前の原文で具体語を探す
    const substanceInOriginal = text.search(INCIDENT_SUBSTANCE);
    const effectiveSubstance =
      substanceInOriginal !== -1 ? substanceInOriginal : substanceIdx;
    if (reactionIdx !== -1 && effectiveSubstance !== -1 && reactionIdx < effectiveSubstance) {
      return {
        reason: "incident_first_missing",
        message:
          "冒頭で否定・反応が具体的な報道内容より先に出ています。順序を①報道の内容 → ②経緯 → ③反応に直してください。",
      };
    }
  }

  return null;
}

/**
 * 冒頭と「各社」「両側主張」で同じ文言の再掲率が高すぎないか。
 * 冒頭見出しが無い場合はスキップ。
 */
export function checkDuplicateFacts(articleHtml: string): StructureIssue | null {
  const opening = openingSection(articleHtml);
  if (!opening || opening.text.length < DUPLICATE_MIN_LEN) return null;

  const outlets = sectionPlainByHeading(
    articleHtml,
    (h) => h === "各社は何を伝えているか" || h === "海外ではどう報じられているか",
  );
  const sides = sideSectionsPlain(articleHtml);

  const openingGrams = charNgrams(opening.text, DUPLICATE_MIN_LEN);
  const targets = [
    { label: "各社は何を伝えているか", text: outlets },
    { label: "両側の主張", text: sides.map((s) => s.text).join("\n") },
  ];

  for (const t of targets) {
    if (t.text.length < DUPLICATE_MIN_LEN) continue;
    const ratio = overlapRatio(openingGrams, charNgrams(t.text, DUPLICATE_MIN_LEN));
    if (ratio >= DUPLICATE_MAX_RATIO) {
      return {
        reason: "duplicate_facts",
        message: `冒頭と「${t.label}」で同じ事実の再掲が多いです（重複率${Math.round(ratio * 100)}%）。両側・各社セクションでは既出の事実を繰り返さず、主張・理由・論調の差だけを書いてください。`,
      };
    }
  }
  return null;
}

function isSideHeading(h: string | null): boolean {
  if (!h || isOpeningSectionHeading(h)) return false;
  if (
    h === "どこで意見が分かれるか" ||
    h === "各社は何を伝えているか" ||
    h === "海外ではどう報じられているか" ||
    h === "背景" ||
    h === "法律ではどうなっているか" ||
    h === "数字で見る世論" ||
    h === "まだ分からないこと" ||
    h === "出典" ||
    h === "これまでの流れ"
  ) {
    return false;
  }
  return (
    /が言うこと$/.test(h) ||
    h.includes("側") ||
    h.includes("賛成") ||
    h.includes("反対") ||
    h.includes("擁護") ||
    h.includes("批判") ||
    h.includes("支持") ||
    h.includes("問題") ||
    h.includes("陣営") ||
    h.includes("優先") ||
    /強化派|慎重派|推進派|警戒/.test(h)
  );
}

function sideSectionsPlain(
  articleHtml: string,
): { heading: string; text: string; items: string[] }[] {
  return splitArticleSections(articleHtml)
    .filter((s) => isSideHeading(s.heading))
    .map((s) => ({
      heading: s.heading ?? "",
      text: htmlToPlainText(s.bodyHtml),
      items: extractListItems(s.bodyHtml),
    }));
}

function sectionPlainByHeading(articleHtml: string, match: (h: string | null) => boolean): string {
  return splitArticleSections(articleHtml)
    .filter((s) => match(s.heading))
    .map((s) => htmlToPlainText(s.bodyHtml))
    .join("\n");
}

/** 連続する文字 n-gram（空白除去後）から重複検出用セットを作る */
function charNgrams(text: string, n: number): Set<string> {
  const t = text.replace(/\s+/g, "");
  const out = new Set<string>();
  if (t.length < n) return out;
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / Math.min(a.size, b.size);
}

export interface StructureCheckOptions {
  isReported?: boolean;
  debateType?: DebateType | null;
  /** 争点タイトル（自分ごとフックの検出用） */
  issueTitle?: string;
}

/** メタ立場だけで中身がない bullets 文 */
const META_STANCE_ONLY =
  /^(?:.{0,10})?(?:全面否定|虚偽|捏造|事実だ|事実である|支持する|反対する|問題だ|擁護する|批判する)(?:する立場|とする立場|と主張|している)?[。．]?$/;

function bulletBody(bullet: string): string {
  const m = bullet.match(/^[^：:]{1,20}[：:]\s*([\s\S]+)$/);
  return (m ? m[1] : bullet).trim();
}

/**
 * summaryJson.bullets が「虚偽だ／事実だ」だけの薄い二項対立になっていないか。
 * きれいに対称なメタ対立は珍しく、しかも読み手に事件内容が伝わらない。
 */
export function checkBulletsThickness(
  bullets: string[] | undefined,
  opts?: { isReported?: boolean },
): StructureIssue | null {
  // テスト用スタブや未完成出力はスキップ（本番Writerは常に3項目・十分な長さ）
  const joined = (bullets ?? []).join("");
  if (!bullets || bullets.length < 3 || joined.length < 80) return null;

  const [ctx, a, b] = bullets.map(bulletBody);
  if (ctx.length < 40 || !hasIncidentSubstance(ctx)) {
    return {
      reason: "bullets_too_thin",
      message:
        "bulletsの1項目目が薄すぎます。何が起きたか／何が報じられたか（行為・発言・数字・決定）を40字以上で具体的に書いてください。「トラブルを巡る報道」だけでは不可です。",
    };
  }
  // hasIncidentSubstanceは「発言」「解雇」等のトークン一致だけなので、
  // 「〜の是非を巡る規範的な対立」のように対立の構図だけを説明し実際の発言・行為の中身を
  // 一切書かない文でも誤って合格してしまう（本番で実際に発生: 読者が争点の中身を把握できず
  // 投票できないという報告あり）。引用・報道帰属マーカーが無いのに対立の構図語で終わる文を弾く。
  if (
    /(?:是非を巡る|を巡る規範的な|を巡る対立|を巡り(?:意見が分かれ|対立)|かどうかを巡る)/.test(ctx) &&
    !/「|と報じ|と伝え|と述べ|と発表|と回答|によると|判明|明らかに/.test(ctx)
  ) {
    return {
      reason: "bullets_too_thin",
      message:
        "bulletsの1項目目が対立の構図の説明だけで終わっています。実際に何が発言・報道・決定されたか（言葉の要旨や具体的な中身）を書いてください。「〜を巡る対立」で終わらせない。",
    };
  }
  for (const [label, body] of [
    ["2項目目", a],
    ["3項目目", b],
  ] as const) {
    if (body.length < 28 || META_STANCE_ONLY.test(body.replace(/\s+/g, ""))) {
      return {
        reason: "bullets_too_thin",
        message: `bulletsの${label}がメタ立場だけです。「虚偽だ／事実だ／支持／反対」に留めず、何についてそう主張するかを具体的に書いてください。両側がきれいに対称でなくても構いません。`,
      };
    }
    if (
      opts?.isReported !== false &&
      !hasIncidentSubstance(body) &&
      !/(根拠|取材|コメント|対応|注意|定義|該当|主張|指摘|不安|是正|負担)/.test(body)
    ) {
      return {
        reason: "bullets_too_thin",
        message: `bulletsの${label}に具体がありません。事件内容・根拠・対応のどれかを含めてください。`,
      };
    }
  }
  return null;
}

/** 資料に無い教科書一般論の典型（帰属なしで使うと片側が薄くなる） */
const TEXTBOOK_GENERIC =
  /国際競争力を損な|過度な規制|現行法で対応|現行法で十分|外交ルートで|慎重にすべき|バランスが重要|信頼回復が必要|将来世代の負担|説明が不十分|慎重な対応が求め|適切に対応|総合的に判断|影響を懸念/;

/** 報道・発言への帰属マーカー */
const ATTRIBUTION_MARK =
  /と報じ|と伝え|と指摘|と主張|と述べ|によると|会議録|議員|教授|声明|コメント|発表|会見|SNSで|事務所は|政府は|与党|野党|党は|側は|メディア|新聞|通信/;

/**
 * 両側セクションが教科書一般論だけで埋まっていないか、
 * かつ両側の根拠密度が大きく非対称でないか。
 */
export function checkSidesGrounding(articleHtml: string): StructureIssue | null {
  const sides = sideSectionsPlain(articleHtml);
  if (sides.length < 2) return null;

  const scored = sides.slice(0, 2).map((s) => {
    const items = s.items.length > 0 ? s.items : [s.text];
    const grounded = items.filter((it) => ATTRIBUTION_MARK.test(it) || hasIncidentSubstance(it));
    const generic = items.filter((it) => TEXTBOOK_GENERIC.test(it) && !ATTRIBUTION_MARK.test(it));
    return {
      heading: s.heading,
      textLen: s.text.replace(/\s+/g, "").length,
      itemCount: items.length,
      groundedCount: grounded.length,
      genericCount: generic.length,
    };
  });

  for (const s of scored) {
    if (s.itemCount >= 2 && s.groundedCount === 0 && s.genericCount >= 1) {
      return {
        reason: "sides_ungrounded",
        message: `「${s.heading}」が資料に紐づかない教科書一般論だけで埋まっています。各項目に媒体名・発言者・議員など帰属を付け、資料にある具体点だけにしてください。根拠が無ければ捏造せず「まだ分からないこと」へ回してください。`,
      };
    }
    if (s.itemCount >= 3 && s.groundedCount <= 1 && s.genericCount >= 2) {
      return {
        reason: "sides_ungrounded",
        message: `「${s.heading}」の根拠密度が低すぎます（帰属・具体が${s.groundedCount}/${s.itemCount}）。反対側・慎重側も報道・国会発言など資料に基づく論拠を3項目揃えてください。`,
      };
    }
  }

  const [a, b] = scored;
  if (!a || !b) return null;
  // 分量差だけでは落とさない（声明対立は非対称が普通）。厚い側が根拠あり＆薄い側が一般論埋めのときだけ不合格。
  if (a.groundedCount >= 3 && b.groundedCount <= 1 && b.genericCount >= 1) {
    return {
      reason: "sides_asymmetric",
      message: `「${a.heading}」は具体・帰属が厚いのに「${b.heading}」が薄いです。薄い側も媒体・発言者付きの論拠を足すか、資料が無ければ項目を減らし「まだ分からないこと」に回してください。`,
    };
  }
  if (b.groundedCount >= 3 && a.groundedCount <= 1 && a.genericCount >= 1) {
    return {
      reason: "sides_asymmetric",
      message: `「${b.heading}」は具体・帰属が厚いのに「${a.heading}」が薄いです。薄い側も媒体・発言者付きの論拠を足すか、資料が無ければ項目を減らし「まだ分からないこと」に回してください。`,
    };
  }
  return null;
}

const LEAD_OPENING_MIN_OVERLAP = 0.2;

/**
 * lead と冒頭セクションが別要約になっていないか。
 * 短いスタブ lead（テスト・未完成）はスキップ。
 * 冒頭の先頭40字が lead に含まれる／lead の先頭40字が冒頭に含まれる／20-gram重複で判定。
 */
export function checkLeadOpeningMatch(article: {
  articleHtml: string;
  lead?: string;
}): StructureIssue | null {
  const lead = (article.lead ?? "").replace(/\s+/g, "").trim();
  if (lead.length < 80) return null;
  const opening = openingSection(article.articleHtml);
  if (!opening || opening.text.replace(/\s+/g, "").length < 80) return null;
  const openingText = opening.text.replace(/\s+/g, "");

  const leadHead = lead.slice(0, 40);
  const openingHead = openingText.slice(0, 40);
  if (openingText.includes(leadHead) || lead.includes(openingHead)) return null;

  const ratio = overlapRatio(charNgrams(lead, 20), charNgrams(openingText, 20));
  if (ratio < LEAD_OPENING_MIN_OVERLAP) {
    return {
      reason: "lead_opening_mismatch",
      message:
        "leadと「いま何が論点か／いま分かっていること」が別内容です。leadは冒頭セクションと同一内容にしてください（短い別要約禁止）。",
    };
  }
  return null;
}

/** タイトルに自分ごとフックがあるとき、冒頭にも波及を1語以上含める */
const RELATABILITY_HOOK =
  /貿易|円相場|円安|円高|為替|燃料|電気代|物価|税金|年金|ローン|給料|賃金|SNS|表現の自由|安全保障|安保|エネルギー|ガソリン|家計|生活|投票|選挙/;

/**
 * 争点タイトルが自分ごとフックを持つのに、冒頭・対立軸に波及が無い記事を落とす。
 * フックの無いタイトル（純粋な声明対立等）はスキップ。
 */
export function checkRelatabilityBridge(
  articleHtml: string,
  issueTitle?: string,
): StructureIssue | null {
  if (!issueTitle || !RELATABILITY_HOOK.test(issueTitle)) return null;
  const opening = openingSection(articleHtml);
  const splitAxis = sectionPlainByHeading(articleHtml, (h) => h === "どこで意見が分かれるか");
  const blob = `${opening?.text ?? ""}\n${splitAxis}`;
  if (blob.trim().length < 40) return null;
  if (RELATABILITY_HOOK.test(blob)) return null;

  const hooks = issueTitle.match(new RegExp(RELATABILITY_HOOK.source, "g"));
  const hint = hooks?.slice(0, 3).join("・") ?? "生活・安全への影響";
  return {
    reason: "relatability_missing",
    message: `争点タイトルに「${hint}」など自分ごとフックがあるのに、冒頭・対立軸に波及がありません。一般読者への影響を1文、対立軸の文言にも落としてください。`,
  };
}

export function findStructureIssues(
  article: { articleHtml: string; lead?: string; bullets?: string[] },
  opts?: StructureCheckOptions,
): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const incident = checkIncidentFirst(article.articleHtml, { isReported: opts?.isReported });
  if (incident) issues.push(incident);
  const dup = checkDuplicateFacts(article.articleHtml);
  if (dup) issues.push(dup);
  const bullets = checkBulletsThickness(article.bullets, { isReported: opts?.isReported });
  if (bullets) issues.push(bullets);
  const sides = checkSidesGrounding(article.articleHtml);
  if (sides) issues.push(sides);
  const leadMatch = checkLeadOpeningMatch(article);
  if (leadMatch) issues.push(leadMatch);
  const relatability = checkRelatabilityBridge(article.articleHtml, opts?.issueTitle);
  if (relatability) issues.push(relatability);
  return issues;
}

/** 文境界で切り詰め（句点があればそこまで） */
export function truncateAtSentence(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const sliced = t.slice(0, maxChars);
  const lastStop = Math.max(sliced.lastIndexOf("。"), sliced.lastIndexOf("．"));
  if (lastStop >= Math.floor(maxChars * 0.45)) return sliced.slice(0, lastStop + 1);
  return `${sliced.replace(/[、,\s]+$/u, "")}…`;
}

/**
 * 生成直後に lead / bullets を articleHtml と揃える（DB保存前の正規化）。
 * AIが指示を守らなくても、フィード・スレッド・記事の表面を一致させる。
 */
export function normalizeArticleSurfaces(article: {
  lead: string;
  bullets: string[];
  articleHtml: string;
}): { lead: string; bullets: string[]; articleHtml: string } {
  const openingText = extractOpeningSummary(article.articleHtml, article.lead);
  const lead =
    openingText.length >= 60 ? truncateAtSentence(openingText, 280) : article.lead.trim();

  const bullets = [...(article.bullets ?? [])];
  while (bullets.length < 3) bullets.push("");

  const opening = openingSection(article.articleHtml);
  if (opening && hasIncidentSubstance(opening.text)) {
    const labelMatch = bullets[0]?.match(/^([^：:]{1,20})[：:]/);
    const label = labelMatch?.[1]?.trim() || "いま分かっていること";
    const short = truncateAtSentence(
      opening.text
        .split(/(?<=[。．])/)
        .filter(Boolean)
        .slice(0, 2)
        .join(""),
      160,
    );
    if (short.length >= 40) bullets[0] = `${label}: ${short}`;
  }

  const sides = sideSectionsPlain(article.articleHtml);
  for (let i = 0; i < 2; i++) {
    const side = sides[i];
    const bi = i + 1;
    if (!side?.items.length) continue;
    const body = bulletBody(bullets[bi] ?? "");
    const needsEnrich =
      body.length < 40 ||
      META_STANCE_ONLY.test(body.replace(/\s+/g, "")) ||
      (TEXTBOOK_GENERIC.test(body) && !ATTRIBUTION_MARK.test(body));
    if (!needsEnrich) continue;
    const claim = side.items.slice(0, 2).join("").trim();
    if (claim.length < 28) continue;
    const label =
      bullets[bi]?.match(/^([^：:]{1,20})[：:]/)?.[1]?.trim() ||
      side.heading.replace(/が言うこと$/, "") ||
      `立場${i + 1}`;
    bullets[bi] = `${label}: ${truncateAtSentence(claim, 140)}`;
  }

  return { ...article, lead, bullets: bullets.slice(0, 3) };
}

/**
 * タイトルの自分ごとフックを冒頭段落末尾に1文足す（0円）。
 * 既にフック語があれば何もしない。
 */
export function injectRelatabilityBridge(
  articleHtml: string,
  issueTitle?: string,
): string {
  if (!issueTitle || !RELATABILITY_HOOK.test(issueTitle)) return articleHtml;
  if (checkRelatabilityBridge(articleHtml, issueTitle) === null) return articleHtml;

  const hooks = [...new Set(issueTitle.match(new RegExp(RELATABILITY_HOOK.source, "g")) ?? [])];
  if (hooks.length === 0) return articleHtml;
  const sentence = `一般の読者にとっては、${hooks.slice(0, 3).join("・")}への影響も論点になります。`;

  // 冒頭セクションの </p> 直前、または先頭 ul の前に挿入
  const openingRe = /(<h2>(?:いま何が論点か|いま分かっていること)<\/h2>)([\s\S]*?)(?=<h2>|$)/i;
  const m = articleHtml.match(openingRe);
  if (!m) return articleHtml;

  const head = m[1];
  let body = m[2];
  if (/<\/p>/i.test(body)) {
    body = body.replace(/<\/p>/i, `${sentence}</p>`);
  } else if (/<ul>/i.test(body)) {
    body = body.replace(/<ul>/i, `<p>${sentence}</p><ul>`);
  } else {
    body = `${body}<p>${sentence}</p>`;
  }
  return articleHtml.replace(openingRe, `${head}${body}`);
}

/**
 * 両側セクションから「帰属なし教科書一般論」の<li>を除去する（0円）。
 * 根拠付き項目が残れば構造チェックを通しやすくする。捏造は足さない。
 */
export function stripTextbookSideItems(articleHtml: string): string {
  const sides = sideSectionsPlain(articleHtml);
  if (sides.length === 0) return articleHtml;

  let html = articleHtml;
  for (const side of sides.slice(0, 2)) {
    if (side.items.length === 0) continue;
    const kept = side.items.filter((it) => {
      const pureTextbook =
        TEXTBOOK_GENERIC.test(it) && !ATTRIBUTION_MARK.test(it) && !hasIncidentSubstance(it);
      return !pureTextbook;
    });
    if (kept.length === side.items.length) continue;
    if (kept.length === 0) continue; // 全消しはしない（安価な両側リライトに回す）

    const newUl = `<ul>${kept.map((it) => `<li>${escapeHtmlText(it)}</li>`).join("")}</ul>`;
    const sectionRe = new RegExp(
      `(<h2>${escapeRegExp(side.heading)}<\\/h2>)([\\s\\S]*?)(?=<h2>|$)`,
      "i",
    );
    html = html.replace(sectionRe, `$1${newUl}`);
  }
  return html;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * HELDを減らすための0円修復: lead/bullets同期 → 自分ごと注入 → 教科書一般論の除去。
 * ゲート基準は下げず、直しきれるズレだけ機械的に直す。
 */
export function autoRepairArticle(
  article: { lead: string; bullets: string[]; articleHtml: string },
  opts?: { issueTitle?: string },
): { lead: string; bullets: string[]; articleHtml: string } {
  let articleHtml = injectRelatabilityBridge(article.articleHtml, opts?.issueTitle);
  articleHtml = stripTextbookSideItems(articleHtml);
  const synced = normalizeArticleSurfaces({
    lead: article.lead,
    bullets: article.bullets,
    articleHtml,
  });
  return { lead: synced.lead, bullets: synced.bullets, articleHtml };
}

/**
 * 既存の薄い summaryJson を、記事本文から表示用に濃くする（DBは書き換えない）。
 * 1項目目が抽象だけのとき、冒頭や両側から具体文を拾って差し替える。
 * lead も冒頭と大きくズレていれば冒頭に揃える。
 */
export function enrichSummaryForDisplay(
  summary: { lead: string; bullets: string[]; sources: { label: string; url: string }[] },
  articleHtml: string | null | undefined,
): { lead: string; bullets: string[]; sources: { label: string; url: string }[] } {
  if (!articleHtml) return summary;

  const normalized = normalizeArticleSurfaces({
    lead: summary.lead,
    bullets: [...(summary.bullets ?? [])],
    articleHtml,
  });

  const bullets = [...(summary.bullets ?? [])];
  const first = bullets[0] ?? "";
  const firstBody = bulletBody(first);
  if (!(firstBody.length >= 40 && hasIncidentSubstance(firstBody))) {
    if (normalized.bullets[0]) bullets[0] = normalized.bullets[0];
  }
  for (let i = 1; i <= 2; i++) {
    const body = bulletBody(bullets[i] ?? "");
    if (
      body.length < 40 ||
      META_STANCE_ONLY.test(body.replace(/\s+/g, "")) ||
      (TEXTBOOK_GENERIC.test(body) && !ATTRIBUTION_MARK.test(body))
    ) {
      if (normalized.bullets[i]) bullets[i] = normalized.bullets[i];
    }
  }

  const opening = openingSection(articleHtml);
  let lead = summary.lead;
  if (opening && opening.text.length >= 80) {
    const leadNorm = lead.replace(/\s+/g, "");
    const openingNorm = opening.text.replace(/\s+/g, "");
    const headOk =
      openingNorm.includes(leadNorm.slice(0, 40)) || leadNorm.includes(openingNorm.slice(0, 40));
    const ratio = overlapRatio(charNgrams(leadNorm, 20), charNgrams(openingNorm, 20));
    if (lead.length < 60 || (!headOk && ratio < LEAD_OPENING_MIN_OVERLAP)) {
      lead = truncateAtSentence(opening.text, 280);
    }
  }

  return { ...summary, lead, bullets };
}

export interface ExcerptThicknessResult {
  ok: boolean;
  reason: string | null;
  totalChars: number;
  concreteSignalCount: number;
  outletCount: number;
}

const THIN_MIN_TOTAL_CHARS = 400;
const THIN_MIN_CONCRETE = 1;
const THIN_MIN_OUTLETS = 1;

/**
 * 報道抜粋が「記事を書ける厚さ」があるか。薄い材料で上手く書け、は限界があるため生成前に弾く。
 */
export function assessReportExcerptThickness(
  excerpts: { text: string; feed?: string }[],
): ExcerptThicknessResult {
  const outletCount = new Set(excerpts.map((e) => e.feed || "unknown")).size;
  const totalChars = excerpts.reduce((sum, e) => sum + (e.text?.length ?? 0), 0);
  const blob = excerpts.map((e) => e.text ?? "").join("\n");
  const concreteMatches = blob.match(INCIDENT_SUBSTANCE) ?? [];
  const concreteSignalCount = new Set(concreteMatches).size;

  if (excerpts.length === 0) {
    return {
      ok: false,
      reason: "報道本文抜粋が0件です。見出しだけでは具体内容のある記事を書けません。",
      totalChars: 0,
      concreteSignalCount: 0,
      outletCount: 0,
    };
  }
  if (totalChars < THIN_MIN_TOTAL_CHARS) {
    return {
      ok: false,
      reason: `報道抜粋が薄すぎます（合計${totalChars}字 < ${THIN_MIN_TOTAL_CHARS}字）。追加取得するかHELDにしてください。`,
      totalChars,
      concreteSignalCount,
      outletCount,
    };
  }
  if (concreteSignalCount < THIN_MIN_CONCRETE && outletCount >= THIN_MIN_OUTLETS) {
    return {
      ok: false,
      reason:
        "報道抜粋に行為・発言・決定などの具体内容が見つかりません。抽象的な見出し要約だけでは生成しないでください。",
      totalChars,
      concreteSignalCount,
      outletCount,
    };
  }
  return { ok: true, reason: null, totalChars, concreteSignalCount, outletCount };
}

/**
 * ゴールデンHTML。
 *
 * CLEAR_DECLARATION は「報道 vs 本人否定」が極端にきれいな二項対立。
 * 実プロダクトではここまで対称な争点は稀なので、回帰の「最悪ケース（薄い否定先行）」検出用に残し、
 * それ以外の型は MESSY_* で「軸が曖昧・非対称」でも incidentFirst が通ることを見る。
 */
const CLEAR_DECLARATION_BAD_HTML_IMPL = `<h2>いま何が論点か</h2><p>週刊文春が俳優・佐藤二朗さんと女優・橋本愛さんの間のトラブルを巡る報道をしました。佐藤さん本人はSNSで報道内容を「完全に創作している」と全面否定しており、事実関係を巡って報道側と本人側の主張が真っ向から対立しています。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>週刊文春・報道側:</strong> 内容は事実だとする立場</li><li><strong>佐藤二朗さん側:</strong> 虚偽・捏造だとする立場</li></ul>
<h2>佐藤二朗さん側が言うこと</h2><ul><li>SNSで「嘘はやめて下さい」「完全に創作してる」と否定</li><li>事務所は「事実と異なる内容が含まれる」とコメント</li></ul>
<h2>報道内容・橋本愛さん周辺が示すこと</h2><ul><li>週刊文春が複数の関係者取材をもとに報道</li><li>橋本さんが体調面で撮影に配慮を要する状態になったとされる</li></ul>
<h2>各社は何を伝えているか</h2><ul><li><strong>週刊文春:</strong> 撮影中の身体的接触と、相手の楽屋を訪れた際にキャリアに関する否定的な発言があったと報じた</li><li><strong>フジテレビ:</strong> 佐藤さんに厳重注意し再発防止を求めたと説明</li></ul>
<h2>まだ分からないこと</h2><ul><li>接触・発言の詳細は確定していない</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;

const CLEAR_DECLARATION_GOOD_HTML_IMPL = `<h2>いま何が論点か</h2><p>週刊文春は、俳優・佐藤二朗さんがドラマ撮影中に共演の橋本愛さんへ身体的接触をし、楽屋ではキャリアに関する否定的な発言をしたと報じています。両者は2026年4月放送のフジテレビ系ドラマで共演していました。佐藤さんはSNSで報道を「完全に創作」と全面否定し、報道側と本人側の主張が対立しています。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>週刊文春・報道側:</strong> 関係者取材に基づく報道で内容は事実だとする立場</li><li><strong>佐藤二朗さん・事務所:</strong> 報道は虚偽で、専門家確認でもハラスメントに当たらないとする立場</li></ul>
<h2>佐藤二朗さん側が言うこと</h2><ul><li>SNSで「嘘はやめて下さい」と報道を明確に否定している</li><li>事務所は「事実と異なる内容が含まれる」とコメントした</li><li>指摘行為はハラスメント定義に該当しないとの専門家見解があるとする</li></ul>
<h2>報道内容・橋本愛さん周辺が示すこと</h2><ul><li>関係者取材として撮影中の接触と楽屋での発言を問題視している</li><li>橋本さんが体調面で撮影配慮を要するようになったとされる</li><li>フジテレビが発言面について厳重注意したと伝えられている</li></ul>
<h2>各社は何を伝えているか</h2><ul><li><strong>各社が揃って伝えていること:</strong> 文春報道後に本人が全面否定し、フジが何らかの対応をした点</li><li><strong>フジテレビ:</strong> 問題視したのは接触そのものより、体調配慮が必要になった後の発言だとした</li><li><strong>東洋経済等:</strong> 本人の態度変化やフジ対応への業界の疑問を伝えている</li></ul>
<h2>まだ分からないこと</h2><ul><li>接触・発言の詳細な経緯は双方で食い違ったまま</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;

export const CLEAR_DECLARATION_BAD_HTML = CLEAR_DECLARATION_BAD_HTML_IMPL;
export const CLEAR_DECLARATION_GOOD_HTML = CLEAR_DECLARATION_GOOD_HTML_IMPL;
/** @deprecated CLEAR_DECLARATION_* を使う */
export const SATO_STYLE_BAD_HTML = CLEAR_DECLARATION_BAD_HTML;
/** @deprecated */
export const SATO_STYLE_GOOD_HTML = CLEAR_DECLARATION_GOOD_HTML;

/** 政策型・論点が複数で非対称（きれいな二項対立ではない） */
export const MESSY_POLICY_GOOD_HTML = `<h2>いま何が論点か</h2><p>政府は来年度予算案で防衛費をGDP比2%超まで引き上げる方針を閣議決定したと発表しています。与党内にも財源の国債依存を不安視する声があり、野党は社会保障との両立を問題視しています。数字の是非だけでなく、何を削って何を積むかが争点です。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>推進側:</strong> 抑止力強化が急務だとする立場</li><li><strong>慎重側:</strong> 財源と暮らしへの影響を優先すべきだとする立場</li></ul>
<h2>賛成側が言うこと</h2><ul><li>与党議員は抑止に必要な装備更新が遅れていると指摘する</li><li>防衛省関係者は同盟国との負担バランス是正が必要だと述べている</li></ul>
<h2>反対側が言うこと</h2><ul><li>野党は国債増発で将来世代の負担が増えると主張する</li><li>野党議員は医療・教育予算とのトレードオフが説明不足だと国会で指摘した</li></ul>
<h2>まだ分からないこと</h2><ul><li>具体的な財源内訳は今後の国会審議次第</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;

/** 炎上型・当事者声明が無く軸が規範（対称なA/B声明ではない） */
export const MESSY_NORM_FLARE_GOOD_HTML = `<h2>いま何が論点か</h2><p>動画投稿サイトで拡散された切り抜きを巡り、ある配信者の発言が差別的だとして批判が集まっています。擁護側は編集で文脈が歪められたと主張し、批判側は発言自体が規範に反すると見ています。本人の公式声明はまだ出ていません。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>擁護側:</strong> 切り抜きが悪意ある編集だとする立場</li><li><strong>批判側:</strong> 発言内容そのものが問題だとする立場</li></ul>
<h2>擁護側が言うこと</h2><ul><li>前後の文脈では別の趣旨だったと説明する配信が複数ある</li><li>プラットフォームのセンセーショナルな切り抜き誘導を問題視する声が投稿で広がっている</li></ul>
<h2>批判側が言うこと</h2><ul><li>発言の一部は文脈を補っても差別的だとする批判投稿が相次いだ</li><li>影響力のある配信者ほど表現に慎重であるべきだと指摘する声がある</li></ul>
<h2>まだ分からないこと</h2><ul><li>フル尺の正確な文言は一次動画の確認待ち</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;

/** 片側だけ教科書一般論の悪い例（sides_ungrounded 回帰用） */
export const SIDES_UNGROUNDED_BAD_HTML = `<h2>いま何が論点か</h2><p>ニューヨーク・タイムズは、ロシアが日本をスパイ活動の拠点とし、制裁回避で工作機械や電子部品を入手している可能性を報じています。テンプル大学の教授は防諜体制の脆弱さに警鐘を鳴らしました。貿易や安全保障への波及が論点です。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>警戒強化派:</strong> スパイ防止法整備を急ぐべき</li><li><strong>慎重派:</strong> 現行法で対応可能</li></ul>
<h2>警戒強化派が言うこと</h2><ul><li>ニューヨーク・タイムズは工作員が先端技術を狙っていると報じている</li><li>教授は会見で防諜の甘さが長期にわたり続いていると指摘した</li><li>Yahoo!ニュースは選挙でのボット・トロール操作も懸念されると伝えた</li></ul>
<h2>慎重派が言うこと</h2><ul><li>現行法で対応可能だ</li><li>過度な規制が国際競争力を損なう恐れがある</li><li>外交ルートで慎重にすべきだ</li></ul>
<h2>まだ分からないこと</h2><ul><li>逮捕件数の詳細</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;
