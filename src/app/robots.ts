import type { MetadataRoute } from "next";

const BASE_URL = process.env.AUTH_URL?.replace(/\/$/, "") || "https://factbase.tokyo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/account", "/login"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
