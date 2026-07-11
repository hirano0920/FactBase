import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";

const BASE_URL = process.env.AUTH_URL?.replace(/\/$/, "") || SITE.url;

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
