import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GetRepositoryTreeSchema,
  GitLabBranchSchema,
  GitLabCommitSchema,
  GitLabMergeRequestApprovalsResponseSchema,
  GitLabMergeRequestApprovalStateSchema,
  GitLabMergeRequestVersionDetailSchema,
  GitLabMergeRequestVersionSchema,
  GitLabPipelineJobSchema,
  GitLabPipelineSchema,
  GitLabReferenceSchema,
  GitLabTagSchema,
  MergeMergeRequestSchema,
} from "../schemas.js";
import { parseApprovalsResponse } from "../utils/merge-request-summary.js";

// Sanitized fixtures follow v11.11.8 lib/api/entities.rb and the EE approvals API.
const sha = "1234567890abcdef1234567890abcdef12345678";
const date = "2019-05-22T10:00:00.000Z";
const commit = {
  id: sha,
  short_id: sha.slice(0, 8),
  title: "Add repository endpoint",
  message: "Add repository endpoint\n",
  created_at: date,
  parent_ids: ["abcdef1234567890abcdef1234567890abcdef12"],
  author_name: "Example Author",
  author_email: "author@example.com",
  authored_date: date,
  committer_name: "Example Committer",
  committer_email: "committer@example.com",
  committed_date: date,
};
const branch = {
  name: "main",
  commit,
  merged: false,
  protected: true,
  developers_can_push: false,
  developers_can_merge: false,
  can_push: true,
  default: true,
};
const tag = {
  name: "v1.0.0",
  message: null,
  target: sha,
  commit,
  release: { tag_name: "v1.0.0", description: "Release notes" },
};
const version = {
  id: 11,
  head_commit_sha: sha,
  base_commit_sha: commit.parent_ids[0],
  start_commit_sha: commit.parent_ids[0],
  created_at: date,
  merge_request_id: 12,
  state: "collected",
  real_size: "1",
};
const pipeline = {
  id: 13,
  sha,
  ref: "main",
  status: "success",
  web_url: "https://gitlab.example.com/group/project/pipelines/13",
};
const job = {
  id: 14,
  status: "success",
  stage: "test",
  name: "unit",
  ref: "main",
  tag: false,
  created_at: date,
  started_at: date,
  finished_at: date,
  duration: 1,
  commit,
  pipeline,
  runner: null,
  web_url: "https://gitlab.example.com/group/project/-/jobs/14",
};
const approvalUser = {
  id: 15,
  username: "reviewer",
  name: "Example Reviewer",
  state: "active",
  avatar_url: null,
  web_url: "https://gitlab.example.com/reviewer",
};
const approvals = {
  id: 12,
  iid: 2,
  project_id: 1,
  title: "Add repository endpoint",
  description: "Expose the repository endpoint",
  state: "opened",
  created_at: date,
  updated_at: date,
  merge_status: "cannot_be_merged",
  approvals_required: 2,
  approvals_left: 1,
  approved_by: [{ user: approvalUser }],
  approvers: [],
  approver_groups: [],
};

describe("GitLab 11.11.8 repository responses", () => {
  test("accepts commit and branch responses without commit web_url", () => {
    assert.equal(GitLabCommitSchema.parse(commit).web_url, undefined);
    assert.equal(GitLabReferenceSchema.parse(branch).commit.web_url, undefined);
    assert.equal(GitLabBranchSchema.parse(branch).commit.web_url, undefined);
  });

  test("retains commit URLs returned by modern GitLab", () => {
    const web_url = "https://gitlab.example.com/group/project/-/commit/" + sha;
    const modernCommit = { ...commit, web_url };
    assert.equal(GitLabCommitSchema.parse(modernCommit).web_url, web_url);
    assert.equal(
      GitLabReferenceSchema.parse({ ...branch, commit: modernCommit }).commit.web_url,
      web_url
    );
    assert.equal(
      GitLabBranchSchema.parse({ ...branch, commit: modernCommit }).commit.web_url,
      web_url
    );
  });

  test("keeps missing tag protection and tag creation time unknown", () => {
    const parsed = GitLabTagSchema.parse(tag);
    assert.equal(parsed.protected, undefined);
    assert.equal(parsed.created_at, undefined);
    assert.equal(parsed.commit.created_at, date);
  });

  test("retains modern tag protection and nullable creation time", () => {
    assert.equal(
      GitLabTagSchema.parse({ ...tag, protected: true, created_at: date }).protected,
      true
    );
    const parsed = GitLabTagSchema.parse({ ...tag, protected: false, created_at: null });
    assert.equal(parsed.protected, false);
    assert.equal(parsed.created_at, null);
  });
});

describe("GitLab 11.11.8 merge request versions", () => {
  test("accepts a version and its commits without modern metadata", () => {
    assert.equal(GitLabMergeRequestVersionSchema.parse(version).patch_id_sha, undefined);
    const parsed = GitLabMergeRequestVersionDetailSchema.parse({
      ...version,
      commits: [commit],
      diffs: [],
    });
    assert.equal(parsed.patch_id_sha, undefined);
    assert.equal(parsed.commits[0].web_url, undefined);
  });

  test("retains a modern patch id", () => {
    assert.equal(
      GitLabMergeRequestVersionSchema.parse({ ...version, patch_id_sha: sha }).patch_id_sha,
      sha
    );
  });
});

describe("GitLab 11.11.8 pipelines and jobs", () => {
  test("accepts PipelineBasic list responses without project id or timestamps", () => {
    const parsed = GitLabPipelineSchema.parse(pipeline);
    assert.equal(parsed.id, "13");
    assert.equal(parsed.project_id, undefined);
    assert.equal(parsed.created_at, undefined);
    assert.equal(parsed.updated_at, undefined);
  });

  test("accepts pipeline details without project id and retains modern fields", () => {
    const details = { ...pipeline, created_at: date, updated_at: date };
    assert.equal(GitLabPipelineSchema.parse(details).created_at, date);
    assert.equal(GitLabPipelineSchema.parse({ ...details, project_id: 1 }).project_id, "1");
  });

  test("accepts a job embedding PipelineBasic and retains modern project id", () => {
    assert.equal(GitLabPipelineJobSchema.parse(job).pipeline?.project_id, undefined);
    const modernJob = { ...job, pipeline: { ...pipeline, project_id: 1 } };
    assert.equal(GitLabPipelineJobSchema.parse(modernJob).pipeline?.project_id, "1");
  });

  test("accepts null job users and validates populated user objects", () => {
    assert.equal(GitLabPipelineJobSchema.parse({ ...job, user: null }).user, null);
    assert.equal(
      GitLabPipelineJobSchema.parse({ ...job, user: approvalUser }).user?.username,
      approvalUser.username
    );
    assert.equal(GitLabPipelineJobSchema.safeParse({ ...job, user: { id: 15 } }).success, false);
  });
});

describe("GitLab response validation", () => {
  test("still rejects missing core fields", () => {
    assert.equal(
      GitLabCommitSchema.safeParse({ ...commit, author_email: undefined }).success,
      false
    );
    assert.equal(
      GitLabReferenceSchema.safeParse({ ...branch, commit: { id: undefined } }).success,
      false
    );
    assert.equal(GitLabBranchSchema.safeParse({ ...branch, protected: undefined }).success, false);
    assert.equal(GitLabTagSchema.safeParse({ ...tag, target: undefined }).success, false);
    assert.equal(
      GitLabMergeRequestVersionSchema.safeParse({ ...version, head_commit_sha: undefined }).success,
      false
    );
    assert.equal(GitLabPipelineSchema.safeParse({ ...pipeline, sha: undefined }).success, false);
    assert.equal(GitLabPipelineJobSchema.safeParse({ ...job, stage: undefined }).success, false);
    assert.equal(
      GitLabPipelineJobSchema.safeParse({ ...job, pipeline: { ...pipeline, ref: undefined } })
        .success,
      false
    );
  });
});

describe("GitLab 11.11.8 approvals", () => {
  test("preserves approval counts and derives pending approval from approvals_left", () => {
    const parsed = parseApprovalsResponse(approvals);
    assert.equal(parsed.approvals_required, 2);
    assert.equal(parsed.approvals_left, 1);
    assert.equal(parsed.approved, false);
    assert.equal(parsed.user_has_approved, undefined);
    assert.equal(parsed.user_can_approve, undefined);
    assert.deepEqual(parsed.approved_by_usernames, ["reviewer"]);
  });

  test("derives approval when no approvals remain, including zero required", () => {
    assert.equal(parseApprovalsResponse({ ...approvals, approvals_left: 0 }).approved, true);
    const parsed = parseApprovalsResponse({ approvals_required: 0, approvals_left: 0 });
    assert.equal(parsed.approved, true);
    assert.equal(parsed.approvals_required, 0);
    assert.equal(parsed.approvals_left, 0);
  });

  test("uses explicit modern approval flags ahead of counts", () => {
    assert.equal(parseApprovalsResponse({ ...approvals, approved: true }).approved, true);
    const parsed = parseApprovalsResponse({
      ...approvals,
      approvals_left: 0,
      approved: false,
      user_has_approved: true,
      user_can_approve: false,
    });
    assert.equal(parsed.approved, false);
    assert.equal(parsed.user_has_approved, true);
    assert.equal(parsed.user_can_approve, false);
  });

  test("keeps approval unknown when neither a flag nor remaining count is available", () => {
    assert.equal(
      parseApprovalsResponse({ approved_by: approvals.approved_by }).approved,
      undefined
    );
    assert.equal(parseApprovalsResponse({ approvals_required: 0 }).approved, undefined);
  });

  test("rejects invalid counts and incomplete approvers", () => {
    for (const field of ["approvals_required", "approvals_left"]) {
      for (const value of [-1, 0.5, null, "", " ", "0", "invalid", false, true, [], {}]) {
        assert.equal(
          GitLabMergeRequestApprovalsResponseSchema.safeParse({ [field]: value }).success,
          false
        );
        assert.equal(
          GitLabMergeRequestApprovalStateSchema.safeParse({ [field]: value }).success,
          false
        );
        assert.throws(() => parseApprovalsResponse({ [field]: value }));
      }
    }
    assert.throws(() => parseApprovalsResponse({ approved_by: [{ user: { id: 15 } }] }));
  });
});

describe("repository tree pagination arguments", () => {
  test("accepts positive offset pages and preserves keyset arguments", () => {
    assert.equal(GetRepositoryTreeSchema.parse({ project_id: "1", page: "2" }).page, 2);
    const parsed = GetRepositoryTreeSchema.parse({
      project_id: "1",
      pagination: "keyset",
      page_token: "next-tree-entry",
    });
    assert.equal(parsed.page, undefined);
    assert.equal(parsed.pagination, "keyset");
    assert.equal(parsed.page_token, "next-tree-entry");
  });

  test("rejects invalid offset pages", () => {
    for (const page of [0, -1, 0.5, "invalid"]) {
      assert.equal(GetRepositoryTreeSchema.safeParse({ project_id: "1", page }).success, false);
    }
  });
});

describe("merge scheduling arguments", () => {
  const args = { project_id: "1", merge_request_iid: "2" };

  test("preserves omitted scheduling flags and existing merge defaults", () => {
    const parsed = MergeMergeRequestSchema.parse({ ...args, sha });
    assert.equal(parsed.auto_merge, undefined);
    assert.equal(parsed.merge_when_pipeline_succeeds, undefined);
    assert.equal(parsed.should_remove_source_branch, false);
    assert.equal(parsed.squash, false);
    assert.equal(parsed.sha, sha);
  });

  test("accepts either explicit flag and matching flags", () => {
    for (const flag of [true, false]) {
      assert.equal(MergeMergeRequestSchema.parse({ ...args, auto_merge: flag }).auto_merge, flag);
      assert.equal(
        MergeMergeRequestSchema.parse({ ...args, merge_when_pipeline_succeeds: flag })
          .merge_when_pipeline_succeeds,
        flag
      );
      assert.equal(
        MergeMergeRequestSchema.parse({
          ...args,
          auto_merge: String(flag),
          merge_when_pipeline_succeeds: flag,
        }).auto_merge,
        flag
      );
    }
  });

  test("rejects conflicting explicit scheduling flags", () => {
    for (const auto_merge of [true, false]) {
      assert.equal(
        MergeMergeRequestSchema.safeParse({
          ...args,
          auto_merge,
          merge_when_pipeline_succeeds: !auto_merge,
        }).success,
        false
      );
    }
  });
});
