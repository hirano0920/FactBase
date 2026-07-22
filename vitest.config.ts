import { defineConfig } from "vitest/config";
import path from "node:path";

// tsconfig.jsonが"**/*.test.ts"/"**/__tests__/**"をexcludeしているため、
// vite-tsconfig-paths相当のtsconfig探索ベースの解決（旧resolve.tsconfigPaths: true。
// vitestにそのオプション自体は存在せず、常にtsconfigPaths(未設定)としてalias解決が
// 効いていなかった）がテストファイル自身からの"@/"importを解決できず、
// テストファイルに"@/"importが1つでもあると即座にモジュール解決エラーで
// 0件実行のまま落ちる状態だった（実測: @/importを持つ34ファイル全てが該当）。
// tsconfigのinclude/exclude構成に依存しない明示的なaliasに切り替えて解消する。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "scripts/**/__tests__/**/*.test.ts"],
  },
});
