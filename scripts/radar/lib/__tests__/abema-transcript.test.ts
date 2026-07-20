import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { json3ToText, prepareCookiesFile } from "../abema-transcript";

describe("json3ToText", () => {
  it("events/segsからテキストを連結する", () => {
    const data = {
      events: [
        { segs: [{ utf8: "こんにちは" }] },
        { segs: [{ utf8: "、世界" }, { utf8: "。\n" }] },
      ],
    };
    expect(json3ToText(data)).toBe("こんにちは、世界。");
  });

  it("segsが無いイベントは無視する", () => {
    const data = { events: [{}, { segs: [{ utf8: "テスト" }] }] };
    expect(json3ToText(data)).toBe("テスト");
  });

  it("eventsが空なら空文字", () => {
    expect(json3ToText({ events: [] })).toBe("");
    expect(json3ToText({})).toBe("");
  });

  it("連続する改行を1つに畳む", () => {
    const data = { events: [{ segs: [{ utf8: "A\n\n\nB" }] }] };
    expect(json3ToText(data)).toBe("A\nB");
  });
});

describe("prepareCookiesFile", () => {
  let dir: string;
  const ORIGINAL_PATH = process.env.YTDLP_COOKIES_PATH;
  const ORIGINAL_B64 = process.env.YTDLP_COOKIES_B64;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "abema-transcript-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    if (ORIGINAL_PATH === undefined) delete process.env.YTDLP_COOKIES_PATH;
    else process.env.YTDLP_COOKIES_PATH = ORIGINAL_PATH;
    if (ORIGINAL_B64 === undefined) delete process.env.YTDLP_COOKIES_B64;
    else process.env.YTDLP_COOKIES_B64 = ORIGINAL_B64;
  });

  it("両方未設定ならnull", async () => {
    delete process.env.YTDLP_COOKIES_PATH;
    delete process.env.YTDLP_COOKIES_B64;
    await expect(prepareCookiesFile(dir)).resolves.toBeNull();
  });

  it("YTDLP_COOKIES_PATHがあればそのままのパスを返す（ファイル書き込みはしない）", async () => {
    delete process.env.YTDLP_COOKIES_B64;
    process.env.YTDLP_COOKIES_PATH = "/tmp/dummy-cookies.txt";
    await expect(prepareCookiesFile(dir)).resolves.toBe("/tmp/dummy-cookies.txt");
  });

  it("YTDLP_COOKIES_B64があればデコードしてファイルに書き出す", async () => {
    delete process.env.YTDLP_COOKIES_PATH;
    const content = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tTEST\tvalue";
    process.env.YTDLP_COOKIES_B64 = Buffer.from(content, "utf-8").toString("base64");
    const path = await prepareCookiesFile(dir);
    expect(path).toBe(join(dir, "cookies.txt"));
    const written = await readFile(path!, "utf-8");
    expect(written).toBe(content);
  });

  it("デコード結果がNetscape形式に見えなければnull（壊れたbase64を渡してyt-dlpに丸投げしない）", async () => {
    delete process.env.YTDLP_COOKIES_PATH;
    // ランダムなバイナリっぽい文字列をbase64化（コピペ崩れ・二重エンコードを模擬）
    process.env.YTDLP_COOKIES_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
    await expect(prepareCookiesFile(dir)).resolves.toBeNull();
  });

  it("コメント行だけ・データ行が無ければnull", async () => {
    delete process.env.YTDLP_COOKIES_PATH;
    process.env.YTDLP_COOKIES_B64 = Buffer.from("# Netscape HTTP Cookie File\n", "utf-8").toString(
      "base64",
    );
    await expect(prepareCookiesFile(dir)).resolves.toBeNull();
  });

  it("YTDLP_COOKIES_B64にbase64化せず生のNetscapeテキストを入れても使える(コピペミス救済)", async () => {
    delete process.env.YTDLP_COOKIES_PATH;
    const content = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tTEST\tvalue";
    process.env.YTDLP_COOKIES_B64 = content;
    const path = await prepareCookiesFile(dir);
    expect(path).toBe(join(dir, "cookies.txt"));
    const written = await readFile(path!, "utf-8");
    expect(written).toBe(content);
  });
});
