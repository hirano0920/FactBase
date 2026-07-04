/**
 * Radar非RSSソース（HTML差分・GitHub JSON等）共通ユーティリティ。
 * 生成する FeedItem は detect.ts のRSS取得結果と同じ形にして、
 * 既存の SourceEvent 重複排除（feedName+titleのSHA256）にそのまま乗せる。
 * これにより「差分検知専用の別ストレージ」を作らずに済む。
 */
export interface FeedItem {
  feedName: string;
  trust: number;
  title: string;
  url: string;
  publishedAt: Date;
}

/**
 * 和暦(令和/平成/昭和)・西暦混在の日付文字列をDateに変換。
 * 解析できなければnull（呼び出し側でnew Date()にフォールバックする）。
 */
export function parseJapaneseDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;

  // ISO/YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // 和暦: 令和8年6月29日 / 平成10年 3月 4日 / 昭和64年1月1日
  const eraMatch = s.match(/(令和|平成|昭和)\s*(\d+|元)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (eraMatch) {
    const eraBaseYear: Record<string, number> = {
      令和: 2018, // 令和1年 = 2019
      平成: 1988, // 平成1年 = 1989
      昭和: 1925, // 昭和1年 = 1926
    };
    const eraYear = eraMatch[2] === "元" ? 1 : Number(eraMatch[2]);
    const year = eraBaseYear[eraMatch[1]] + eraYear;
    const d = new Date(year, Number(eraMatch[3]) - 1, Number(eraMatch[4]));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/** 直近N日以内かどうか（バックログの大量流入を防ぐガード） */
export function isWithinDays(date: Date, days: number): boolean {
  return Date.now() - date.getTime() <= days * 86400_000;
}
