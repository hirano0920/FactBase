import type { MetadataRoute } from "next";
import { SITE } from "@/lib/constants";

/**
 * PWAマニフェスト。ホーム画面追加（A2HS）とスタンドアロン起動を有効にする。
 * プッシュ通知（sw.js）と合わせて「ブラウザのブックマークから開く」より強い再訪動線を作る。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.fullName,
    short_name: SITE.displayName,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#FAFAF8",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
