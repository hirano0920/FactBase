import { bridgingTitleProgress } from "@/lib/reputation";
import type { UserInfluenceStats } from "@/lib/influence";
import type { UserTrustScore } from "@/lib/trust-score";

interface InfluenceStatsPanelProps {
  influence: UserInfluenceStats;
  trust: UserTrustScore;
}

/** 議論インフルエンス + 信頼スコア（Phase 5/7） */
export function InfluenceStatsPanel({ influence, trust }: InfluenceStatsPanelProps) {
  const bridgingPoints = influence.crossHelpful + influence.neutralHelpful;
  const { current, next, pointsToNext } = bridgingTitleProgress(bridgingPoints);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface-muted/50 px-4 py-3">
        <h3 className="text-xs font-bold text-ink-faint">⚡ 影響力</h3>
        {current && (
          <p className={`mt-1 text-sm font-bold ${current.colorClass}`}>
            <span className="mr-1">{current.emoji}</span>
            {current.label}
          </p>
        )}
        <p className="mt-1 text-sm text-ink-secondary">
          累計「参考になった」{" "}
          <strong className="text-ink">{influence.totalHelpful}</strong>
          {influence.bridgingRate !== null && (
            <>
              {" "}
              · 越境率{" "}
              <strong className="text-ink">{influence.bridgingRate}%</strong>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          相手陣営・中立層からの評価 {bridgingPoints} 件
          {next && pointsToNext !== null && (
            <> · 次の{next.label}まであと{pointsToNext}件</>
          )}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface-muted/50 px-4 py-3">
        <h3 className="text-xs font-bold text-ink-faint">🎯 信頼スコア</h3>
        {trust.passRate !== null ? (
          <p className="mt-1 text-sm text-ink-secondary">
            出典チェック通過率{" "}
            <strong className="text-ink">{trust.passRate}%</strong>
            <span className="text-ink-faint"> ({trust.verifiedCount}/{trust.checkedCount}件)</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">出典チェック未実施</p>
        )}
      </div>
    </div>
  );
}
