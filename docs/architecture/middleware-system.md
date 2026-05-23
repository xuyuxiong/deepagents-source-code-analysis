# 中间件系统

中间件是 Deep Agents 扩展机制的核心。本文档将深入分析中间件的设计理念、执行流程和核心实现。

## 设计理念

中间件采用 **洋葱模型**（也称管道模式），每个中间件可以：

1. **在请求前执行逻辑**：修改请求、添加信息、执行副作用
2. **调用下一个处理器**：将请求传递给下一个中间件或最终处理器
3. **在响应后执行逻辑**：修改响应、清理资源、记录日志

```
请求 → 中间件1 → 中间件2 → 中间件3 → 模型调用
                                           ↓
响应 ← 中间件1 ← 中间件2 ← 中间件3 ← 模型响应
```

## 中间件接口

**源码路径**: `langchain.agents.middleware.types.AgentMiddleware`

```python
class AgentMiddleware(Generic[AgentStateT, ContextT, ResponseT]):
    """中间件基类"""

    # ============ 类属性 ============

    # 状态 Schema（定义中间件需要的状态字段）
    state_schema: type[AgentStateT] = AgentState

    # 工具列表（注入到 Agent）
    tools: list[BaseTool] = []

    # 系统提示片段（追加到系统提示）
    system_prompt: str | None = None

    # ============ 钩子方法 ============

    # Agent 执行前钩子
    def before_agent(self, state, runtime, config) -> StateUpdate | None:
        """在 Agent 开始执行前调用"""
        return None

    async def abefore_agent(self, state, runtime, config) -> StateUpdate | None:
        """异步版本"""
        return None

    # 模型调用包装器
    def wrap_model_call(self, request, handler) -> ModelResponse:
        """包装模型调用"""
        return handler(request)

    async def awrap_model_call(self, request, handler) -> ModelResponse:
        """异步版本"""
        return await handler(request)

    # 工具调用包装器
    def wrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """包装工具调用"""
        return handler(request)

    async def awrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """异步版本"""
        return await handler(request)

    # 请求修改器
    def modify_request(self, request) -> ModelRequest:
        """修改请求（在 wrap_model_call 之前）"""
        return request
```

## 中间件栈顺序

在 `create_deep_agent` 中，中间件按以下顺序组装：

**源码路径**: `libs/deepagents/deepagents/graph.py:672-730`

```python
# 基础栈
deepagent_middleware: list[AgentMiddleware[Any, Any, Any]] = [
    TodoListMiddleware(),  # 1. 任务列表管理
]

if skills is not None:
    deepagent_middleware.append(
        SkillsMiddleware(backend=backend, sources=skills)  # 2. 技能加载
    )

deepagent_middleware.append(
    FilesystemMiddleware(  # 3. 文件系统工具
        backend=backend,
        custom_tool_descriptions=_profile.tool_description_overrides,
        _permissions=permissions,
    )
)

if inline_subagents:
    deepagent_middleware.append(
        SubAgentMiddleware(  # 4. 同步子代理
            backend=backend,
            subagents=inline_subagents,
        )
    )

deepagent_middleware.extend([
    create_summarization_middleware(model, backend),  # 5. 摘要
    PatchToolCallsMiddleware(),  # 6. 工具调用补丁
])

if async_subagents:
    deepagent_middleware.append(
        AsyncSubAgentMiddleware(async_subagents=async_subagents)  # 7. 异步子代理
    )

# 用户中间件
if middleware:
    deepagent_middleware.extend(middleware)

# Harness Profile 中间件
deepagent_middleware.extend(_profile.materialize_extra_middleware())

if _profile.excluded_tools:
    deepagent_middleware.append(
        _ToolExclusionMiddleware(excluded=_profile.excluded_tools)  # 8. 工具排除
    )

# 尾部栈
deepagent_middleware.append(
    AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")  # 9. 提示缓存
)

if memory is not None:
    deepagent_middleware.append(
        MemoryMiddleware(backend=backend, sources=memory, add_cache_control=True)  # 10. 记忆
    )

if interrupt_on is not None:
    deepagent_middleware.append(
        HumanInTheLoopMiddleware(interrupt_on=interrupt_on)  # 11. 人工审核
    )
```

## 中间件执行流程

### 1. before_agent 阶段

在 Agent 开始执行前调用，用于初始化状态：

```python
# 伪代码
for middleware in middleware_stack:
    if hasattr(middleware, 'before_agent'):
        state_update = middleware.before_agent(state, runtime, config)
        if state_update:
            state.update(state_update)
```

**调用顺序**：
1. `SkillsMiddleware.before_agent`：加载技能元数据
2. `MemoryMiddleware.before_agent`：加载记忆文件

### 2. wrap_model_call 阶段

包装模型调用，可以修改请求和响应：

```python
# 伪代码：洋葱模型
def execute_model_call(request):
    def outer_handler(r):
        return middleware_n.wrap_model_call(r, inner_handler)

    def inner_handler(r):
        return model.invoke(r)

    return outer_handler(request)
```

**实际执行顺序**（从外到内）：
```
FilesystemMiddleware.wrap_model_call
    → 注入文件系统系统提示
    → 检查大 HumanMessage 并卸载

SubAgentMiddleware.wrap_model_call
    → 注入 task 工具说明
    → 注入可用子代理列表

SummarizationMiddleware.wrap_model_call
    → 检查上下文长度
    → 如需要，摘要旧消息

MemoryMiddleware.wrap_model_call
    → 注入记忆内容到系统提示

模型调用
```

### 3. wrap_tool_call 阶段

包装工具调用，可以修改请求和响应：

```python
# 伪代码
for tool_call in tool_calls:
    def outer_handler(req):
        return middleware.wrap_tool_call(req, inner_handler)

    def inner_handler(req):
        return execute_tool(req)

    result = outer_handler(tool_call)
```

**实际调用**：
```
FilesystemMiddleware.wrap_tool_call
    → 执行工具
    → 检查结果大小
    → 如果超过阈值，卸载到文件系统
    → 返回 ToolMessage
```

## 核心中间件分析

### FilesystemMiddleware

**源码路径**: `libs/deepagents/deepagents/middleware/filesystem.py`

**职责**：
1. 提供 7 个文件系统工具
2. 大内容自动卸载
3. 权限控制
4. HumanMessage 卸载

**注入的工具**：
- `ls`：列出目录
- `read_file`：读取文件
- `write_file`：写入文件
- `edit_file`：编辑文件
- `glob`：模式匹配
- `grep`：文本搜索
- `execute`：命令执行（需要 SandboxBackend）

**大内容卸载机制**：

```python
def _process_large_message(self, message: ToolMessage, backend: BackendProtocol):
    """处理大 ToolMessage，卸载到文件系统"""
    if len(content) > NUM_CHARS_PER_TOKEN * self._tool_token_limit_before_evict:
        # 写入文件
        file_path = f"{self._large_tool_results_prefix}/{uuid.uuid4()}"
        backend.write(file_path, content)
        # 返回预览
        return truncated_message_with_file_reference
    return message
```

### SubAgentMiddleware

**源码路径**: `libs/deepagents/deepagents/middleware/subagents.py`

**职责**：
1. 提供 `task` 工具
2. 管理子代理生命周期
3. 隔离子代理上下文

**task 工具实现**：

```python
def task(description: str, subagent_type: str, runtime: ToolRuntime) -> str | Command:
    """task 工具实现"""
    # 1. 验证子代理类型
    if subagent_type not in subagent_graphs:
        return f"Error: Unknown subagent type {subagent_type}"

    # 2. 准备子代理状态
    subagent_state = {
        k: v for k, v in runtime.state.items()
        if k not in _EXCLUDED_STATE_KEYS  # 排除敏感状态
    }
    subagent_state["messages"] = [HumanMessage(content=description)]

    # 3. 调用子代理
    result = subagent.invoke(subagent_state, subagent_config)

    # 4. 返回结果
    if structured := result.get("structured_response"):
        return Command(update={"messages": [ToolMessage(
            content=json.dumps(structured),
            tool_call_id=runtime.tool_call_id,
        )]})
    else:
        return Command(update={"messages": [ToolMessage(
            content=result["messages"][-1].text,
            tool_call_id=runtime.tool_call_id,
        )]})
```

### MemoryMiddleware

**源码路径**: `libs/deepagents/deepagents/middleware/memory.py`

**职责**：
1. 从 AGENTS.md 文件加载记忆
2. 注入到系统提示
3. 支持 Anthropic 提示缓存

**before_agent 实现**：

```python
def before_agent(self, state, runtime, config) -> MemoryStateUpdate | None:
    """加载记忆文件"""
    if "memory_contents" in state:
        return None  # 已加载，跳过

    contents: dict[str, str] = {}
    for path in self.sources:
        response = backend.download_files([path])[0]
        if response.error == "file_not_found":
            continue
        contents[path] = response.content.decode("utf-8")

    return MemoryStateUpdate(memory_contents=contents)
```

**modify_request 实现**：

```python
def modify_request(self, request: ModelRequest) -> ModelRequest:
    """注入记忆到系统提示"""
    contents = request.state.get("memory_contents", {})
    agent_memory = self._format_agent_memory(contents)
    new_system_message = append_to_system_message(
        request.system_message,
        agent_memory,
    )
    return request.override(system_message=new_system_message)
```

### SkillsMiddleware

**源码路径**: `libs/deepagents/deepagents/middleware/skills.py`

**职责**：
1. 从 SKILL.md 文件加载技能元数据
2. 渐进式披露（只显示名称和描述）
3. 支持多源技能加载

**技能结构**：

```
/skills/
└── web-research/
    └── SKILL.md
```

**SKILL.md 格式**：

```markdown
---
name: web-research
description: Conduct thorough web research
license: MIT
---

# Web Research Skill

## When to Use
- User asks for research...
```

**技能加载流程**：

```python
def _list_skills_with_errors(backend: BackendProtocol, source_path: str):
    """加载技能"""
    # 1. 列出目录
    ls_result = backend.ls(source_path)

    # 2. 过滤出目录
    skill_dirs = [item for item in ls_result.entries if item["is_dir"]]

    # 3. 下载每个 SKILL.md
    skill_md_paths = [f"{d['path']}/SKILL.md" for d in skill_dirs]
    responses = backend.download_files(skill_md_paths)

    # 4. 解析元数据
    for response in responses:
        if response.content:
            metadata = _parse_skill_metadata(response.content)
            if metadata:
                skills.append(metadata)

    return skills, errors
```

## 自定义中间件

### 示例：日志中间件

```python
from langchain.agents.middleware.types import AgentMiddleware, ModelRequest, ModelResponse
import logging

class LoggingMiddleware(AgentMiddleware):
    """日志中间件"""

    def __init__(self, logger=None):
        self.logger = logger or logging.getLogger(__name__)

    def wrap_model_call(self, request, handler):
        self.logger.info(f"Model call: {len(request.messages)} messages")
        response = handler(request)
        self.logger.info(f"Model response: {len(response.message.content)} chars")
        return response

    def wrap_tool_call(self, request, handler):
        self.logger.info(f"Tool call: {request.tool_call['name']}")
        result = handler(request)
        self.logger.info(f"Tool result: {len(result.content) if hasattr(result, 'content') else 'N/A'}")
        return result
```

### 示例：缓存中间件

```python
from langchain.agents.middleware.types import AgentMiddleware

class CacheMiddleware(AgentMiddleware):
    """简单缓存中间件"""

    def __init__(self):
        self.cache = {}

    def wrap_model_call(self, request, handler):
        # 生成缓存键
        cache_key = self._hash_request(request)

        # 检查缓存
        if cache_key in self.cache:
            return self.cache[cache_key]

        # 调用模型
        response = handler(request)

        # 缓存响应
        self.cache[cache_key] = response
        return response

    def _hash_request(self, request):
        # 简化实现，实际应考虑消息内容
        return hash(str([m.content for m in request.messages]))
```

### 示例：重试中间件

```python
from langchain.agents.middleware.types import AgentMiddleware
import time

class RetryMiddleware(AgentMiddleware):
    """重试中间件"""

    def __init__(self, max_retries=3, delay=1):
        self.max_retries = max_retries
        self.delay = delay

    async def awrap_model_call(self, request, handler):
        last_error = None
        for attempt in range(self.max_retries):
            try:
                return await handler(request)
            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    time.sleep(self.delay * (attempt + 1))
        raise last_error
```

## 下一步

- [FilesystemMiddleware](/core/filesystem-middleware)：深入理解文件系统中间件
- [SubAgentMiddleware](/core/subagent-middleware)：深入理解子代理中间件
- [后端系统](/architecture/backend-system)：了解不同后端的实现差异
- [自定义中间件](/advanced/custom-middleware)：学习如何编写自定义中间件