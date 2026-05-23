# create_deep_agent 入口函数

`create_deep_agent` 是 Deep Agents 的核心入口函数，负责组装一个完整的 Agent 图。本文档将深入分析其实现细节。

**源码路径**: `libs/deepagents/deepagents/graph.py`

## 函数签名

```python
def create_deep_agent(
    model: str | BaseChatModel | None = None,  # LLM 模型
    tools: Sequence[BaseTool | Callable | dict[str, Any]] | None = None,  # 自定义工具
    *,
    system_prompt: str | SystemMessage | None = None,  # 系统提示
    middleware: Sequence[AgentMiddleware] = (),  # 用户中间件
    subagents: Sequence[SubAgent | CompiledSubAgent | AsyncSubAgent] | None = None,  # 子代理
    skills: list[str] | None = None,  # 技能路径
    memory: list[str] | None = None,  # 记忆文件路径
    permissions: list[FilesystemPermission] | None = None,  # 文件系统权限
    backend: BackendProtocol | BackendFactory | None = None,  # 存储后端
    interrupt_on: dict[str, bool | InterruptOnConfig] | None = None,  # HITL 配置
    response_format: ResponseFormat[ResponseT] | type[ResponseT] | dict[str, Any] | None = None,  # 结构化输出
    context_schema: type[ContextT] | None = None,  # 上下文 Schema
    checkpointer: Checkpointer | None = None,  # 状态持久化
    store: BaseStore | None = None,  # 持久化存储
    debug: bool = False,  # 调试模式
    name: str | None = None,  # Agent 名称
    cache: BaseCache | None = None,  # 缓存
) -> CompiledStateGraph[AgentState[ResponseT], ContextT, _InputAgentState, _OutputAgentState[ResponseT]]:
```

## 执行流程

```
create_deep_agent()
       │
       ├─→ 1. 解析模型
       │      resolve_model(model)
       │      → BaseChatModel
       │
       ├─→ 2. 获取 HarnessProfile
       │      _harness_profile_for_model(model, model_spec)
       │      → 工具描述覆盖、排除工具、额外中间件
       │
       ├─→ 3. 处理子代理
       │      • SubAgent → 构建中间件栈、创建子图
       │      • CompiledSubAgent → 直接使用
       │      • AsyncSubAgent → 注册到 AsyncSubAgentMiddleware
       │      • 自动添加 general-purpose 子代理
       │
       ├─→ 4. 组装中间件栈
       │      基础栈 → 子代理中间件 → 用户中间件 → Profile 中间件 → 尾部栈
       │
       ├─→ 5. 组装系统提示
       │      USER → BASE/CUSTOM → SUFFIX
       │
       ├─→ 6. 创建 Agent 图
       │      create_agent(model, tools, middleware, ...)
       │      → CompiledStateGraph
       │
       └─→ 7. 配置图
              .with_config({recursion_limit: 9999, ...})
              → 最终 Agent
```

## 源码分析

### 1. 模型解析

```python
_model_spec: str | None = model if isinstance(model, str) else None

if model is None:
    # 弃用警告
    warn_deprecated(...)
    model = _build_default_model()  # ChatAnthropic(model_name="claude-sonnet-4-6")
else:
    model = resolve_model(model)
```

**resolve_model 实现**：

```python
# libs/deepagents/deepagents/_models.py

def resolve_model(model: str | BaseChatModel) -> BaseChatModel:
    """解析模型字符串为 BaseChatModel"""
    if isinstance(model, BaseChatModel):
        return model

    # 应用 Provider Profile
    return init_chat_model(model, **apply_provider_profile(model))
```

### 2. 获取 HarnessProfile

```python
_profile = _harness_profile_for_model(model, _model_spec)

# 验证排除中间件配置
_validate_excluded_middleware_config(
    _profile,
    required_classes=_REQUIRED_MIDDLEWARE_CLASSES,
    required_names=_REQUIRED_MIDDLEWARE_NAMES,
)
```

### 3. 处理子代理

```python
# 存储处理后的子代理
inline_subagents: list[SubAgent | CompiledSubAgent] = []
async_subagents: list[AsyncSubAgent] = []

for spec in subagents or []:
    if "graph_id" in spec:
        # AsyncSubAgent
        async_subagents.append(cast("AsyncSubAgent", spec))
    elif "runnable" in spec:
        # CompiledSubAgent
        inline_subagents.append(spec)
    else:
        # SubAgent - 构建完整的子代理配置
        processed_spec = _process_subagent_spec(spec, model, permissions, backend, ...)
        inline_subagents.append(processed_spec)

# 自动添加 general-purpose 子代理
if gp_profile.enabled and not any(s["name"] == "general-purpose" for s in inline_subagents):
    gp_spec = _build_general_purpose_subagent(model, tools, permissions, backend, ...)
    inline_subagents.insert(0, gp_spec)
```

**子代理中间件栈构建**：

```python
def _process_subagent_spec(spec, model, permissions, backend, ...):
    # 解析模型
    subagent_model = resolve_model(spec.get("model", model))
    subagent_profile = _harness_profile_for_model(subagent_model, ...)

    # 权限继承
    subagent_permissions = spec.get("permissions", permissions)

    # 构建中间件栈
    subagent_middleware: list[AgentMiddleware] = [
        TodoListMiddleware(),
        FilesystemMiddleware(
            backend=backend,
            custom_tool_descriptions=subagent_profile.tool_description_overrides,
            _permissions=subagent_permissions,
        ),
        create_summarization_middleware(subagent_model, backend),
        PatchToolCallsMiddleware(),
    ]

    # 添加技能中间件
    if subagent_skills := spec.get("skills"):
        subagent_middleware.append(SkillsMiddleware(backend=backend, sources=subagent_skills))

    # 添加用户中间件
    subagent_middleware.extend(spec.get("middleware", []))

    # 添加 Profile 中间件
    subagent_middleware.extend(subagent_profile.materialize_extra_middleware())

    # 排除工具
    if subagent_profile.excluded_tools:
        subagent_middleware.append(_ToolExclusionMiddleware(excluded=subagent_profile.excluded_tools))

    # 提示缓存
    subagent_middleware.append(AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore"))

    # 应用排除中间件
    subagent_middleware = _apply_excluded_middleware(subagent_middleware, subagent_profile, ...)

    return {
        **spec,
        "model": subagent_model,
        "tools": subagent_tools,
        "middleware": subagent_middleware,
        "system_prompt": _apply_profile_prompt(subagent_profile, spec["system_prompt"]),
    }
```

### 4. 组装主 Agent 中间件栈

```python
# 基础栈
deepagent_middleware: list[AgentMiddleware] = [
    TodoListMiddleware(),
]

# 技能中间件
if skills is not None:
    deepagent_middleware.append(
        SkillsMiddleware(backend=backend, sources=skills)
    )

# 文件系统中间件
deepagent_middleware.append(
    FilesystemMiddleware(
        backend=backend,
        custom_tool_descriptions=_profile.tool_description_overrides,
        _permissions=permissions,
    )
)

# 子代理中间件
if inline_subagents:
    deepagent_middleware.append(
        SubAgentMiddleware(
            backend=backend,
            subagents=inline_subagents,
            task_description=_profile.tool_description_overrides.get("task"),
        )
    )

# 摘要和补丁中间件
deepagent_middleware.extend([
    create_summarization_middleware(model, backend),
    PatchToolCallsMiddleware(),
])

# 异步子代理中间件
if async_subagents:
    deepagent_middleware.append(
        AsyncSubAgentMiddleware(async_subagents=async_subagents)
    )

# 用户中间件
if middleware:
    deepagent_middleware.extend(middleware)

# Profile 额外中间件
deepagent_middleware.extend(_profile.materialize_extra_middleware())

# 工具排除中间件
if _profile.excluded_tools:
    deepagent_middleware.append(
        _ToolExclusionMiddleware(excluded=_profile.excluded_tools)
    )

# 提示缓存中间件（无条件添加，对非 Anthropic 模型无操作）
deepagent_middleware.append(
    AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")
)

# 记忆中间件
if memory is not None:
    deepagent_middleware.append(
        MemoryMiddleware(
            backend=backend,
            sources=memory,
            add_cache_control=True,
        )
    )

# 人工审核中间件
if interrupt_on is not None:
    deepagent_middleware.append(
        HumanInTheLoopMiddleware(interrupt_on=interrupt_on)
    )

# 应用排除中间件
deepagent_middleware = _apply_excluded_middleware(
    deepagent_middleware, _profile, ...
)
```

### 5. 组装系统提示

```python
# 基础提示（考虑 Profile 覆盖）
base_prompt = _apply_profile_prompt(_profile, BASE_AGENT_PROMPT)

# 用户提示优先
if system_prompt is None:
    final_system_prompt = base_prompt
elif isinstance(system_prompt, SystemMessage):
    # 保留 cache_control 标记
    final_system_prompt = SystemMessage(
        content_blocks=[
            *system_prompt.content_blocks,
            {"type": "text", "text": f"\n\n{base_prompt}"},
        ]
    )
else:
    final_system_prompt = system_prompt + "\n\n" + base_prompt
```

### 6. 创建 Agent 图

```python
# 子代理名称工厂（用于 SubagentTransformer）
subagent_names = frozenset(
    sub_agent_middleware.subagent_names if sub_agent_middleware else ()
)

def _subagent_factory(scope: tuple[str, ...] = ()) -> SubagentTransformer:
    return SubagentTransformer(scope, subagent_names=subagent_names)

# 调用 create_agent
return create_agent(
    model,
    system_prompt=final_system_prompt,
    tools=_tools,
    middleware=deepagent_middleware,
    response_format=response_format,
    context_schema=context_schema,
    checkpointer=checkpointer,
    store=store,
    debug=debug,
    name=name,
    cache=cache,
    state_schema=_DeepAgentState,  # 使用 DeltaChannel 的状态 Schema
    transformers=[_subagent_factory],
).with_config({
    "recursion_limit": 9_999,
    "metadata": {
        "ls_integration": "deepagents",
        "versions": {"deepagents": __version__},
        "lc_agent_name": name,
    },
})
```

### 7. _DeepAgentState

```python
class _DeepAgentState(AgentState):
    """使用 DeltaChannel 优化消息存储"""

    messages: Required[
        Annotated[
            list[AnyMessage],
            DeltaChannel(_messages_delta_reducer, snapshot_frequency=50)
        ]
    ]
```

## 参数详解

### model

```python
# 字符串格式
agent = create_deep_agent(model="anthropic:claude-sonnet-4-6")
agent = create_deep_agent(model="openai:gpt-4o")
agent = create_deep_agent(model="google:gemini-2.0-flash")

# 实例格式
from langchain_anthropic import ChatAnthropic
agent = create_deep_agent(model=ChatAnthropic(model_name="claude-sonnet-4-6"))
```

### tools

```python
from langchain_core.tools import tool

@tool
def my_custom_tool(query: str) -> str:
    """A custom tool."""
    return f"Processed: {query}"

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[my_custom_tool],
)
```

### system_prompt

```python
# 字符串格式
agent = create_deep_agent(
    model="...",
    system_prompt="You are a specialized assistant...",
)

# SystemMessage 格式（支持 cache_control）
from langchain_core.messages import SystemMessage

agent = create_deep_agent(
    model="...",
    system_prompt=SystemMessage(
        content_blocks=[
            {"type": "text", "text": "You are a specialized assistant...", "cache_control": {"type": "ephemeral"}},
        ]
    ),
)
```

### subagents

```python
from deepagents import SubAgent, CompiledSubAgent, AsyncSubAgent

# SubAgent（声明式）
researcher: SubAgent = {
    "name": "researcher",
    "description": "Research agent",
    "system_prompt": "...",
    "model": "openai:gpt-4o",
    "tools": [web_search],
}

# CompiledSubAgent（预编译）
from langchain.agents import create_agent
from pydantic import BaseModel

class Result(BaseModel):
    summary: str

researcher_graph = create_agent("openai:gpt-4o", response_format=Result)
compiled: CompiledSubAgent = {
    "name": "researcher",
    "description": "Research agent",
    "runnable": researcher_graph,
}

# AsyncSubAgent（远程）
async_agent: AsyncSubAgent = {
    "name": "background-researcher",
    "description": "Background research",
    "graph_id": "research-agent",
    "url": "https://deployment.langchain.com",
}

agent = create_deep_agent(
    model="...",
    subagents=[researcher, compiled, async_agent],
)
```

### skills

```python
agent = create_deep_agent(
    model="...",
    skills=[
        "/skills/user/",   # 用户技能
        "/skills/project/",  # 项目技能
    ],
)
```

### memory

```python
agent = create_deep_agent(
    model="...",
    backend=FilesystemBackend(root_dir="/"),
    memory=[
        "~/.deepagents/AGENTS.md",  # 用户记忆
        "./AGENTS.md",  # 项目记忆
    ],
)
```

### permissions

```python
from deepagents import FilesystemPermission

agent = create_deep_agent(
    model="...",
    permissions=[
        FilesystemPermission(
            operations=["read", "write"],
            paths=["/project/**"],
            mode="allow",
        ),
        FilesystemPermission(
            operations=["write"],
            paths=["/readonly/**"],
            mode="deny",
        ),
    ],
)
```

### backend

```python
from deepagents.backends import StateBackend, CompositeBackend

# 状态后端（默认）
agent = create_deep_agent(model="...", backend=StateBackend())

# 组合后端
backend = CompositeBackend(
    default=StateBackend(),
    routes={
        "/memories/": StoreBackend(...),
    },
)
agent = create_deep_agent(model="...", backend=backend)
```

### interrupt_on

```python
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="...",
    interrupt_on={
        "edit_file": True,  # 编辑前暂停
        "execute": {"tools": ["execute"]},  # 命令执行前暂停
    },
    checkpointer=MemorySaver(),
)
```

## 返回值

返回 `CompiledStateGraph` 实例，可以直接调用：

```python
# 同步调用
result = agent.invoke({"messages": "Hello"})

# 流式调用
for event in agent.stream({"messages": "Hello"}):
    print(event)

# 异步调用
result = await agent.ainvoke({"messages": "Hello"})

# 带配置调用
result = agent.invoke(
    {"messages": "Hello"},
    config={"configurable": {"thread_id": "session-1"}},
)
```

## 下一步

- [中间件系统](/architecture/middleware-system)：理解中间件如何工作
- [子代理系统](/architecture/subagent-system)：深入理解子代理机制
- [后端系统](/architecture/backend-system)：了解不同后端的实现