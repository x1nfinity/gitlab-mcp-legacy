# gitlab-mcp-legacy

面向 **GitLab 11.11.8** 的 GitLab MCP 兼容分支，主要服务仓库阅读、Merge Request 审查和 pipeline/job 排查。
基于 [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp) **v2.3.19**，本分支初始版本为 **0.1.0**。

A GitLab MCP fork for core repository, merge-request and pipeline workflows on legacy GitLab 11.11.8.

[GitHub](https://github.com/x1nfinity/gitlab-mcp-legacy) · [npm](https://www.npmjs.com/package/gitlab-mcp-legacy) · [GitLab 11.11 兼容说明](docs/compatibility/gitlab-11.11.md)

## 快速开始：本地 stdio，只读

使用 **Node.js 22.23.4**；本地开发使用 npm 和仓库中的 `package-lock.json`。
以下配置通过 `npx -y gitlab-mcp-legacy@0.1.0` 启动固定版本。
运行 MCP 客户端的环境需要能够找到 `npx`，首次启动需要能够访问 npm registry。

### 1. 准备本地 Token 文件

GitLab 11.11 的个人访问 Token 使用 `api` scope；该版本尚无后续版本的 `read_api` scope。
请使用仅能访问所需项目的账号，并在 MCP 服务端显式启用 `readonly`。

用本地编辑器将 PAT 作为唯一内容保存到自己管理的文件，例如 `/absolute/path/to/gitlab-token`，然后设置权限：

```sh
chmod 600 /absolute/path/to/gitlab-token
```

配置中只保存文件的**绝对路径**。Token 文件放在仓库外，父目录建议仅允许当前用户访问。
使用文件模式时，启动环境应只提供 Token 文件路径；已有的内联 Token 设置会优先于文件。
服务端在启动时读取文件，轮换 Token 后需要重启 MCP 进程。

### 2. 配置 Codex

将以下内容加入 Codex 的 `config.toml`，替换示例域名和 Token 文件路径。
完整示例见 [`examples/codex-readonly.toml`](examples/codex-readonly.toml)。

```toml
# Replace the example API URL and absolute token-file path before use.
[mcp_servers.gitlab_legacy]
command = "npx"
args = ["-y", "gitlab-mcp-legacy@0.1.0"]
enabled = true
default_tools_approval_mode = "writes"
enabled_tools = [
  "health_check",
  "search_repositories",
  "list_projects",
  "get_project",
  "get_repository_tree",
  "get_file_contents",
  "list_commits",
  "get_commit",
  "list_branches",
  "get_branch",
  "list_tags",
  "get_tag",
  "list_merge_requests",
  "get_merge_request",
  "get_merge_request_diffs",
  "list_merge_request_changed_files",
  "list_merge_request_diffs",
  "get_merge_request_file_diff",
  "list_merge_request_versions",
  "get_merge_request_version",
  "mr_discussions",
  "list_merge_request_pipelines",
  "list_pipelines",
  "get_pipeline",
  "list_pipeline_jobs",
  "get_pipeline_job",
  "get_pipeline_job_output",
  "list_pipeline_schedules",
]

[mcp_servers.gitlab_legacy.env]
GITLAB_API_URL = "https://gitlab.example.com/api/v4"
GITLAB_PERSONAL_ACCESS_TOKEN_FILE = "/absolute/path/to/gitlab-token"
GITLAB_IS_OLD = "true"
GITLAB_PERMISSION_MODE = "readonly"
GITLAB_TOOLSETS = "repositories"
GITLAB_TOOLS = "health_check,search_repositories,list_projects,get_project,get_repository_tree,get_file_contents,list_commits,get_commit,list_branches,get_branch,list_tags,get_tag,list_merge_requests,get_merge_request,get_merge_request_diffs,list_merge_request_changed_files,list_merge_request_diffs,get_merge_request_file_diff,list_merge_request_versions,get_merge_request_version,mr_discussions,list_merge_request_pipelines,list_pipelines,get_pipeline,list_pipeline_jobs,get_pipeline_job,get_pipeline_job_output,list_pipeline_schedules"
GITLAB_DENIED_TOOLS_REGEX = "^(discover_tools|help)$"
GITLAB_DISABLE_VERSION_CHECK = "true"
```

这份配置组合服务端的工具集合、显式工具列表和拒绝正则，并在客户端重复设置 28 项白名单。
`GITLAB_IS_OLD=true` 使用旧实例需要的 `Private-Token` 请求头。
`GITLAB_DISABLE_VERSION_CHECK=true` 关闭包版本更新检查。

**源码的权限模式默认是 `full`。只读使用必须显式设置 `GITLAB_PERMISSION_MODE=readonly`，并保留上述工具筛选配置。**
GitLab PAT 本身仍可能拥有写权限；客户端白名单不能代替服务端权限控制。

### 3. 检查连接并读取项目

重启或重新连接 MCP 后，先调用 `health_check`，再使用 `list_projects` 或 `search_repositories` 查找项目。
常见流程：

- 仓库：`get_project` → `get_repository_tree` → `get_file_contents`。
- 提交与分支：`list_commits` / `get_commit`、`list_branches` / `get_branch`、`list_tags` / `get_tag`。
- MR 审查：`list_merge_requests` → `get_merge_request` → `list_merge_request_changed_files` → `get_merge_request_file_diff`；讨论使用 `mr_discussions`。
- CI 排查：`list_pipelines` → `get_pipeline` → `list_pipeline_jobs` → `get_pipeline_job_output`。

`project_id` 可使用数字 ID 或 URL 编码路径，例如 `group%2Fproject`；`merge_request_iid` 是项目内的 MR 编号。

## 兼容与验证边界

真实只读验证使用 GitLab **11.11.8**，覆盖 **two projects**：

| 验证范围 | 已有结果 |
| --- | --- |
| 28 工具配置下的真实 MCP 调用 | 59/59 调用通过；60 次 GET 请求均返回 HTTP 200 |
| GitLab 11 新增本地回归 | 51 项通过，覆盖响应契约、兼容路由、参数与请求体 |
| 既有相关本地回归 | 132 项通过 |

MR 关联 pipeline 列表和 pipeline schedule 列表的真实返回均为空，非空数据仍需验证。
所有真实写能力均未验证；本地 mock 对写请求的检查不能代替真实 GitLab 验收。

兼容处理包括旧响应中缺失字段、repository tree 的 offset 分页，以及旧版 MR diff 的 `/changes` 路由。
MR diff 的分页和文件筛选在本地完成，服务端仍会读取完整的旧版 changes 响应，大型 MR 需要留意响应体积。
已识别的旧版缺失 API 能力和不支持参数会按兼容规则拒绝，具体见[兼容说明](docs/compatibility/gitlab-11.11.md)。

源码继承了上游的 288 项工具实现。当前真实验证集中于上述 28 项只读工具，不能据此推断全部工具兼容 GitLab 11。
其他 GitLab 版本、许可证、权限设置和部署环境需要分别验证；启用写操作前应先在专用测试项目验收。

## 本地开发与验证

先切换到 `.nvmrc` 指定的 Node.js **22.23.4**，再按 npm 锁文件安装：

```sh
git clone https://github.com/x1nfinity/gitlab-mcp-legacy.git
cd gitlab-mcp-legacy
npm ci --ignore-scripts
npm run build
node --import tsx/esm --test --test-concurrency=1 \
  test/gitlab-11-response-schema.test.ts test/test-gitlab-11-core.ts
```

上述测试使用合成的 GitLab 11.11.8 响应与本地 HTTP mock，通过 MCP stdio 调用构建后的服务端。
测试验证旧版路由、参数转换与拒绝行为，并覆盖部分现代实例路由保持情况。
真实实例验证需要自行准备目标实例、Token、项目与对应数据。

## 进阶参考与上游归属

- [GitLab 11.11 兼容说明](docs/compatibility/gitlab-11.11.md)：响应差异、受限能力与回归验证方式。
- [工具参考](docs/tools/index.md)和[环境变量参考](docs/configuration/environment-variables.md)：继承的进阶功能说明；工具可用性以本分支兼容说明和实际验证为准。
- [上游项目](https://github.com/zereight/gitlab-mcp)：本分支基于 v2.3.19 维护，安装本分支使用 npm 包 `gitlab-mcp-legacy`。

项目使用 [MIT License](LICENSE)，保留原始版权声明 **Copyright (c) 2025-2026 zereight**。
