/**
 * 管理ダッシュボードからRadarのGitHub Actions実行状況を確認・手動実行するための薄いクライアント。
 * GitHub CLIやActionsタブへ毎回移動する手間を無くすのが目的。
 * リポジトリは非公開のため GITHUB_TOKEN（Actions: Read and write のfine-grained PAT）が必須。
 * 未設定時はエラーを投げず「未設定」を返す（Radar自体は動くので管理画面の一部機能が使えないだけにする）。
 */
const REPO = "hirano0920/FactBase";
const WORKFLOW_FILE = "radar.yml";
const API_BASE = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}`;

function getToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export interface WorkflowRunStatus {
  configured: boolean;
  status: string | null; // queued | in_progress | completed | null(未設定/取得不可)
  conclusion: string | null; // success | failure | cancelled | null
  htmlUrl: string | null;
  createdAt: string | null;
  runNumber: number | null;
}

/** 直近の実行1件のステータス。GITHUB_TOKEN未設定やAPI失敗時は configured:false で返す（画面を壊さない） */
export async function getLatestWorkflowRun(): Promise<WorkflowRunStatus> {
  if (!getToken()) {
    return {
      configured: false,
      status: null,
      conclusion: null,
      htmlUrl: null,
      createdAt: null,
      runNumber: null,
    };
  }
  try {
    const res = await githubFetch("/runs?per_page=1");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      workflow_runs: Array<{
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
        run_number: number;
      }>;
    };
    const run = data.workflow_runs[0];
    if (!run) {
      return { configured: true, status: null, conclusion: null, htmlUrl: null, createdAt: null, runNumber: null };
    }
    return {
      configured: true,
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      runNumber: run.run_number,
    };
  } catch (e) {
    console.warn(`[github-actions] 実行状況の取得に失敗: ${e}`);
    return { configured: true, status: null, conclusion: null, htmlUrl: null, createdAt: null, runNumber: null };
  }
}

/** workflow_dispatchで即時実行をトリガーする（radar.ymlは on.workflow_dispatch: {} 設定済み） */
export async function triggerWorkflowRun(): Promise<void> {
  const res = await githubFetch("/dispatches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub Actions手動実行に失敗しました（HTTP ${res.status}） ${body.slice(0, 200)}`);
  }
}
