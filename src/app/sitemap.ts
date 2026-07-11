import type { MetadataRoute } from "next";
import { getIssues } from "@/lib/data";
import { SITE } from "@/lib/constants";

const BASE_URL = process.env.AUTH_URL?.replace(/\/$/, "") || SITE.url;

/** 静的ページ + 争点(一覧/詳細/記事)を動的生成。revalidate=3600でISR相当。 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${BASE_URL}/issues`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/ranking`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${BASE_URL}/ranking/votes`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${BASE_URL}/pricing`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/transparency`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const issues = await getIssues();
  const issuePages: MetadataRoute.Sitemap = issues.flatMap((issue) => {
    const entries: MetadataRoute.Sitemap = [
      {
        url: `${BASE_URL}/issues/${issue.slug}`,
        lastModified: issue.createdAt,
        changeFrequency: "hourly",
        priority: 0.8,
      },
    ];
    if (issue.articleHtml) {
      entries.push({
        url: `${BASE_URL}/issues/${issue.slug}/article`,
        lastModified: issue.articleGeneratedAt ?? issue.createdAt,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
    return entries;
  });

  return [...staticPages, ...issuePages];
}
