import type { Plan } from "@prisma/client";
import { getLikeTitle, getUserReputation } from "@/lib/reputation";
import { getAvatarEmoji } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";

interface UserDisplayNameProps {
  userId: string;
  name: string;
  plan: Plan;
  commentCount: number;
  totalLikes?: number;
  /** thread: スレッド用（like称号は絵文字のみ） / profile: プロフィール用（称号全文） */
  variant?: "thread" | "profile";
  nameOnly?: boolean;
  className?: string;
  nameClassName?: string;
  /** そのユーザーの投票の立場。渡すと名前が賛成=緑/反対=赤/わからない=黄に色付く */
  stance?: VoteChoiceId | null;
}

const STANCE_NAME_COLOR: Record<VoteChoiceId, string> = {
  for: "text-for",
  against: "text-against",
  undecided: "text-undecided",
};

/** X 風: 名前横にアバター絵文字（userId由来で固定） + tier + like 称号 */
export function UserDisplayName({
  userId,
  name,
  plan,
  commentCount,
  totalLikes = 0,
  variant = "thread",
  nameOnly = false,
  className,
  nameClassName,
  stance,
}: UserDisplayNameProps) {
  const tier = getUserReputation(plan, commentCount);
  const likeTitle = getLikeTitle(totalLikes);
  const avatarEmoji = getAvatarEmoji(userId);

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span aria-hidden="true" className="text-base leading-none">
        {avatarEmoji}
      </span>
      <span
        className={cn(
          "font-semibold",
          stance ? STANCE_NAME_COLOR[stance] : "text-ink",
          nameClassName,
        )}
      >
        {name}
      </span>
      {!nameOnly && (
        <>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-bold tracking-tight",
              tier.colorClass,
            )}
          >
            {tier.emoji && <span aria-hidden="true">{tier.emoji}</span>}
            <span>{tier.label}</span>
          </span>
          {likeTitle &&
            (variant === "profile" ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-bold tracking-tight",
                  likeTitle.colorClass,
                )}
              >
                <span aria-hidden="true">{likeTitle.emoji}</span>
                <span>{likeTitle.label}</span>
              </span>
            ) : (
              <span
                className="text-sm leading-none"
                title={likeTitle.label}
                aria-label={likeTitle.label}
              >
                {likeTitle.emoji}
              </span>
            ))}
        </>
      )}
    </span>
  );
}
