# Day 2 - 7/18(土) 運用フロー

## 目標
- 新しいニュースの波に対して正しいトピックが選抜されること
- ウクライナ国防相更迭のような過大評価が再発しないこと
- キオクシア/日経平均のような経済ショックが確実に拾えること

## タイムライン

| 時間(JST) | イベント | 備考 |
|-----------|---------|------|
| 6:33 | cron: promote実行 | 朝ピーク |
| 9:00 | ユーザー確認 | 前日夜のdiscover成果を含む |
| 9:00-12:00 | PDCA修正 | 問題があれば即修正→再実行 |
| 16:03 | cron: promote実行 | 夕方ピーク |
| 17:00 | 夕方レビュー | 修正の効果確認 |
| 終了時 | コミット | 修正内容を保存 |

## 評価基準

1. **国旗毀損罪**が拾えてるか
2. **皇室典範改正**がトップ5に入ってるか
3. **キオクシア/日経平均**の経済ショックが拾えてるか
4. **ウクライナ国防相更迭**タイプの海外人事がトップ5にいないか
5. 見出しに切迫感があるか

## 修正がすでに入っているもの

| 修正 | ファイル | 説明 |
|------|---------|------|
| nationalImportanceFactor | selection-v2.ts | 皇室典範3.0x、憲法2.5x、国旗1.5x |
| frictionWeight undefined=0.3 | selection-v2.ts | 未測定のコメント過大評価防止 |
| frictionWeight floor=0.1 | selection-v2.ts | 実測0でも最低限 |
| 可決bonus 0.15→0.08 | selection-v2.ts | tv_bonusとの重複防止 |
| newsCluster bonus | selection-v2.ts | 5クラスタ+0.10、10+0.20 |
| tv_news triple bonus | selection-v2.ts | TV+ニュース+コメント同時+0.15 |
| foreignDomesticCap | selection-v2.ts | 海外国内人事はdebate上限0.20 |
| 因果マージ | promote.ts | キオクシア+日経平均統合 |
| matchYahooTweetCount改善 | match-tweet-count.ts | bi-gram類似度 |
| tweetCount refresh | promote.ts | 実行時にYahoo RT再取得 |
