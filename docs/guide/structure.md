# 源码结构

Deep Agents 采用 Python Monorepo 架构，使用 `uv` 作为包管理器。本文档将详细介绍项目的目录结构、核心包和依赖关系。

## Monorepo 架构

```
deepagents/
├── libs/                        # 核心库目录
│   ├── deepagents/              # 核心 SDK（本系列文档主要分析对象）
│   ├── code/                    # Deep Agents Code CLI（终端编码代理）
│   ├── cli/                     # 部署相关 CLI
│   ├── acp/                     # Agent Context Protocol 支持
│   ├── evals/                   # 评估套件
│   └── partners/                # 合作伙伴集成
│       ├── daytona/             # Daytona 沙箱后端
│       ├── modal/               # Modal 沙箱后端
│       ├── quickjs/             # QuickJS 沙箱后端
│       └── runloop/             # RunLoop 沙箱后端
├── examples/                    # 示例代码
│   ├── better-harness/          # 自定义 Harness 示例
│   ├── content-builder-agent/   # 内容构建 Agent 示例
│   ├── deep_research/           # 深度研究 Agent 示例
│   └── ...                      # 更多示例
├── .github/                     # CI/CD 配置
│   ├── workflows/               # GitHub Actions 工作流
│   ├── ISSUE_TEMPLATE/          # Issue 模板
│   └── scripts/                 # CI 脚本
├── AGENTS.md                    # 项目级 Agent 指南
├── README.md                    # 项目说明
├── pyproject.toml               # 项目配置
└── Makefile                     # 构建任务
```

## 核心 SDK 结构 (`libs/deepagents/`)

```
libs/deepagents/
├── deepagents/                  # 源码目录
│   ├── __init__.py              # 公开 API 导出
│   ├── graph.py                 # create_deep_agent 入口函数
│   ├── _models.py               # 模型解析工具
│   ├── _tools.py                # 工具描述覆盖
│   ├── _messages_reducer.py     # 消息 Delta 归约器
│   ├── _excluded_middleware.py  # 中间件排除逻辑
│   ├── _subagent_transformer.py # 子代理流转换器
│   ├── _api/                    # 公共 API 工具
│   │   └── deprecation.py       # 弃用警告
│   ├── backends/                # 后端系统
│   │   ├── __init__.py          # 后端导出
│   │   ├── protocol.py          # BackendProtocol 协议定义
│   │   ├── state.py             # StateBackend（状态存储）
│   │   ├── filesystem.py        # FilesystemBackend（文件系统）
│   │   ├── sandbox.py           # SandboxBackend（沙箱执行）
│   │   ├── composite.py         # CompositeBackend（组合后端）
│   │   ├── context_hub.py       # ContextHub 后端
│   │   ├── langsmith.py         # LangSmith 沙箱后端
│   │   ├── store.py             # StoreBackend
│   │   └── utils.py             # 后端工具函数
│   ├── middleware/              # 中间件系统
│   │   ├── __init__.py          # 中间件导出
│   │   ├── filesystem.py        # FilesystemMiddleware
│   │   ├── subagents.py         # SubAgentMiddleware
│   │   ├── async_subagents.py   # AsyncSubAgentMiddleware
│   │   ├── memory.py            # MemoryMiddleware
│   │   ├── skills.py            # SkillsMiddleware
│   │   ├── summarization.py     # SummarizationMiddleware
│   │   ├── permissions.py       # PermissionsMiddleware
│   │   ├── patch_tool_calls.py  # PatchToolCallsMiddleware
│   │   ├── _message_eviction.py # 消息驱逐逻辑
│   │   ├── _overflow_clip.py    # 溢出裁剪
│   │   ├── _tool_exclusion.py   # 工具排除
│   │   └── _utils.py            # 中间件工具
│   └── profiles/                # 配置系统
│       ├── __init__.py          # Profile 导出
│       ├── _keys.py             # Profile 键名常量
│       ├── _builtin_profiles.py # 内置 Profile 注册
│       ├── harness/             # Harness Profile
│       │   ├── __init__.py
│       │   ├── harness_profiles.py
│       │   ├── _anthropic_opus_4_7.py
│       │   ├── _anthropic_sonnet_4_6.py
│       │   ├── _anthropic_haiku_4_5.py
│       │   └── _openai_codex.py
│       └── provider/            # Provider Profile
│           ├── __init__.py
│           ├── provider_profiles.py
│           ├── _openai.py
│           └── _openrouter.py
├── tests/                       # 测试目录
│   ├── unit_tests/              # 单元测试
│   ├── integration_tests/       # 集成测试
│   └── benchmarks/              # 性能基准测试
├── pyproject.toml               # 包配置
└── Makefile                     # 构建任务
```

## 公开 API (`deepagents/__init__.py`)

```python
# 源码路径: libs/deepagents/deepagents/__init__.py

__all__ = [
    # 核心入口
    "create_deep_agent",

    # 中间件
    "FilesystemMiddleware",
    "FilesystemPermission",
    "SubAgentMiddleware",
    "SubAgent",
    "CompiledSubAgent",
    "AsyncSubAgent",
    "AsyncSubAgentMiddleware",
    "MemoryMiddleware",

    # Profiles
    "HarnessProfile",
    "HarnessProfileConfig",
    "GeneralPurposeSubagentProfile",
    "ProviderProfile",
    "register_harness_profile",
    "register_provider_profile",

    # 子代理工具
    "SubagentTransformer",
    "SubagentRunStream",
    "AsyncSubagentRunStream",

    # 版本
    "__version__",
]
```

## 包间依赖

```
libs/deepagents/
├── langchain-core (>=1.4.0)     # 核心抽象
├── langchain (>=1.3.0)          # Agent 框架
├── langchain-anthropic (>=1.4.3) # Anthropic 集成
├── langchain-google-genai (>=4.2.2) # Google 集成
├── langsmith (>=0.8.3)          # 可观测性
└── wcmatch                      # Glob 匹配
```

```
libs/code/ (Deep Agents Code)
├── deepagents                   # 核心 SDK
├── textual                      # TUI 框架
├── langchain-openai             # OpenAI 集成
└── ...
```

```
libs/partners/daytona/
├── deepagents                   # 核心 SDK
└── daytona-sdk                  # Daytona SDK
```

## 关键文件解析

### 1. 入口函数：`graph.py`

**路径**: `libs/deepagents/deepagents/graph.py`

**职责**：
- 组装完整的 Deep Agent
- 配置中间件栈
- 处理子代理配置
- 应用 HarnessProfile

**核心函数**：
```python
def create_deep_agent(
    model: str | BaseChatModel | None = None,
    tools: Sequence[BaseTool | Callable | dict[str, Any]] | None = None,
    *,
    system_prompt: str | SystemMessage | None = None,
    middleware: Sequence[AgentMiddleware] = (),
    subagents: Sequence[SubAgent | CompiledSubAgent | AsyncSubAgent] | None = None,
    skills: list[str] | None = None,
    memory: list[str] | None = None,
    permissions: list[FilesystemPermission] | None = None,
    backend: BackendProtocol | BackendFactory | None = None,
    interrupt_on: dict[str, bool | InterruptOnConfig] | None = None,
    response_format: ResponseFormat[ResponseT] | type[ResponseT] | dict[str, Any] | None = None,
    context_schema: type[ContextT] | None = None,
    checkpointer: Checkpointer | None = None,
    store: BaseStore | None = None,
    debug: bool = False,
    name: str | None = None,
    cache: BaseCache | None = None,
) -> CompiledStateGraph: ...
```

### 2. 后端协议：`backends/protocol.py`

**路径**: `libs/deepagents/deepagents/backends/protocol.py`

**核心接口**：
```python
class BackendProtocol(abc.ABC):
    def ls(self, path: str) -> LsResult
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult
    def write(self, file_path: str, content: str) -> WriteResult
    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult
    def glob(self, pattern: str, path: str = "/") -> GlobResult
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult
    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]

class SandboxBackendProtocol(BackendProtocol):
    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse
```

### 3. 中间件基类：`langchain.agents.middleware.types.AgentMiddleware`

中间件通过以下钩子扩展 Agent 行为：

```python
class AgentMiddleware:
    # 执行前钩子
    def before_agent(self, state, runtime, config) -> StateUpdate | None
    async def abefore_agent(self, state, runtime, config) -> StateUpdate | None

    # 模型调用包装
    def wrap_model_call(self, request, handler) -> ModelResponse
    async def awrap_model_call(self, request, handler) -> ModelResponse

    # 工具调用包装
    def wrap_tool_call(self, request, handler) -> ToolMessage | Command
    async def awrap_tool_call(self, request, handler) -> ToolMessage | Command

    # 请求修改
    def modify_request(self, request) -> ModelRequest
```

### 4. 子代理定义：`middleware/subagents.py`

**路径**: `libs/deepagents/deepagents/middleware/subagents.py`

**核心类型**：
```python
class SubAgent(TypedDict):
    name: str                    # 唯一标识
    description: str             # 功能描述
    system_prompt: str           # 系统提示
    tools: NotRequired[Sequence[...]]  # 工具（可选）
    model: NotRequired[str | BaseChatModel]  # 模型（可选）
    middleware: NotRequired[list[AgentMiddleware]]  # 中间件（可选）
    interrupt_on: NotRequired[dict[str, bool | InterruptOnConfig]]  # HITL（可选）
    skills: NotRequired[list[str]]  # 技能（可选）
    permissions: NotRequired[list[FilesystemPermission]]  # 权限（可选）
    response_format: NotRequired[...]  # 结构化输出（可选）

class CompiledSubAgent(TypedDict):
    name: str
    description: str
    runnable: Runnable  # 预编译的 LangGraph 可执行对象
```

## 构建与测试

### 常用命令

```bash
# 安装依赖
uv sync

# 运行测试
make test

# 或者
uv run --group test pytest

# 运行特定测试
uv run --group test pytest libs/deepagents/tests/unit_tests/test_end_to_end.py

# Lint 检查
make lint

# 格式化
make format

# 类型检查
make typecheck
```

### Makefile 目标

```makefile
# 源码路径: libs/deepagents/Makefile

test:                          # 运行所有测试
    uv run --group test pytest

lint:                          # Lint 检查
    uv run ruff check .

format:                        # 格式化代码
    uv run ruff format .

typecheck:                     # 类型检查
    uv run ty .

benchmark:                     # 性能基准测试
    uv run --group test pytest tests/benchmarks/
```

## 下一步

- [调试指南](/guide/debugging)：学习如何调试 Agent 和中间件
- [整体架构](/architecture/overview)：深入理解框架的分层设计
- [create_deep_agent](/core/create-deep-agent)：入口函数的完整实现分析