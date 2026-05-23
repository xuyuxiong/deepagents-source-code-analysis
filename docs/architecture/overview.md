# 整体架构

Deep Agents 采用分层的中间件架构，构建于 LangGraph 之上。本文档将深入分析其整体架构设计、核心组件和执行流程。

## 分层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层                                          │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        用户代码                                       │   │
│   │   agent = create_deep_agent(model="...", tools=[...], middleware=[]) │   │
│   │   result = agent.invoke({"messages": "..."})                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Deep Agents 层                                     │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        中间件栈 (Middleware Stack)                    │   │
│   │                                                                       │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ TodoListMiddleware              ← 任务列表管理                   │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ SkillsMiddleware                ← 技能加载                       │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ FilesystemMiddleware            ← 文件系统工具                   │   │
│   │   │   • ls                                                            │   │
│   │   │   • read_file                                                     │   │
│   │   │   • write_file                                                    │   │
│   │   │   • edit_file                                                     │   │
│   │   │   • glob / grep                                                   │   │
│   │   │   • execute (沙箱执行)                                            │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ SubAgentMiddleware              ← 子代理 (task 工具)            │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ AsyncSubAgentMiddleware         ← 异步子代理                     │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ SummarizationMiddleware         ← 上下文摘要                     │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ PatchToolCallsMiddleware        ← 工具调用补丁                   │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ [用户自定义中间件]                                               │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ HarnessProfile.extra_middleware ← 模型特定中间件                 │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ _ToolExclusionMiddleware        ← 工具排除                       │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ AnthropicPromptCachingMiddleware ← Anthropic 提示缓存           │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ MemoryMiddleware                ← 记忆加载                       │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   │   ┌─────────────────┐                                                │   │
│   │   │ HumanInTheLoopMiddleware        ← 人工审核                       │   │
│   │   └────────┬────────┘                                                │   │
│   │            ↓                                                         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                          后端层 (Backend Layer)                      │   │
│   │                                                                       │   │
│   │   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │   │
│   │   │ StateBackend │ │Filesystem    │ │ SandboxBackend│ │Composite   │ │   │
│   │   │ (状态存储)   │ │Backend       │ │ (沙箱执行)   │ │Backend     │ │   │
│   │   │              │ │ (文件系统)  │ │              │ │ (路由组合) │ │   │
│   │   └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                           LangGraph 层                                       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │   CompiledStateGraph                                                  │   │
│   │   • 状态管理 (Statechannels)                                         │   │
│   │   • 检查点 (Checkpointer)                                            │   │
│   │   • 流式响应 (Streaming)                                             │   │
│   │   • 子图 (Subgraphs)                                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                           LangChain 层                                       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │   • BaseChatModel (模型抽象)                                         │   │
│   │   • BaseTool (工具抽象)                                              │   │
│   │   • Messages (消息格式)                                              │   │
│   │   • Callbacks (回调)                                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. `create_deep_agent` 入口函数

**源码路径**: `libs/deepagents/deepagents/graph.py`

**职责**:
- 解析模型字符串并创建 `BaseChatModel` 实例
- 根据 `HarnessProfile` 应用模型特定配置
- 构建中间件栈
- 处理子代理配置
- 调用 `langchain.agents.create_agent` 创建最终图

**执行流程**:

```
create_deep_agent(model, tools, ...)
           │
           ↓
┌──────────────────────────────────┐
│ 1. 解析模型                       │
│    resolve_model(model)          │
│    → BaseChatModel               │
└────────────────┬─────────────────┘
                 ↓
┌──────────────────────────────────┐
│ 2. 获取 HarnessProfile           │
│    _harness_profile_for_model()  │
│    → 工具描述覆盖                 │
│    → 排除工具                     │
│    → 额外中间件                   │
└────────────────┬─────────────────┘
                 ↓
┌──────────────────────────────────┐
│ 3. 处理子代理                     │
│    • SubAgent → 构建子图          │
│    • CompiledSubAgent → 直接使用  │
│    • AsyncSubAgent → 注册远程代理 │
│    • 自动添加 general-purpose     │
└────────────────┬─────────────────┘
                 ↓
┌──────────────────────────────────┐
│ 4. 组装中间件栈                   │
│    基础栈 + 用户中间件 +          │
│    Profile 中间件 + 尾部栈        │
└────────────────┬─────────────────┘
                 ↓
┌──────────────────────────────────┐
│ 5. 创建 Agent 图                  │
│    create_agent(model, tools,    │
│        middleware=middleware,    │
│        ...)                      │
│    → CompiledStateGraph          │
└────────────────┬─────────────────┘
                 ↓
┌──────────────────────────────────┐
│ 6. 配置图                         │
│    .with_config({                │
│        "recursion_limit": 9999,  │
│        "metadata": {...},        │
│    })                            │
└──────────────────────────────────┘
```

### 2. 中间件系统

每个中间件实现 `AgentMiddleware` 接口：

```python
class AgentMiddleware(Generic[AgentStateT, ContextT, ResponseT]):
    """中间件基类"""

    # State Schema（可选）
    state_schema: type[AgentStateT] = AgentState

    # 工具列表（可选）
    tools: list[BaseTool] = []

    # 系统提示片段（可选）
    system_prompt: str | None = None

    # Agent 执行前钩子
    def before_agent(self, state, runtime, config) -> StateUpdate | None:
        """在 Agent 执行前调用，返回状态更新"""
        return None

    async def abefore_agent(self, state, runtime, config) -> StateUpdate | None:
        """异步版本"""
        return None

    # 模型调用包装器
    def wrap_model_call(self, request, handler) -> ModelResponse:
        """包装模型调用，可修改请求/响应"""
        return handler(request)

    async def awrap_model_call(self, request, handler) -> ModelResponse:
        """异步版本"""
        return await handler(request)

    # 工具调用包装器
    def wrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """包装工具调用，可修改请求/响应"""
        return handler(request)

    async def awrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """异步版本"""
        return await handler(request)

    # 请求修改器
    def modify_request(self, request) -> ModelRequest:
        """修改模型请求（在 wrap_model_call 之前调用）"""
        return request
```

### 3. 后端系统

后端是文件存储和执行的抽象层：

```python
class BackendProtocol(abc.ABC):
    """后端协议"""

    # 文件操作
    def ls(self, path: str) -> LsResult
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult
    def write(self, file_path: str, content: str) -> WriteResult
    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult
    def glob(self, pattern: str, path: str = "/") -> GlobResult
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> GrepResult

    # 批量操作
    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]


class SandboxBackendProtocol(BackendProtocol):
    """沙箱后端协议（扩展执行能力）"""

    @property
    def id(self) -> str

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse
```

**后端类型对比**:

| 后端 | 存储位置 | 执行能力 | 适用场景 |
|------|----------|----------|----------|
| StateBackend | Agent State | ❌ | 临时的、会话级文件 |
| FilesystemBackend | 本地文件系统 | ❌ | 本地开发、测试 |
| SandboxBackend | 沙箱环境 | ✅ | 生产环境、隔离执行 |
| CompositeBackend | 路由到多个后端 | 取决于路由 | 混合场景 |

### 4. 子代理系统

子代理通过 `task` 工具委托任务：

```
主 Agent                                子 Agent
   │                                       │
   │  task(description, subagent_type)     │
   │──────────────────────────────────────>│
   │                                       │
   │                              ┌────────┴────────┐
   │                              │ 执行独立任务     │
   │                              │ 独立上下文窗口   │
   │                              │ 独立工具集       │
   │                              │ 独立中间件栈     │
   │                              └────────┬────────┘
   │                                       │
   │  返回最终结果（单条消息）               │
   │<──────────────────────────────────────│
   │                                       │
```

## 执行流程

### 完整请求流程

```
用户输入
    │
    ↓
┌──────────────────────────────────────────────────────────────────┐
│ 1. before_agent 钩子                                              │
│    • SkillsMiddleware: 加载技能元数据                             │
│    • MemoryMiddleware: 加载记忆文件                               │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────┐
│ 2. wrap_model_call 链                                            │
│                                                                   │
│    请求 → FilesystemMiddleware (注入系统提示)                      │
│         → SubAgentMiddleware (注入 task 工具说明)                  │
│         → SummarizationMiddleware (摘要长上下文)                   │
│         → MemoryMiddleware (注入记忆到系统提示)                    │
│         → 模型调用                                                │
│         ← 响应                                                   │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────┐
│ 3. 工具调用                                                       │
│    • FilesystemMiddleware: wrap_tool_call (大内容卸载)            │
│    • 工具执行                                                     │
│    • 返回 ToolMessage                                             │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────┐
│ 4. 循环：回到步骤 2，直到无更多工具调用                            │
└────────────────────────┬─────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────┐
│ 5. 返回最终状态                                                   │
│    {messages: [...], files: {...}, todos: [...], ...}            │
└──────────────────────────────────────────────────────────────────┘
```

### 工具调用详细流程

```
模型返回 ToolCall
         │
         ↓
┌────────────────────────────────────┐
│ HumanInTheLoopMiddleware           │
│ 检查 interrupt_on 配置              │
│ ┌────────────────────────────────┐ │
│ │ if tool_name in interrupt_on:  │ │
│ │     暂停执行，等待人工审批       │ │
│ │     用户批准/修改/拒绝          │ │
│ └────────────────────────────────┘ │
└────────────────┬───────────────────┘
                 ↓
┌────────────────────────────────────┐
│ FilesystemMiddleware.wrap_tool_call│
│ ┌────────────────────────────────┐ │
│ │ 检查权限 (_check_fs_permission)│ │
│ │ 执行工具                        │ │
│ │ 检查结果大小                    │ │
│ │ 如果超过阈值 → 卸载到文件系统   │ │
│ └────────────────────────────────┘ │
└────────────────┬───────────────────┘
                 ↓
         返回 ToolMessage
```

## 设计原则

### 1. 单一职责

每个中间件只负责一个功能：
- `FilesystemMiddleware`：文件系统操作 + 大内容卸载
- `SubAgentMiddleware`：子代理管理
- `MemoryMiddleware`：记忆加载
- `SkillsMiddleware`：技能加载

### 2. 开闭原则

通过 `middleware` 参数扩展，无需修改核心代码：

```python
agent = create_deep_agent(
    model="...",
    middleware=[
        MyCustomMiddleware(),  # 添加自定义中间件
    ],
)
```

### 3. 依赖倒置

后端通过 `BackendProtocol` 抽象，高层模块不依赖具体实现：

```python
# 依赖抽象，不依赖具体实现
def create_agent(backend: BackendProtocol):
    backend.read("/file.txt")
    backend.write("/file.txt", "content")
```

### 4. 配置优于代码

使用 `HarnessProfile` 和 `ProviderProfile` 实现配置驱动：

```python
# 配置驱动的模型特定优化
@cached_harness_profile
def _anthropic_sonnet_4_6(model: BaseChatModel) -> HarnessProfile:
    return HarnessProfile(
        base_system_prompt="...",
        tool_description_overrides={"task": "..."},
        excluded_tools=[],
    )
```

## 下一步

- [中间件系统](/architecture/middleware-system)：深入理解中间件的工作原理
- [后端系统](/architecture/backend-system)：了解不同后端的实现差异
- [子代理系统](/architecture/subagent-system)：揭秘任务委托机制
- [create_deep_agent](/core/create-deep-agent)：入口函数的完整实现分析