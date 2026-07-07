// Cloudflare Workers has no real filesystem (Prisma's generated
// `getQueryEngineWasmModule` does `fs.readFileSync(...)`, which fails at
// runtime), and it also disallows compiling WebAssembly from raw bytes at
// runtime ("Wasm code generation disallowed by embedder") — wasm must be a
// precompiled module brought in via a static `import`. This patches the
// OpenNext bundle to statically import the query engine wasm (so wrangler's
// bundler embeds it as a real CompiledWasm module, see the `rules` entry in
// wrangler.jsonc) and hands that precompiled module straight to Prisma.
// See: prisma/prisma#23500, opennextjs-cloudflare#471.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const handlerDir = ".open-next/server-functions/default";
const handlerPath = `${handlerDir}/handler.mjs`;

copyFileSync(
  "node_modules/.prisma/client/query_engine_bg.wasm",
  `${handlerDir}/query_engine_bg.wasm`,
);

let code = readFileSync(handlerPath, "utf8");

const broken =
  'getQueryEngineWasmModule:async()=>{let queryEngineWasmFilePath=require("path").join(config.dirname,"query_engine_bg.wasm"),queryEngineWasmFileBytes=require("fs").readFileSync(queryEngineWasmFilePath);return new WebAssembly.Module(queryEngineWasmFileBytes)}';

if (!code.includes(broken)) {
  throw new Error(
    "patch-prisma-wasm: expected Prisma-generated fs.readFileSync snippet not found in handler.mjs (Prisma version bump may have changed the generated code — update the `broken` string in this script)",
  );
}

code = code.replace(
  broken,
  "getQueryEngineWasmModule:async()=>__prismaQueryEngineWasm",
);

// Static import must be at the very top for esbuild/wrangler to hoist it
// correctly ahead of the bundle's own module registry setup.
code = `import __prismaQueryEngineWasm from "./query_engine_bg.wasm";\n${code}`;

writeFileSync(handlerPath, code);
console.log("patch-prisma-wasm: wired query_engine_bg.wasm as a static import in handler.mjs");
