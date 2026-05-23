# 子代理系统

子代理是 Deep Agents 的核心特性之一，允许主 Agent 将复杂任务委托给具有独立上下文窗口的子代理。本文档将深入分析子代理机制的设计与实现。

## 设计理念

### 为什么需要子代理？

1. **上下文隔离**：子代理有独立的上下文窗口，不会污染主 Agent 的上下文
2. **并行执行**：多个子代理可以并行处理独立任务
3. **专业化**：子代理可以有专门的工具和系统提示
4. **上下文压缩**：子代理返回的结果是精炼的，而非完整的执行历史

### 子代理类型

```
┌─────────────────────────────────────────────────────────────────┐
│                       SubAgent (声明式)                         │
│  • 通过 TypedDict 配置                                          │
│  • 自动构建子图                                                 │
│  • 继承主 Agent 的工具和权限 (可覆盖)                            │
│  • 同步执行                                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   CompiledSubAgent (预编译)                     │
│  • 提供预编译的 LangGraph Runnable                              │
│  • 完全自定义子图结构                                           │
│  • 支持结构化输出                                               │
│  • 同步执行                                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   AsyncSubAgent (远程/后台)                     │
│  • 识别：包含 graph_id 字段                                      │
│  • 通过 LangGraph Platform 部署                                 │
│  • 后台异步执行                                                 │
│  • 通过 start/get_status/cancel/list 管理                       │
└─────────────────────────────────────────────────────────────────┘
```

## SubAgentMiddleware 实现

**源码路径**: `libs/deepagents/deepagents/middleware/subagents.py`

### 中间件初始化

```python
class SubAgentMiddleware(AgentMiddleware):
    """子代理中间件"""

    def __init__(
        self,
        *,
        backend: BackendProtocol | BackendFactory,
        subagents: Sequence[SubAgent | CompiledSubAgent],
        system_prompt: str | None = TASK_SYSTEM_PROMPT,
        task_description: str | None = None,
    ):
        super().__init__()

        if not subagents:
            raise ValueError("At least one subagent must be specified")

        self._backend = backend
        self._subagents = subagents

        # 构建子代理图
        subagent_specs = self._get_subagents()
        self.subagent_names = frozenset(spec["name"] for spec in subagent_specs)

        # 构建 task 工具
        task_tool = _build_task_tool(subagent_specs, task_description)
        self.tools = [task_tool]

        # 构建系统提示
        if system_prompt and subagent_specs:
            agents_desc = "\n".join(f"- {s['name']}: {s['description']}" for s in subagent_specs)
            self.system_prompt = system_prompt + "\n\nAvailable subagent types:\n\n" + agents_desc
        else:
            self.system_prompt = system_prompt
```

### 构建 task 工具

```python
def _build_task_tool(
    subagents: list[_SubagentSpec],
    task_description: str | None = None,
) -> BaseTool:
    """构建 task 工具"""

    # 子代理图字典
    subagent_graphs: dict[str, Runnable] = {
        spec["name"]: spec["runnable"] for spec in subagents
    }

    # 子代理描述
    subagent_desc_str = "\n".join(f"- {s['name']}: {s['description']}" for s in subagents)

    # 工具描述
    description = TASK_TOOL_DESCRIPTION.format(available_agents=subagent_desc_str)

    def task(description: str, subagent_type: str, runtime: ToolRuntime) -> str | Command:
        """task 工具实现"""
        # 1. 验证子代理类型
        if subagent_type not in subagent_graphs:
            allowed = ", ".join(f"`{k}`" for k in subagent_graphs)
            return f"Unknown subagent type. Allowed types: {allowed}"

        # 2. 准备子代理状态
        subagent = subagent_graphs[subagent_type]

        # 排除不应传递给子代理的状态
        subagent_state = {
            k: v for k, v in runtime.state.items()
            if k not in _EXCLUDED_STATE_KEYS
        }
        subagent_state["messages"] = [HumanMessage(content=description)]

        # 3. 准备配置
        subagent_config = _build_subagent_config(runtime)
        subagent_config["configurable"] = {
            **subagent_config.get("configurable", {}),
            "ls_agent_type": "subagent",
        }

        # 4. 调用子代理
        with _subagent_tracing_context():
            result = subagent.invoke(subagent_state, subagent_config)

        # 5. 返回结果
        return _return_command_with_state_update(result, runtime.tool_call_id)

    return StructuredTool.from_function(
        name="task",
        func=task,
        description=description,
        args_schema=TaskToolSchema,
    )
```

### 子代理状态隔离

```python
_EXCLUDED_STATE_KEYS = {
    "messages",        # 消息历史（由新任务描述替代）
    "todos",           # 任务列表（不传递）
    "structured_response",  # 结构化响应（不传递）
    "skills_metadata",      # 技能元数据（重新加载）
    "skills_load_errors",   # 技能加载错误（重新加载）
    "memory_contents",      # 记忆内容（重新加载）
}
```

### 子代理结果处理

```python
def _return_command_with_state_update(result: dict, tool_call_id: str) -> Command:
    """处理子代理结果，返回状态更新命令"""

    # 过滤排除的状态键
    state_update = {
        k: v for k, v in result.items()
        if k not in _EXCLUDED_STATE_KEYS
    }

    # 如果有结构化响应，使用它
    if structured := result.get("structured_response"):
        if hasattr(structured, "model_dump_json"):
            content = structured.model_dump_json()
        else:
            content = json.dumps(structured)
    else:
        # 否则使用最后一条 AI 消息的文本
        content = ""
        for msg in reversed(result["messages"]):
            if isinstance(msg, AIMessage) and msg.text:
                content = msg.text
                break

    return Command(update={
        **state_update,
        "messages": [ToolMessage(content, tool_call_id=tool_call_id)],
    })
```

## 子代理配置

### SubAgent 配置

```python
class SubAgent(TypedDict):
    """声明式子代理配置"""

    name: str  # 必需：唯一标识
    description: str  # 必需：功能描述
    system_prompt: str  # 必需：系统提示

    tools: NotRequired[Sequence[BaseTool | Callable | dict[str, Any]]]  # 可选：工具
    model: NotRequired[str | BaseChatModel]  # 可选：模型（默认继承）
    middleware: NotRequired[list[AgentMiddleware]]  # 可选：中间件
    interrupt_on: NotRequired[dict[str, bool | InterruptOnConfig]]  # 可选：HITL
    skills: NotRequired[list[str]]  # 可选：技能
    permissions: NotRequired[list[FilesystemPermission]]  # 可选：权限
    response_format: NotRequired[ResponseFormat[Any] | type | dict[str, Any]]  # 可选：结构化输出
```

### 默认 general-purpose 子代理

**源码路径**: `libs/deepagents/deepagents/middleware/subagents.py:418-422`

```python
GENERAL_PURPOSE_SUBAGENT: SubAgent = {
    "name": "general-purpose",
    "description": "General-purpose agent for researching complex questions, "
                   "searching for files and content, and executing multi-step tasks.",
    "system_prompt": DEFAULT_SUBAGENT_PROMPT,
}
```

**自动添加逻辑**：

```python
# 在 create_deep_agent 中
if gp_profile.enabled is not False and not any(
    spec["name"] == GENERAL_PURPOSE_SUBAGENT["name"]
    for spec in inline_subagents
):
    # 构建通用子代理中间件栈
    gp_middleware: list[AgentMiddleware] = [
        TodoListMiddleware(),
        FilesystemMiddleware(backend=backend, _permissions=permissions),
        create_summarization_middleware(model, backend),
        PatchToolCallsMiddleware(),
    ]
    if skills is not None:
        gp_middleware.append(SkillsMiddleware(backend=backend, sources=skills))

    # ... 添加 Profile 中间件

    general_purpose_spec: SubAgent = {
        **GENERAL_PURPOSE_SUBAGENT,
        "model": model,
        "tools": _tools or [],
        "middleware": gp_middleware,
    }
    inline_subagents.insert(0, general_purpose_spec)
```

### CompiledSubAgent 配置

```python
from pydantic import BaseModel
from langchain.agents import create_agent

class Findings(BaseModel):
    summary: str
    confidence: float

# 创建自定义图
researcher_graph = create_agent(
    "openai:gpt-4o",
    tools=[...],
    response_format=Findings,
)

# 使用预编译图
researcher: CompiledSubAgent = {
    "name": "researcher",
    "description": "Researches a topic and returns structured findings",
    "runnable": researcher_graph,
}
```

### AsyncSubAgent 配置

```python
from deepagents import AsyncSubAgent

# 远程子代理
background_researcher: AsyncSubAgent = {
    "name": "background-researcher",
    "description": "Performs long-running research in the background",
    "graph_id": "research-agent",
    "url": "https://your-langgraph-deployment.com",  # 可选
    "headers": {"Authorization": "Bearer ..."},  # 可选
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[background_researcher],
)
```

## task 工具说明

**工具名称**: `task`

**参数**:
- `description`: 任务描述
- `subagent_type`: 子代理类型

**工具描述模板**:

```
Launch an ephemeral subagent to handle complex, multi-step independent tasks
with isolated context windows.

Available agent types and the tools they have access to:
{available_agents}

Usage notes:
1. Launch multiple agents concurrently whenever possible
2. The agent returns a single message back to you
3. Each agent invocation is stateless
4. The agent's outputs should generally be trusted
5. Clearly tell the agent whether you expect it to create content, perform
   analysis, or just do research
6. If the agent description mentions proactive usage, try to use it without
   asking first
7. When only the general-purpose agent is provided, use it for all tasks

Example usage:
User: "Research LangGraph, LangChain, and LangSmith and compare them"
Assistant: *Launches 3 parallel research tasks*
Assistant: *Synthesizes the results*
```

## 执行流程

```
主 Agent                                   子 Agent
   │                                          │
   │  决定使用 task 工具                       │
   │  task(description="...", subagent_type)  │
   │────────────────────────────────────────>│
   │                                          │
   │                              ┌───────────┴───────────┐
   │                              │ 1. 准备子代理状态     │
   │                              │    - 排除敏感状态     │
   │                              │    - 添加任务描述     │
   │                              │                       │
   │                              │ 2. 配置子代理         │
   │                              │    - 继承回调         │
   │                              │    - 设置追踪标签     │
   │                              │                       │
   │                              │ 3. 执行子图           │
   │                              │    - 独立的中间件栈   │
   │                              │    - 独立的工具集     │
   │                              │    - 独立的上下文     │
   │                              │                       │
   │                              │ 4. 提取结果           │
   │                              │    - 优先 structured  │
   │                              │    - 否则最后 AI 消息 │
   │                              └───────────┬───────────┘
   │                                          │
   │  返回 ToolMessage                        │
   │<────────────────────────────────────────│
   │                                          │
   │  继续主 Agent 执行                        │
   │                                          │
```

## 最佳实践

### 1. 选择合适的子代理类型

| 类型 | 使用场景 |
|------|----------|
| SubAgent | 标准任务、需要继承工具、配置简单 |
| CompiledSubAgent | 自定义图结构、结构化输出、复杂控制流 |
| AsyncSubAgent | 长时间运行任务、后台处理、远程部署 |

### 2. 专业化子代理

```python
# 专注于研究
researcher: SubAgent = {
    "name": "researcher",
    "description": "Conducts thorough research and returns findings",
    "system_prompt": "You are a researcher. Investigate deeply...",
    "tools": [web_search, read_file],
    "model": "openai:gpt-4o",
}

# 专注于写作
writer: SubAgent = {
    "name": "writer",
    "description": "Writes high-quality content",
    "system_prompt": "You are a writer. Create engaging content...",
    "tools": [read_file, write_file],
    "model": "anthropic:claude-sonnet-4-6",
}

# 专注于代码审查
reviewer: SubAgent = {
    "name": "reviewer",
    "description": "Reviews code for quality and security",
    "system_prompt": "You are a code reviewer...",
    "tools": [read_file, grep],
    "model": "anthropic:claude-sonnet-4-6",
}
```

### 3. 权限继承

```python
agent = create_deep_agent(
    model="...",
    permissions=[
        FilesystemPermission(
            operations=["read"],
            paths=["/project/**"],
            mode="allow",
        ),
    ],
    subagents=[
        {
            "name": "writer",
            "description": "Writes to specific directory",
            "system_prompt": "...",
            # 子代理自己的权限，覆盖父权限
            "permissions": [
                FilesystemPermission(
                    operations=["read", "write"],
                    paths=["/project/output/**"],
                    mode="allow",
                ),
            ],
        },
    ],
)
```

### 4. 结构化输出

```python
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    summary: str
    key_findings: list[str]
    confidence: float

analyzer: SubAgent = {
    "name": "analyzer",
    "description": "Analyzes data and returns structured results",
    "system_prompt": "Analyze the data and return structured findings...",
    "response_format": AnalysisResult,
}
```

## 下一步

- [SubAgentMiddleware](/core/subagent-middleware)：深入理解同步子代理中间件
- [AsyncSubAgentMiddleware](/core/async-subagent)：深入理解异步子代理中间件
- [自定义子代理](/advanced/custom-subagent)：学习如何创建自定义子代理