import { redirect } from "next/navigation";

interface IssuesPageProps {
  searchParams: Promise<{ category?: string; page?: string; sort?: string; live?: string }>;
}

/** スレ一覧はホームに統合。旧URLはクエリ付きでリダイレクト */
export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const params = await searchParams;
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.page) q.set("page", params.page);
  if (params.sort) q.set("sort", params.sort);
  if (params.live) q.set("live", params.live);
  const qs = q.toString();
  redirect(qs ? `/?${qs}` : "/");
}
