/**
 * 争点・一覧の Next.js ISR キャッシュを書き込み時にパージする。
 * revalidatePath は Route Handler / Server Action からのみ有効。
 */
import { revalidatePath } from "next/cache";

export function revalidateIssuePages(slug: string): void {
  revalidatePath(`/issues/${slug}`);
  revalidatePath(`/issues/${slug}/article`);
}

export function revalidateListingPages(): void {
  revalidatePath("/");
  revalidatePath("/issues");
  revalidatePath("/ranking");
}

export function revalidateAfterIssueUpdate(slug?: string): void {
  revalidateListingPages();
  if (slug) revalidateIssuePages(slug);
}
