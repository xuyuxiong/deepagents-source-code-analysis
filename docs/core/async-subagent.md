# AsyncSubAgentMiddleware

AsyncSubAgentMiddleware 提供异步子代理功能，允许主代理在远程 Agent Protocol 服务器上启动后台任务。

**源码路径**: `libs/deepagents/deepagents/middleware/async_subagents.py`

## 核心概念

与同步子代理不同，异步子代理：
- 立即返回任务 ID，不阻塞主代理
- 在远程服务器上后台运行
- 可并行运行多个任务
- 支持状态检查、更新和取消

## 初始化

```python
class AsyncSubAgentMiddleware(AgentMiddleware):
    def __init__(
        self,
        *,
        async_subagents: list[AsyncSubAgent],
        system_prompt: str | None = ASYNC_TASK_SYSTEM_PROMPT,
    ):
        self.tools = _build_async_subagent_tools(async_subagents)
```

## AsyncSubAgent 配置

```python
class AsyncSubAgent(TypedDict):
    name: str  # 子代理唯一标识符
    description: str  # 描述（用于选择）
    graph_id: str  # 远程图 ID
    url: NotRequired[str]  # Agent Protocol 服务器 URL
    headers: NotRequired[dict[str, str]]  # 自定义请求头
```

### 配置示例

```python
from deepagents.middleware.async_subagents import AsyncSubAgentMiddleware

middleware = AsyncSubAgentMiddleware(
    async_subagents=[
        {
            "name": "researcher",
            "description": "深度研究代理",
            "url": "https://my-deployment.langsmith.dev",
            "graph_id": "research_agent",
        },
        {
            "name": "analyzer",
            "description": "数据分析代理",
            "url": "https://my-deployment.langsmith.dev",
            "graph_id": "data_analyzer",
            "headers": {"x-custom-auth": "token"},
        },
    ],
)
```

## 提供的工具

### 1. start_async_task

启动异步任务，立即返回任务 ID：

```python
def start_async_task(
    description: str,  # 任务描述
    subagent_type: str,  # 子代理类型
    runtime: ToolRuntime,
) -> str | Command:
    """启动异步任务"""
```

**返回**: `task_id` - 用于后续跟踪

### 2. check_async_task

检查任务状态和结果：

```python
def check_async_task(
    task_id: str,  # 任务 ID
    runtime: ToolRuntime,
) -> str | Command:
    """检查任务状态"""
```

**返回**:
```json
{
  "status": "running" | "success" | "error" | "cancelled",
  "thread_id": "...",
  "result": "..." // 仅当 status="success"
}
```

### 3. update_async_task

向运行中的任务发送新指令：

```python
def update_async_task(
    task_id: str,  # 任务 ID
    message: str,  # 新指令
    runtime: ToolRuntime,
) -> str | Command:
    """更新任务"""
```

### 4. cancel_async_task

取消运行中的任务：

```python
def cancel_async_task(
    task_id: str,  # 任务 ID
    runtime: ToolRuntime,
) -> str | Command:
    """取消任务"""
```

### 5. list_async_tasks

列出所有任务及其状态：

```python
def list_async_tasks(
    runtime: ToolRuntime,
    status_filter: Literal["running", "success", "error", "cancelled", "all"] | None = None,
) -> str | Command:
    """列出任务"""
```

## AsyncTask 状态

```python
class AsyncTask(TypedDict):
    task_id: str  # 任务 ID（与 thread_id 相同）
    agent_name: str  # 子代理名称
    thread_id: str  # 远程线程 ID
    run_id: str  # 当前运行 ID
    status: str  # 状态
    created_at: str  # 创建时间
    last_checked_at: str  # 最后检查时间
    last_updated_at: str  # 最后更新时间
```

## 系统提示

中间件注入异步子代理使用说明：

```
## Async subagents (remote LangGraph servers)

### Tools
- `start_async_task`: 启动后台任务，立即返回任务 ID
- `check_async_task`: 获取任务状态和结果
- `update_async_task`: 发送新指令
- `cancel_async_task`: 取消任务
- `list_async_tasks`: 列出所有任务

### Workflow
1. Start — 启动任务并报告 task_id，不要立即检查状态
2. Check (on request) — 仅在用户请求时检查状态
3. Update — 发送新指令（会中断当前运行）
4. Cancel — 取消不需要的任务
5. Collect — 状态为 success 时获取结果
6. List — 查看所有任务状态

### Critical rules
- 启动后立即返回控制权，不要自动检查
- 不要循环轮询 check_async_task
- 状态可能是过时的，总是调用工具获取最新状态
```

## 使用示例

### 基本使用

```python
from deepagents import create_deep_agent
from deepagents.middleware.async_subagents import AsyncSubAgentMiddleware

# 配置异步子代理
async_middleware = AsyncSubAgentMiddleware(
    async_subagents=[
        {
            "name": "researcher",
            "description": "Conducts deep research on topics",
            "url": "https://api.langchain.com",
            "graph_id": "research_agent",
        }
    ],
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[async_middleware],
)
```

### 并行执行

```
# 启动多个并行任务
start_async_task(description="研究量子计算", subagent_type="researcher")
# 返回: task_id: abc123

start_async_task(description="研究机器学习", subagent_type="researcher")
# 返回: task_id: def456

# 主代理可以继续工作...
# 用户请求检查状态:
check_async_task(task_id="abc123")
# 返回: {"status": "running", ...}

check_async_task(task_id="def456")
# 返回: {"status": "success", "result": "..."}
```

## 客户端缓存

中间件缓存 LangGraph SDK 客户端：

```python
class _ClientCache:
    """缓存 Agent Protocol 客户端"""

    def __init__(self, agents: dict[str, AsyncSubAgent]):
        self._agents = agents
        self._sync: dict[...] = {}
        self._async: dict[...] = {}

    def get_sync(self, name: str) -> SyncLangGraphClient:
        """获取或创建同步客户端"""

    def get_async(self, name: str) -> LangGraphClient:
        """获取或创建异步客户端"""
```

## 认证

### LangGraph Platform

```python
# 通过环境变量自动认证
# LANGGRAPH_API_KEY, LANGSMITH_API_KEY, 或 LANGCHAIN_API_KEY

os.environ["LANGGRAPH_API_KEY"] = "your-api-key"

middleware = AsyncSubAgentMiddleware(
    async_subagents=[{
        "name": "agent",
        "url": "https://your-deployment.langsmith.dev",
        "graph_id": "agent_graph",
    }],
)
```

### 自定义认证

```python
middleware = AsyncSubAgentMiddleware(
    async_subagents=[{
        "name": "agent",
        "url": "https://your-server.com",
        "graph_id": "agent_graph",
        "headers": {
            "Authorization": "Bearer your-token",
        },
    }],
)
```

## 本地服务器

对于本地服务器，可以省略 `url` 使用 ASGI 传输：

```python
middleware = AsyncSubAgentMiddleware(
    async_subagents=[{
        "name": "local_agent",
        "graph_id": "local_graph",
        # 无 url，使用 ASGI
    }],
)
```

## 状态持久化

任务状态存储在 `async_tasks` 状态字段：

```python
class AsyncSubAgentState(AgentState):
    async_tasks: Annotated[NotRequired[dict[str, AsyncTask]], _tasks_reducer]
```

### Reducer

```python
def _tasks_reducer(
    existing: dict[str, AsyncTask] | None,
    update: dict[str, AsyncTask],
) -> dict[str, AsyncTask]:
    """合并任务更新"""
    merged = dict(existing or {})
    merged.update(update)
    return merged
```

## 与同步子代理对比

| 特性 | SubAgentMiddleware | AsyncSubAgentMiddleware |
|------|-------------------|------------------------|
| 执行方式 | 阻塞 | 非阻塞 |
| 返回值 | 结果 | task_id |
| 并行执行 | 串行 | 并行 |
| 运行位置 | 本地 | 远程 |
| 状态管理 | 内部 | 状态持久化 |
| 适用场景 | 同步任务 | 长时间任务 |

## 下一步

- [SubAgentMiddleware](./subagent-middleware.md) - 同步子代理
- [自定义子代理](../advanced/custom-subagent.md) - 创建自定义子代理