import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { MockGitLabServer } from "./utils/mock-gitlab-server.js";

const TOKEN = "gitlab-11-local-fixture-token";
const PROJECT = "/projects/123";
const MR = `${PROJECT}/merge_requests/7`;
const DATE = "2019-05-22T10:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const CI_YAML = "# UTF-8 配置\ntest:\n  script: echo ok\n";

// Synthetic GitLab 11.11 response fixtures: intentionally omit fields added in later releases.
const commit = {
  id: SHA,
  short_id: SHA.slice(0, 8),
  title: "Preserve legacy response compatibility",
  author_name: "Fixture User",
  author_email: "fixture@example.invalid",
  authored_date: DATE,
  committer_name: "Fixture User",
  committer_email: "fixture@example.invalid",
  committed_date: DATE,
  created_at: DATE,
  message: "Preserve legacy response compatibility\n",
  parent_ids: [],
};
const branch = {
  name: "feature/legacy",
  commit,
  merged: false,
  protected: false,
  developers_can_push: true,
  developers_can_merge: false,
  can_push: true,
  default: false,
};
const tag = { name: "v1.0.0", message: null, target: SHA, commit, release: null };
const mergeRequest = {
  id: 70,
  iid: 7,
  project_id: 123,
  title: "Keep the original title",
  description: "Synthetic local fixture",
  state: "opened",
  author: { id: 1, name: "Fixture User", username: "fixture" },
  source_branch: "feature/legacy",
  target_branch: "main",
  web_url: "https://gitlab.example.invalid/project/merge_requests/7",
  created_at: DATE,
  updated_at: DATE,
  merged_at: null,
  closed_at: null,
  merge_commit_sha: null,
  work_in_progress: false,
};
const changes = [
  { old_path: "src/old.ts", new_path: "src/new.ts", renamed_file: true },
  { old_path: "README.md", new_path: "README.md", renamed_file: false },
  { old_path: "test/core.ts", new_path: "test/core.ts", renamed_file: false },
].map(file => ({
  ...file,
  a_mode: "100644",
  b_mode: "100644",
  new_file: false,
  deleted_file: false,
  diff: "@@ -1 +1 @@\n-before\n+after\n",
}));
const version = {
  id: 8,
  head_commit_sha: SHA,
  base_commit_sha: SHA,
  start_commit_sha: SHA,
  created_at: DATE,
  merge_request_id: 70,
  state: "collected",
  real_size: "3",
};
const shortPipeline = {
  id: 42,
  sha: SHA,
  ref: "main",
  status: "success",
  web_url: "https://gitlab.example.invalid/project/pipelines/42",
};
const pipeline = { ...shortPipeline, created_at: DATE, updated_at: DATE };
const job = {
  id: 99,
  name: "test",
  stage: "test",
  ref: "main",
  tag: false,
  status: "success",
  created_at: DATE,
  user: null,
  pipeline: { id: 42, sha: SHA, ref: "main", status: "success" },
};
const treeItems = [{ id: SHA, name: "README.md", path: "README.md", type: "blob", mode: "100644" }];
const file = {
  file_name: "README.md",
  file_path: "README.md",
  size: 6,
  encoding: "base64",
  content: Buffer.from("hello\n").toString("base64"),
  ref: "main",
  blob_id: SHA,
  commit_id: SHA,
  last_commit_id: SHA,
};
const schedule = {
  id: 3,
  description: "Nightly",
  ref: "main",
  cron: "0 1 * * *",
  cron_timezone: "UTC",
  active: true,
  created_at: DATE,
  updated_at: DATE,
  next_run_at: DATE,
  owner: { id: 1, username: "fixture" },
};
const scheduleVariable = { key: "TARGET", value: "test", variable_type: "env_var" };

type RecordedRequest = {
  method: string;
  path: string;
  query: Request["query"];
  body: Record<string, unknown>;
  privateToken: string | undefined;
  authorization: string | undefined;
};

async function startFixture(
  gitlabVersion: string,
  versionStatus = 200,
  env: Record<string, string> = {}
) {
  const requests: RecordedRequest[] = [];
  const mock = new MockGitLabServer({ port: 0, validTokens: [TOKEN] });
  let title = mergeRequest.title;
  function route(
    method: "get" | "post" | "put" | "delete",
    path: string,
    handler: (req: Request, res: Response) => unknown
  ) {
    mock.addMockHandler(method, path, (req, res) => {
      requests.push({
        method: req.method,
        path,
        query: req.query,
        body: req.body ?? {},
        privateToken: req.get("Private-Token"),
        authorization: req.get("Authorization"),
      });
      handler(req, res);
    });
  }
  route("get", "/version", (_req, res) =>
    res.status(versionStatus).json({ version: gitlabVersion, revision: "fixture" })
  );
  route("get", `${PROJECT}/repository/commits`, (_req, res) => res.json([commit]));
  route("get", `${PROJECT}/repository/commits/${SHA}`, (_req, res) => res.json(commit));
  route("post", `${PROJECT}/repository/commits`, (_req, res) => res.status(201).json(commit));
  route("get", `${PROJECT}/repository/branches`, (_req, res) => res.json([branch]));
  route("get", `${PROJECT}/repository/branches/feature%2Flegacy`, (_req, res) => res.json(branch));
  route("post", `${PROJECT}/repository/branches`, (_req, res) => res.status(201).json(branch));
  route("post", `${PROJECT}/protected_branches`, (_req, res) =>
    res.status(201).json({ name: "main", unprotect_access_levels: [{ access_level: 40 }] })
  );
  route("get", `${PROJECT}/repository/tags`, (_req, res) => res.json([tag]));
  route("get", `${PROJECT}/repository/tags/v1.0.0`, (_req, res) => res.json(tag));
  route("post", `${PROJECT}/repository/tags`, (_req, res) => res.status(201).json(tag));
  route("get", `${PROJECT}/repository/tree`, (req, res) => {
    if (req.query.pagination === "keyset") res.set("X-Next-Page-Token", "next-keyset-token");
    else res.set("X-Next-Page", "3");
    res.json(treeItems);
  });
  route("get", `${PROJECT}/repository/files/README.md`, (_req, res) => res.json(file));
  route("get", `${PROJECT}/repository/files/.gitlab-ci.yml`, (req, res) =>
    res.json({
      file_path: ".gitlab-ci.yml",
      encoding: "base64",
      content: Buffer.from(req.query.ref === "invalid-config" ? "invalid" : CI_YAML).toString(
        "base64"
      ),
    })
  );
  route("get", `${PROJECT}/repository/files/new.txt`, (_req, res) =>
    res.status(404).json({ message: "404 File Not Found" })
  );
  for (const method of ["post", "put"] as const) {
    for (const name of ["README.md", "new.txt"]) {
      route(method, `${PROJECT}/repository/files/${name}`, (_req, res) =>
        res.json({ file_path: name, branch: "main" })
      );
    }
  }
  route("get", `${PROJECT}/merge_requests`, (_req, res) => res.json([{ ...mergeRequest, title }]));
  route("get", MR, (_req, res) => res.json({ ...mergeRequest, title }));
  route("post", `${PROJECT}/merge_requests`, (req, res) =>
    res.status(201).json({ ...mergeRequest, title: req.body.title })
  );
  route("put", MR, (req, res) => {
    title = req.body.title ?? title;
    res.json({ ...mergeRequest, title });
  });
  route("put", `${MR}/merge`, (_req, res) => res.json({ ...mergeRequest, title, state: "merged" }));
  route("get", `${MR}/changes`, (_req, res) => res.json({ ...mergeRequest, changes }));
  route("get", `${MR}/diffs`, (_req, res) =>
    gitlabVersion.startsWith("11.")
      ? res.status(404).json({ message: "404 Not Found" })
      : res.json(changes)
  );
  route("get", `${MR}/versions`, (_req, res) => res.json([version]));
  route("get", `${MR}/versions/8`, (_req, res) =>
    res.json({ ...version, commits: [commit], diffs: changes })
  );
  route("get", `${PROJECT}/pipelines`, (_req, res) => res.json([shortPipeline]));
  route("get", `${PROJECT}/pipelines/42`, (_req, res) => res.json(pipeline));
  route("post", `${PROJECT}/pipeline`, (_req, res) => res.status(201).json(pipeline));
  for (const action of ["retry", "cancel"]) {
    route("post", `${PROJECT}/pipelines/42/${action}`, (_req, res) => res.json(pipeline));
  }
  route("get", `${PROJECT}/pipelines/42/jobs`, (_req, res) => res.json([job]));
  route("get", `${PROJECT}/jobs/99`, (_req, res) => res.json(job));
  for (const action of ["play", "retry", "cancel"]) {
    route("post", `${PROJECT}/jobs/99/${action}`, (_req, res) => res.json(job));
  }
  route("post", "/ci/lint", (req, res) =>
    res.json({
      status: req.body.content === "invalid" ? "invalid" : "valid",
      errors: req.body.content === "invalid" ? ["Invalid CI configuration"] : [],
    })
  );
  route("post", `${PROJECT}/ci/lint`, (_req, res) =>
    res.status(404).json({ message: "404 Not Found" })
  );
  route("get", `${PROJECT}/pipeline_schedules`, (_req, res) => res.json([schedule]));
  route("get", `${PROJECT}/pipeline_schedules/3`, (_req, res) =>
    res.json({ ...schedule, last_pipeline: shortPipeline, variables: [scheduleVariable] })
  );
  route("get", `${PROJECT}/pipeline_schedules/3/variables/TARGET`, (_req, res) =>
    gitlabVersion.startsWith("11.")
      ? res.status(404).json({ message: "404 Not Found" })
      : res.json(scheduleVariable)
  );
  route("post", `${PROJECT}/pipeline_schedules`, (_req, res) => res.status(201).json(schedule));
  route("put", `${PROJECT}/pipeline_schedules/3`, (_req, res) => res.json(schedule));
  for (const path of ["test_report", "test_report_summary", "bridges"]) {
    route("get", `${PROJECT}/pipelines/42/${path}`, (_req, res) =>
      res.status(404).json({ message: "404 Not Found" })
    );
  }
  await mock.start();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    stderr: "pipe",
    env: {
      ...getDefaultEnvironment(),
      GITLAB_PERSONAL_ACCESS_TOKEN: TOKEN,
      GITLAB_API_URL: `${mock.getUrl()}/api/v4`,
      GITLAB_IS_OLD: "true",
      GITLAB_PERMISSION_MODE: "full",
      GITLAB_TOOLSETS: "all",
      GITLAB_MASKING_ENABLED: "false",
      GITLAB_DISABLE_VERSION_CHECK: "true",
      LOG_LEVEL: "error",
      ...env,
    },
  });
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name: "gitlab-11-core-regression", version: "1.0.0" });
  async function close() {
    try {
      await client.close();
    } finally {
      try {
        await transport.close();
      } finally {
        await mock.stop();
      }
    }
  }
  try {
    await client.connect(transport);
  } catch (error) {
    await close();
    throw error;
  }
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: { project_id: "123", ...args } });
    assert.ok("content" in result && Array.isArray(result.content));
    const text = result.content.find(item => item.type === "text")?.text;
    assert.equal(typeof text, "string", `${name} must return text content`);
    assert.notEqual(result.isError, true, `${name}: ${text}`);
    return text as string;
  }
  async function json(name: string, args: Record<string, unknown> = {}) {
    return JSON.parse(await call(name, args));
  }
  async function rejects(name: string, args: Record<string, unknown>, pattern: RegExp) {
    try {
      const result = await client.callTool({ name, arguments: { project_id: "123", ...args } });
      assert.equal(
        result.isError,
        true,
        `${name} unexpectedly succeeded: ${JSON.stringify(result)}`
      );
      assert.match(JSON.stringify(result), pattern);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      assert.match(String(error), pattern);
    }
  }
  function last(method: string, path: string) {
    const request = requests.filter(req => req.method === method && req.path === path).at(-1);
    assert.ok(request, `Missing ${method} ${path}`);
    return request;
  }
  return { mock, requests, call, json, rejects, last, close };
}

describe("GitLab 11.11.8 core tools over MCP STDIO", { timeout: 60_000 }, () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  before(async () => {
    fixture = await startFixture("11.11.8");
  });
  after(async () => {
    if (fixture) await fixture.close();
  });

  test("reads and creates commits without web_url and authenticates with Private-Token", async () => {
    const commits = await fixture.json("list_commits");
    assert.equal(commits[0].id, SHA);
    assert.equal(commits[0].web_url, undefined);
    const created = await fixture.json("push_files", {
      branch: "main",
      commit_message: "Create fixture",
      files: [{ file_path: "new.txt", content: "hello" }],
    });
    assert.equal(created.id, SHA);
    assert.equal(created.web_url, undefined);
    const request = fixture.last("POST", `${PROJECT}/repository/commits`);
    assert.equal(request.privateToken, TOKEN);
    assert.equal(request.authorization, undefined);
    assert.equal(request.body.commit_message, "Create fixture");
  });

  test("reads and creates branches whose nested commit has no web_url", async () => {
    const listed = await fixture.json("list_branches");
    const fetched = await fixture.json("get_branch", { branch_name: "feature/legacy" });
    const created = await fixture.json("create_branch", { branch: "feature/legacy", ref: "main" });
    for (const value of [listed[0], fetched, created]) {
      assert.equal(value.commit.id, SHA);
      assert.equal(value.commit.web_url, undefined);
    }
    assert.equal(fixture.last("POST", `${PROJECT}/repository/branches`).body.ref, "main");
  });

  test("reads and creates tags without protected or created_at", async () => {
    const listed = await fixture.json("list_tags");
    const fetched = await fixture.json("get_tag", { tag_name: "v1.0.0" });
    const created = await fixture.json("create_tag", { tag_name: "v1.0.0", ref: "main" });
    for (const value of [listed[0], fetched, created]) {
      assert.equal(value.name, "v1.0.0");
      assert.equal(value.protected, undefined);
      assert.equal(value.created_at, undefined);
    }
  });

  test("passes numeric tree pages and exposes the next offset page", async () => {
    const value = await fixture.json("get_repository_tree", { page: 2, per_page: 1 });
    assert.deepEqual(value.items, treeItems);
    assert.equal(value.next_page, 3);
    const request = fixture.last("GET", `${PROJECT}/repository/tree`);
    assert.equal(request.query.page, "2");
    assert.equal(request.query.per_page, "1");
  });

  test("exposes implicit legacy offset continuation without silently truncating the tree", async () => {
    const value = await fixture.json("get_repository_tree");
    assert.deepEqual(value.items, treeItems);
    assert.equal(value.next_page, 3);
    assert.equal(fixture.last("GET", `${PROJECT}/repository/tree`).query.page, undefined);
  });

  test("reads, creates and updates repository files using the existing response shape", async () => {
    const value = await fixture.json("get_file_contents", { file_path: "README.md", ref: "main" });
    assert.equal(value.content, "hello\n");
    for (const filePath of ["new.txt", "README.md"]) {
      assert.deepEqual(
        await fixture.json("create_or_update_file", {
          file_path: filePath,
          content: "updated",
          branch: "main",
          commit_message: "Update fixture",
        }),
        { file_path: filePath, branch: "main" }
      );
    }
    assert.equal(fixture.last("POST", `${PROJECT}/repository/files/new.txt`).body.branch, "main");
    const update = fixture.last("PUT", `${PROJECT}/repository/files/README.md`).body;
    assert.equal(update.commit_id, SHA);
    assert.equal(update.last_commit_id, SHA);
  });

  test("reads MRs and paginates /changes locally without requesting /diffs", async () => {
    const mr = await fixture.json("get_merge_request", { merge_request_iid: "7" });
    assert.equal(mr.iid, "7");
    const listed = await fixture.json("list_merge_requests", {
      state: "opened",
      source_branch: "feature/legacy",
    });
    assert.equal(listed[0].source_branch, "feature/legacy");
    const result = await fixture.json("list_merge_request_diffs", {
      merge_request_iid: "7",
      page: 2,
      per_page: 1,
    });
    assert.deepEqual(result, [changes[1]]);
    assert.equal(fixture.last("GET", `${PROJECT}/merge_requests`).query.state, "opened");
    assert.equal(fixture.requests.filter(req => req.path === `${MR}/diffs`).length, 0);
  });

  test("finds a renamed file by either old or new path through /changes", async () => {
    for (const path of ["src/old.ts", "src/new.ts"]) {
      assert.deepEqual(
        await fixture.json("get_merge_request_file_diff", {
          merge_request_iid: "7",
          file_paths: [path],
        }),
        [changes[0]]
      );
    }
    assert.equal(fixture.requests.filter(req => req.path === `${MR}/diffs`).length, 0);
  });

  test("reads historical MR versions without patch_id_sha", async () => {
    const listed = await fixture.json("list_merge_request_versions", { merge_request_iid: "7" });
    assert.equal(listed[0].id, 8);
    assert.equal(listed[0].patch_id_sha, undefined);
    const detailed = await fixture.json("get_merge_request_version", {
      merge_request_iid: "7",
      version_id: 8,
    });
    assert.equal(detailed.diffs.length, 3);
    assert.equal(detailed.commits[0].id, SHA);
  });

  test("translates MR draft creation and updates while retaining the original title text", async () => {
    await fixture.json("create_merge_request", {
      source_branch: "feature/legacy",
      target_branch: "main",
      title: "Review this change",
      draft: true,
    });
    let body = fixture.last("POST", `${PROJECT}/merge_requests`).body;
    assert.equal(body.title, "WIP: Review this change");
    assert.equal(Object.hasOwn(body, "draft"), false);
    await fixture.json("update_merge_request", { merge_request_iid: "7", draft: true });
    body = fixture.last("PUT", MR).body;
    assert.equal(body.title, "WIP: Keep the original title");
    assert.equal(Object.hasOwn(body, "draft"), false);
    await fixture.json("update_merge_request", { merge_request_iid: "7", draft: false });
    body = fixture.last("PUT", MR).body;
    assert.equal(body.title, "Keep the original title");
    assert.equal(Object.hasOwn(body, "draft"), false);
    await fixture.json("update_merge_request", {
      merge_request_iid: "7",
      title: "New title",
      draft: true,
    });
    assert.equal(fixture.last("PUT", MR).body.title, "WIP: New title");
    await fixture.json("update_merge_request", { merge_request_iid: "7", draft: false });
    assert.equal(fixture.last("PUT", MR).body.title, "New title");
    for (const title of ["[WIP] Preserve punctuation: text", "(WIP) Preserve punctuation: text"]) {
      await fixture.json("update_merge_request", { merge_request_iid: "7", title, draft: false });
      assert.equal(fixture.last("PUT", MR).body.title, "Preserve punctuation: text");
    }
  });

  test("rejects reviewer assignment before creating or updating an MR", async () => {
    const writesBefore = fixture.requests.filter(req => req.method !== "GET").length;
    await fixture.rejects(
      "create_merge_request",
      {
        source_branch: "feature/legacy",
        target_branch: "main",
        title: "Review",
        reviewer_ids: [1],
      },
      /reviewer_ids.*(support|GitLab)|(?:support|GitLab).*reviewer_ids/i
    );
    await fixture.rejects(
      "update_merge_request",
      { merge_request_iid: "7", reviewer_ids: [1] },
      /reviewer_ids.*(support|GitLab)|(?:support|GitLab).*reviewer_ids/i
    );
    assert.equal(fixture.requests.filter(req => req.method !== "GET").length, writesBefore);
  });

  test("translates auto_merge, preserves the SHA guard and rejects conflicting flags before merging", async () => {
    await fixture.json("merge_merge_request", {
      merge_request_iid: "7",
      auto_merge: true,
      sha: SHA,
    });
    const body = fixture.last("PUT", `${MR}/merge`).body;
    assert.equal(body.merge_when_pipeline_succeeds, true);
    assert.equal(body.sha, SHA);
    assert.equal(Object.hasOwn(body, "auto_merge"), false);
    const count = fixture.requests.filter(req => req.path === `${MR}/merge`).length;
    for (const autoMerge of [true, false]) {
      await fixture.rejects(
        "merge_merge_request",
        {
          merge_request_iid: "7",
          auto_merge: autoMerge,
          merge_when_pipeline_succeeds: !autoMerge,
        },
        /conflict|same|agree|contradict/i
      );
    }
    assert.equal(fixture.requests.filter(req => req.path === `${MR}/merge`).length, count);
  });

  test("accepts legacy pipeline list and detail payloads without fabricating absent project_id", async () => {
    const listed = await fixture.json("list_pipelines");
    assert.equal(listed[0].id, "42");
    assert.equal(listed[0].project_id, undefined);
    assert.equal(listed[0].created_at, undefined);
    assert.equal(listed[0].updated_at, undefined);
    const detail = await fixture.json("get_pipeline", { pipeline_id: "42" });
    assert.equal(detail.id, "42");
    assert.equal(detail.project_id, undefined);
    assert.equal(detail.created_at, DATE);
    assert.match(
      await fixture.call("create_pipeline", {
        ref: "main",
        variables: [{ key: "TARGET", value: "test" }],
      }),
      /Created pipeline #42/
    );
    assert.match(
      await fixture.call("retry_pipeline", { pipeline_id: "42" }),
      /Retried pipeline #42/
    );
    assert.match(
      await fixture.call("cancel_pipeline", { pipeline_id: "42" }),
      /Canceled pipeline #42/
    );
    assert.deepEqual(fixture.last("POST", `${PROJECT}/pipeline`).body.variables, [
      { key: "TARGET", value: "test" },
    ]);
  });

  test("accepts jobs without nested pipeline project_id and waits for terminal pipeline and job statuses", async () => {
    const listed = await fixture.json("list_pipeline_jobs", { pipeline_id: "42" });
    assert.equal(listed[0].pipeline.id, "42");
    assert.equal(listed[0].pipeline.project_id, undefined);
    const waitedPipeline = await fixture.json("wait_for_pipeline", {
      pipeline_id: "42",
      timeout_seconds: 2,
      poll_interval_seconds: 1,
    });
    assert.equal(waitedPipeline.status, "success");
    const waitedJob = await fixture.json("wait_for_job", {
      job_id: "99",
      timeout_seconds: 2,
      poll_interval_seconds: 1,
    });
    assert.equal(waitedJob.status, "success");
    assert.equal(waitedJob.user, null);
    assert.equal(waitedJob.pipeline.project_id, undefined);
  });

  test("plays, retries and cancels legacy jobs whose response user is null", async () => {
    for (const [action, summary] of [
      ["play", "Ran"],
      ["retry", "Retried"],
      ["cancel", "Canceled"],
    ]) {
      assert.match(
        await fixture.call(`${action}_pipeline_job`, { job_id: "99" }),
        new RegExp(`${summary} job #99`)
      );
      fixture.last("POST", `${PROJECT}/jobs/99/${action}`);
    }
  });

  test("preserves supported GitLab 11 EE unprotect access when protecting a branch", async () => {
    const result = await fixture.json("protect_branch", {
      branch_name: "main",
      unprotect_access_level: 40,
    });
    assert.equal(result.name, "main");
    assert.equal(
      fixture.last("POST", `${PROJECT}/protected_branches`).body.unprotect_access_level,
      40
    );
  });

  test("rejects modern pipeline and job inputs before mutation", async () => {
    const writesBefore = fixture.requests.filter(req => req.method !== "GET").length;
    await fixture.rejects(
      "create_pipeline",
      { ref: "main", inputs: { environment: "test" } },
      /inputs.*(support|GitLab)|(?:support|GitLab).*inputs/i
    );
    for (const name of ["play_pipeline_job", "retry_pipeline_job"]) {
      await fixture.rejects(
        name,
        { job_id: "99", job_inputs: { environment: "test" } },
        /job_inputs.*(support|GitLab)|(?:support|GitLab).*job_inputs/i
      );
    }
    assert.equal(fixture.requests.filter(req => req.method !== "GET").length, writesBefore);
  });

  test("uses global legacy CI lint and converts valid and invalid status accurately", async () => {
    for (const [content, valid] of [
      ["test:\n  script: echo ok", true],
      ["invalid", false],
    ] as const) {
      const result = await fixture.json("validate_ci_lint", { content });
      assert.equal(result.valid, valid);
      assert.deepEqual(result.errors, valid ? [] : ["Invalid CI configuration"]);
      assert.equal(fixture.last("POST", "/ci/lint").body.content, content);
    }
    assert.equal(fixture.requests.filter(req => req.path === `${PROJECT}/ci/lint`).length, 0);
  });

  test("reads and decodes project CI config before global legacy lint validation", async () => {
    for (const [contentRef, content, valid] of [
      ["main", CI_YAML, true],
      ["invalid-config", "invalid", false],
    ] as const) {
      const result = await fixture.json("validate_project_ci_lint", { content_ref: contentRef });
      assert.equal(result.valid, valid);
      assert.deepEqual(result.errors, valid ? [] : ["Invalid CI configuration"]);
      assert.equal(result.jobs, undefined);
      assert.equal(
        fixture.last("GET", `${PROJECT}/repository/files/.gitlab-ci.yml`).query.ref,
        contentRef
      );
      assert.deepEqual(fixture.last("POST", "/ci/lint").body, { content });
    }
    assert.equal(fixture.requests.filter(req => req.path === `${PROJECT}/ci/lint`).length, 0);
  });

  test("rejects unsupported project CI lint capabilities before reading files or posting content", async () => {
    const count = fixture.mock.getRequestCount();
    for (const options of [{ dry_run: true }, { include_jobs: true }, { dry_run_ref: "main" }]) {
      await fixture.rejects(
        "validate_project_ci_lint",
        { content_ref: "main", ...options },
        /GitLab 11.*(?:simulate|supported|only validates)/i
      );
    }
    await fixture.rejects(
      "validate_ci_lint",
      { content: CI_YAML, ref: "main" },
      /GitLab 11.*(?:simulate|supported|only validates)/i
    );
    assert.equal(fixture.mock.getRequestCount(), count);
  });

  test("keeps the core pipeline schedule read and write APIs working", async () => {
    const listed = await fixture.json("list_pipeline_schedules", {
      scope: "active",
      page: 2,
      per_page: 5,
    });
    assert.equal(listed[0].id, "3");
    const query = fixture.last("GET", `${PROJECT}/pipeline_schedules`).query;
    assert.equal(query.scope, "active");
    assert.equal(query.page, "2");
    assert.equal(query.per_page, "5");
    const detail = await fixture.json("get_pipeline_schedule", { pipeline_schedule_id: "3" });
    assert.equal(detail.last_pipeline.id, "42");
    const variable = await fixture.json("get_pipeline_schedule_variable", {
      pipeline_schedule_id: "3",
      key: "TARGET",
    });
    assert.deepEqual(variable, scheduleVariable);
    await fixture.rejects(
      "get_pipeline_schedule_variable",
      { pipeline_schedule_id: "3", key: "MISSING" },
      /variable not found.*MISSING/i
    );
    assert.equal(fixture.requests.filter(req => req.path.includes("/variables/")).length, 0);
    assert.match(
      await fixture.call("create_pipeline_schedule", {
        description: "Nightly",
        ref: "main",
        cron: "0 1 * * *",
      }),
      /Created pipeline schedule #3/
    );
    assert.match(
      await fixture.call("update_pipeline_schedule", { pipeline_schedule_id: "3", active: false }),
      /Updated pipeline schedule #3/
    );
    assert.equal(fixture.last("PUT", `${PROJECT}/pipeline_schedules/3`).body.active, false);
  });

  test("rejects unsupported legacy read filters, sort orders and mutation fields before target requests", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_repository_tree", { pagination: "keyset" }],
      ["get_repository_tree", { page_token: "cursor" }],
      ["list_commits", { first_parent: true }],
      ["list_commits", { author: "Fixture User" }],
      ["list_merge_requests", { reviewer_username: "fixture" }],
      ["list_merge_requests", { order_by: "priority" }],
      ["list_group_merge_requests", { group_id: "1", author_username: "fixture" }],
      ["list_group_merge_requests", { group_id: "1", non_archived: true }],
      ["list_pipelines", { updated_after: DATE }],
      ["list_pipelines", { order_by: "updated_at" }],
      ["list_pipeline_jobs", { pipeline_id: "42", include_retried: true }],
      [
        "create_pipeline_schedule",
        {
          description: "Nightly",
          ref: "main",
          cron: "0 1 * * *",
          inputs: [{ name: "target", value: "test" }],
        },
      ],
      [
        "play_pipeline_job",
        { job_id: "99", job_variables_attributes: [{ key: "TARGET", value: "test" }] },
      ],
      ["cancel_pipeline_job", { job_id: "99", force: true }],
      ["rebase_merge_request", { merge_request_iid: "7", skip_ci: true }],
      ["approve_merge_request", { merge_request_iid: "7", approval_password: "synthetic-fixture" }],
    ];
    const count = fixture.mock.getRequestCount();
    for (const [name, args] of calls) {
      await fixture.rejects(
        name,
        args,
        /(?:unsupported|not supported).*GitLab|GitLab.*(?:unsupported|not supported)/i
      );
    }
    assert.equal(fixture.mock.getRequestCount(), count);
  });

  test("reports advanced pipeline APIs as unsupported instead of returning fabricated results", async () => {
    const count = fixture.mock.getRequestCount();
    for (const name of [
      "get_pipeline_test_report",
      "get_pipeline_test_report_summary",
      "list_pipeline_trigger_jobs",
      "update_pipeline_metadata",
      "list_pipeline_schedule_pipelines",
      "play_pipeline_schedule",
      "list_job_artifacts",
      "update_protected_branch",
    ]) {
      await fixture.rejects(
        name,
        { pipeline_id: "42", pipeline_schedule_id: "3", job_id: "99", name: "main" },
        /(?:unsupported|not supported).*GitLab|GitLab.*(?:unsupported|not supported)/i
      );
    }
    assert.equal(fixture.mock.getRequestCount(), count);
    assert.equal(
      fixture.requests.filter(req => /\/(test_report|test_report_summary|bridges)$/.test(req.path))
        .length,
      0
    );
  });
});

describe("modern GitLab retains current MCP behavior", { timeout: 30_000 }, () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  before(async () => {
    fixture = await startFixture("18.3.1-ee");
  });
  after(async () => {
    if (fixture) await fixture.close();
  });

  test("retains the modern tree array unless an explicit page opts into offset metadata", async () => {
    assert.deepEqual(await fixture.json("get_repository_tree"), treeItems);
    const value = await fixture.json("get_repository_tree", { page: 2 });
    assert.deepEqual(value.items, treeItems);
    assert.equal(value.next_page, 3);
  });

  test("preserves keyset tree arguments and continuation metadata", async () => {
    const value = await fixture.json("get_repository_tree", {
      pagination: "keyset",
      page_token: "initial-token",
    });
    assert.deepEqual(value.items, treeItems);
    assert.equal(value.next_page_token, "next-keyset-token");
    assert.equal(typeof value.pagination_note, "string");
    const request = fixture.last("GET", `${PROJECT}/repository/tree`);
    assert.equal(request.query.pagination, "keyset");
    assert.equal(request.query.page_token, "initial-token");
  });

  test("uses /diffs with pagination and unidiff instead of legacy /changes", async () => {
    assert.deepEqual(
      await fixture.json("list_merge_request_diffs", {
        merge_request_iid: "7",
        page: 2,
        per_page: 3,
        unidiff: true,
      }),
      changes
    );
    const request = fixture.last("GET", `${MR}/diffs`);
    assert.equal(request.query.page, "2");
    assert.equal(request.query.per_page, "3");
    assert.equal(request.query.unidiff, "true");
    assert.equal(fixture.requests.filter(req => req.path === `${MR}/changes`).length, 0);
  });

  test("sends modern draft, reviewers and auto_merge parameters without legacy rewriting", async () => {
    await fixture.json("create_merge_request", {
      source_branch: "feature/legacy",
      target_branch: "main",
      title: "Modern draft",
      draft: true,
      reviewer_ids: [1],
    });
    const created = fixture.last("POST", `${PROJECT}/merge_requests`).body;
    assert.equal(created.title, "Modern draft");
    assert.equal(created.draft, true);
    assert.deepEqual(created.reviewer_ids, [1]);
    await fixture.json("merge_merge_request", {
      merge_request_iid: "7",
      auto_merge: true,
      sha: SHA,
    });
    const merged = fixture.last("PUT", `${MR}/merge`).body;
    assert.equal(merged.auto_merge, true);
    assert.equal(merged.sha, SHA);
    assert.notEqual(merged.merge_when_pipeline_succeeds, true);
  });

  test("preserves modern pipeline inputs, read filters and schedule-variable endpoints", async () => {
    await fixture.call("create_pipeline", { ref: "main", inputs: { target: "test" } });
    assert.deepEqual(fixture.last("POST", `${PROJECT}/pipeline`).body.inputs, { target: "test" });
    await fixture.json("list_pipelines", { updated_after: DATE, order_by: "updated_at" });
    const query = fixture.last("GET", `${PROJECT}/pipelines`).query;
    assert.equal(query.updated_after, DATE);
    assert.equal(query.order_by, "updated_at");
    await fixture.json("list_merge_requests", {
      reviewer_username: "fixture",
      order_by: "priority",
    });
    assert.equal(
      fixture.last("GET", `${PROJECT}/merge_requests`).query.reviewer_username,
      "fixture"
    );
    assert.equal(fixture.last("GET", `${PROJECT}/merge_requests`).query.order_by, "priority");
    assert.deepEqual(
      await fixture.json("get_pipeline_schedule_variable", {
        pipeline_schedule_id: "3",
        key: "TARGET",
      }),
      scheduleVariable
    );
    fixture.last("GET", `${PROJECT}/pipeline_schedules/3/variables/TARGET`);
    assert.equal(
      fixture.requests.filter(req => req.path === `${PROJECT}/pipeline_schedules/3`).length,
      0
    );
  });
});

test(
  "auto_merge aborts before any PUT when version metadata is unavailable or invalid",
  { timeout: 30_000 },
  async () => {
    for (const [version, status] of [
      ["11.11.8", 503],
      ["not-a-version", 200],
    ] as const) {
      const fixture = await startFixture(version, status);
      try {
        await fixture.rejects(
          "merge_merge_request",
          { merge_request_iid: "7", auto_merge: true, sha: SHA },
          /(?:cannot|unable).*determine.*GitLab.*version/i
        );
        assert.equal(fixture.requests.filter(req => req.method === "PUT").length, 0);
        assert.equal(fixture.last("GET", "/version").privateToken, TOKEN);
      } finally {
        await fixture.close();
      }
    }
  }
);

test(
  "legacy global CI lint enforces project scope before sending a request",
  { timeout: 15_000 },
  async () => {
    const fixture = await startFixture("11.11.8", 200, {
      GITLAB_ALLOWED_PROJECT_IDS: "123",
      ENABLE_STRICT_PROJECT_SCOPE: "true",
    });
    try {
      const count = fixture.mock.getRequestCount();
      await fixture.rejects(
        "validate_ci_lint",
        { project_id: "999", content: "test:\n  script: echo ok" },
        /Access denied.*999.*allowed project list.*123/i
      );
      assert.equal(fixture.mock.getRequestCount(), count);
      assert.equal(fixture.requests.filter(req => req.method === "POST").length, 0);
    } finally {
      await fixture.close();
    }
  }
);
