import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GitLabMergeRequestSchema } from "../schemas.js";

const mr = {
  id: 70,
  iid: 7,
  project_id: 123,
  title: "Fixture MR",
  description: null,
  state: "opened",
  author: { id: 1, name: "Fixture", username: "fixture" },
  source_branch: "feature/fixture",
  target_branch: "main",
  web_url: "https://gitlab.example.invalid/group/repo/merge_requests/7",
  created_at: "2019-05-22T10:00:00Z",
  updated_at: "2019-05-22T10:00:00Z",
  merged_at: null,
  closed_at: null,
  merge_commit_sha: null,
};

describe("MR source and target project identity", () => {
  test("preserves numeric source and target project IDs as strings", () => {
    const parsed = GitLabMergeRequestSchema.parse({
      ...mr,
      source_project_id: 123,
      target_project_id: 123,
    });
    assert.equal(parsed.source_project_id, "123");
    assert.equal(parsed.target_project_id, "123");
  });

  test("keeps a fork source distinct from the target project", () => {
    const parsed = GitLabMergeRequestSchema.parse({
      ...mr,
      source_project_id: "456",
      target_project_id: "123",
    });
    assert.equal(parsed.source_project_id, "456");
    assert.equal(parsed.target_project_id, "123");
  });

  test("preserves a null source project instead of inventing an identity", () => {
    const parsed = GitLabMergeRequestSchema.parse({
      ...mr,
      source_project_id: null,
      target_project_id: 123,
    });
    assert.equal(parsed.source_project_id, null);
    assert.equal(parsed.target_project_id, "123");
  });

  test("accepts omitted IDs without deriving them from project_id", () => {
    const parsed = GitLabMergeRequestSchema.parse(mr);
    assert.equal(parsed.source_project_id, undefined);
    assert.equal(parsed.target_project_id, undefined);
  });
});
