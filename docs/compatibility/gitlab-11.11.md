# GitLab 11.11 compatibility

This adaptation is based on upstream v2.3.19. It supports core repository,
merge-request, and pipeline workflows through GitLab 11.11's REST API v4.

## Authentication and version detection

Use a personal access token with the `api` scope. GitLab 11.11 does not provide
the later `read_api` scope. Set `GITLAB_IS_OLD=true` in the server's launch
environment to send the token with `Private-Token`. The existing permission
mode and project restrictions still apply.

Compatibility routing reads `/api/v4/version`. Successful version metadata is
cached per API URL until the MCP process restarts. Restart the process after a
GitLab upgrade. If version detection fails while old-instance authentication
is selected, version-dependent operations return an actionable error.
`auto_merge` also requires a readable version endpoint before any merge request.

## Merge-request project identity

Merge-request responses retain `source_project_id` and `target_project_id`,
including distinct IDs for fork merge requests. Missing IDs remain absent and
explicit null values remain null; neither is inferred from `project_id`.

## Core workflows

| Area                 | GitLab 11.11 behavior                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository files     | Existing file reads, single-file writes, and multi-file commits retain their existing API routes and validation.                                                                                                                                                 |
| Commits and branches | Commit responses may omit `web_url`, including nested commits in branches, comparisons, and historical MR versions.                                                                                                                                              |
| Tags                 | Missing `protected` and `created_at` remain absent. Missing protection information does not mean a tag is unprotected.                                                                                                                                           |
| Repository tree      | Supply `page` and `per_page` for offset pagination. A response with a next page contains `{ items, next_page }`; an explicitly requested final offset page contains `{ items }`. Pass `next_page` as `page`. Existing unpaginated final responses remain arrays. |
| Merge-request diffs  | Legacy diff-list and per-file tools read `/changes`, then paginate or filter its `changes` array locally. Renamed files can be matched by either path. The server still retrieves the complete legacy changes response.                                          |
| MR versions          | Historical versions may omit `patch_id_sha`; their commit data uses the same legacy-compatible commit contract.                                                                                                                                                  |
| Draft MRs            | The `draft` input adds or removes a `WIP:` title prefix using the old title-based workflow. Updating only the draft flag first reads the existing title.                                                                                                         |
| Merge scheduling     | `auto_merge` becomes `merge_when_pipeline_succeeds` on GitLab 11. Conflicting explicit flags are rejected. Commit SHA checks are preserved.                                                                                                                      |
| Approvals            | The existing `/approvals` fallback retains `approvals_required` and `approvals_left`. An explicit `approved` value wins; otherwise a provided `approvals_left` of zero means requirements are satisfied. Availability depends on the GitLab edition and license. |
| Pipelines and jobs   | Legacy summaries may omit project IDs and timestamps; job users may be null. List/detail, create/retry/cancel, waits, and job results accept the documented old shapes without inventing missing IDs or dates.                                                   |
| CI lint              | Content validation uses `POST /api/v4/ci/lint` and translates `status` into `valid`. Project lint reads `.gitlab-ci.yml` before content validation; it cannot provide modern project-context simulation.                                                         |
| Pipeline schedules   | Core schedule APIs remain available. A single schedule variable is read from the schedule detail's variables array.                                                                                                                                              |

## Unsupported capabilities

Known missing tools fail before calling their target endpoint: pipeline test
reports and summaries, pipeline metadata updates, bridge jobs, schedule pipeline
history, immediate schedule execution, artifact directory listing, and protected
branch PATCH updates. They may still appear in a selected toolset; their
execution is rejected on GitLab 11. Ordinary artifact downloads and job logs
keep their existing routes.

Old instances reject unsupported reviewer filters and assignments, selected
newer repository/pipeline filters, keyset tree pagination, structured pipeline
or job inputs, variable overrides when playing jobs, forced job cancellation,
and rebase `skip_ci`. Unsupported parameters are reported instead of silently
being dropped. Newer instances retain their existing routes and parameters.

## Regression verification

Use the Node version in `.nvmrc` and the existing npm lockfile:

```sh
npm ci --ignore-scripts
npm run build
node --import tsx/esm --test --test-concurrency=1 \
  test/gitlab-11-response-schema.test.ts test/test-gitlab-11-core.ts
```

The contract tests use synthetic responses matching GitLab 11.11.8's API
entities. The integration suite starts a local HTTP mock and invokes the built
server over MCP STDIO. It verifies request bodies and absence of target requests
for rejected operations, including unsafe merge flags. Modern-instance cases
cover route and parameter preservation.

These tests do not establish compatibility with a particular deployed GitLab
instance, its proxy, permissions, license, or repository data. Verify real writes
in a dedicated test project before enabling them for business repositories.
