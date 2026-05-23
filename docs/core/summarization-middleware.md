# SummarizationMiddleware

SummarizationMiddleware 实现自动对话压缩，将旧消息总结后写入后端，释放上下文窗口。

**源码路径**: `libs/deepagents/deepagents/middleware/summarization.py`

## 核心功能

1. **自动触发**: 达到阈值时自动压缩对话
2. **历史卸载**: 将旧消息保存到后端
3. **工具参数截断**: 预压缩阶段截断大参数
4. **溢出回退**: ContextOverflowError 时触发压缩
5. **手动压缩**: 提供 `compact_conversation` 工具

## 初始化

```python
class SummarizationMiddleware(AgentMiddleware):
    def __init__(
        self,
        model: str | BaseChatModel,
        *,
        backend: BACKEND_TYPES,
        trigger: ContextSize | list[ContextSize] | None = None,
        keep: ContextSize = ("messages", 20),
        token_counter: TokenCounter = count_tokens_approximately,
        summary_prompt: str = DEFAULT_SUMMARY_PROMPT,
        trim_tokens_to_summarize: int | None = 4000,
        truncate_args_settings: TruncateArgsSettings | None = None,
    ):
        self._backend = backend
        self._lc_helper = LCSummarizationMiddleware(...)
        self._history_path_prefix = "/conversation_history"
        self._large_tool_results_prefix = "/large_tool_results"
```

### 参数说明

- **model**: 用于生成摘要的模型
- **backend**: 存储对话历史的后端
- **trigger**: 触发压缩的阈值
- **keep**: 保留的消息数量/比例
- **truncate_args_settings**: 工具参数截断配置

## 触发阈值

ContextSize 支持三种类型：

```python
# 消息数量
("messages", 100)  # 超过 100 条消息

# 令牌数量
("tokens", 100000)  # 超过 100,000 tokens

# 上下文比例
("fraction", 0.85)  # 超过 85% 上下文窗口
```

### 多阈值触发

```python
trigger=[
    ("messages", 100),  # 100 条消息
    ("fraction", 0.85),  # 或 85% 上下文
]
```

### 模型感知默认值

```python
def compute_summarization_defaults(model: BaseChatModel) -> SummarizationDefaults:
    if model.profile and "max_input_tokens" in model.profile:
        return {
            "trigger": ("fraction", 0.85),
            "keep": ("fraction", 0.10),
            "truncate_args_settings": {
                "trigger": ("fraction", 0.85),
                "keep": ("fraction", 0.10),
            },
        }

    # 无 profile 信息时使用保守默认值
    return {
        "trigger": ("tokens", 170000),
        "keep": ("messages", 6),
        "truncate_args_settings": {
            "trigger": ("messages", 20),
            "keep": ("messages", 20),
        },
    }
```

## 对话压缩流程

### 1. wrap_model_call 钩子

```python
def wrap_model_call(self, request: ModelRequest, handler: Callable) -> ModelResponse:
    # 1. 应用之前的压缩事件
    effective_messages = self._get_effective_messages(request)

    # 2. 工具参数截断
    truncated_messages, _ = self._truncate_args(effective_messages, ...)

    # 3. 检查是否需要压缩
    should_summarize = self._should_summarize(truncated_messages, total_tokens)

    if not should_summarize:
        try:
            return handler(request.override(messages=truncated_messages))
        except ContextOverflowError:
            # 溢出时触发压缩
            overflow_triggered = True

    # 4. 执行压缩
    cutoff_index = self._determine_cutoff_index(truncated_messages)
    messages_to_summarize, preserved_messages = self._partition_messages(...)

    # 5. 卸载历史到后端
    file_path = self._offload_to_backend(backend, messages_to_summarize)

    # 6. 生成摘要
    summary = self._create_summary(messages_to_summarize)

    # 7. 构建新消息
    new_messages = self._build_new_messages_with_path(summary, file_path)

    # 8. 调用模型并返回
    modified_messages = [*new_messages, *preserved_messages]
    response = handler(request.override(messages=modified_messages))

    return ExtendedModelResponse(
        model_response=response,
        command=Command(update={"_summarization_event": new_event}),
    )
```

### 2. 历史卸载

```python
def _offload_to_backend(self, backend: BackendProtocol, messages: list[AnyMessage]) -> str | None:
    """卸载消息到后端

    保存到 /conversation_history/{thread_id}.md
    每次压缩追加新章节
    """
    path = self._get_history_path()
    timestamp = datetime.now(UTC).isoformat()
    new_section = f"## Summarized at {timestamp}\n\n{get_buffer_string(messages)}\n\n"

    # 读取现有内容（如果存在）
    existing_content = ""
    try:
        responses = backend.download_files([path])
        if responses[0].content:
            existing_content = responses[0].content.decode("utf-8")
    except Exception:
        pass

    # 写入
    combined_content = existing_content + new_section
    result = backend.edit(path, existing_content, combined_content) if existing_content else backend.write(path, combined_content)

    return path if result and not result.error else None
```

### 3. 摘要消息

```python
def _build_new_messages_with_path(self, summary: str, file_path: str | None) -> list[AnyMessage]:
    """构建摘要消息"""
    if file_path is not None:
        content = f"""You are in the middle of a conversation that has been summarized.

The full conversation history has been saved to {file_path} should you need to refer back to it for details.

A condensed summary follows:

<summary>
{summary}
</summary>"""
    else:
        content = f"Here is a summary of the conversation to date:\n\n{summary}"

    return [
        HumanMessage(content=content, additional_kwargs={"lc_source": "summarization"})
    ]
```

## 工具参数截断

在完整压缩前，先截断旧消息中的大工具参数：

```python
class TruncateArgsSettings(TypedDict, total=False):
    trigger: ContextSize | None  # 触发阈值
    keep: ContextSize  # 保留的策略
    max_length: int  # 参数最大长度
    truncation_text: str  # 截断后缀
```

### 截断逻辑

```python
def _truncate_args(self, messages, system_message, tools):
    """截断大工具参数"""
    if not self._should_truncate_args(messages, total_tokens):
        return messages, False

    cutoff_index = self._determine_truncate_cutoff_index(messages)

    truncated_messages = []
    for i, msg in enumerate(messages):
        if i < cutoff_index and isinstance(msg, AIMessage) and msg.tool_calls:
            truncated_calls = []
            for call in msg.tool_calls:
                if call["name"] in {"write_file", "edit_file"}:
                    truncated_calls.append(self._truncate_tool_call(call))
                else:
                    truncated_calls.append(call)
            # 创建新消息...
        else:
            truncated_messages.append(msg)

    return truncated_messages, True
```

## SummarizationToolMiddleware

提供 `compact_conversation` 工具供 Agent 主动压缩：

```python
class SummarizationToolMiddleware(AgentMiddleware):
    def __init__(
        self,
        summarization: SummarizationMiddleware,
        *,
        system_prompt: str | None = SUMMARIZATION_SYSTEM_PROMPT,
    ):
        self._summarization = summarization
        self.tools = [self._create_compact_tool()]
```

### compact_conversation 工具

```python
def _run_compact(self, runtime: ToolRuntime) -> Command:
    """手动压缩对话"""
    messages = runtime.state.get("messages", [])
    event = runtime.state.get("_summarization_event")
    effective = self._summarization._apply_event_to_messages(messages, event)

    # 检查是否符合压缩条件（约 50% 触发阈值）
    if not self._is_eligible_for_compaction(effective):
        return self._nothing_to_compact(tool_call_id)

    cutoff = self._summarization._determine_cutoff_index(effective)
    to_summarize, _ = self._summarization._partition_messages(effective, cutoff)

    # 生成摘要并卸载
    summary = self._summarization._create_summary(to_summarize)
    backend = self._resolve_backend(runtime)
    file_path = self._summarization._offload_to_backend(backend, to_summarize)

    return self._build_compact_result(...)
```

### 压缩条件检查

```python
def _is_eligible_for_compaction(self, messages: list[AnyMessage]) -> bool:
    """检查是否允许手动压缩

    需要 reach 约 50% 的自动压缩阈值
    """
    for kind, value in self._summarization._lc_helper._trigger_conditions:
        if kind == "tokens":
            threshold = int(value * 0.5)
            if lc._should_summarize_based_on_reported_tokens(messages, threshold):
                return True
        elif kind == "fraction":
            max_input_tokens = lc._get_profile_limits()
            threshold = int(max_input_tokens * value * 0.5)
            if lc._should_summarize_based_on_reported_tokens(messages, threshold):
                return True
    return False
```

## 使用示例

### 创建自动压缩中间件

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from deepagents.middleware.summarization import SummarizationMiddleware

summarization = SummarizationMiddleware(
    model="openai:gpt-4o-mini",
    backend=FilesystemBackend(root_dir="/data"),
    trigger=("fraction", 0.85),
    keep=("messages", 20),
    truncate_args_settings={
        "trigger": ("fraction", 0.75),
        "keep": ("messages", 20),
        "max_length": 2000,
    },
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[summarization],
)
```

### 创建手动压缩工具

```python
from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    SummarizationToolMiddleware,
)

summarization = SummarizationMiddleware(model="openai:gpt-4o-mini", backend=backend)
tool_middleware = SummarizationToolMiddleware(summarization)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[summarization, tool_middleware],
)
```

### 便捷工厂函数

```python
from deepagents.middleware.summarization import create_summarization_tool_middleware

# 自动配置模型感知默认值
tool_middleware = create_summarization_tool_middleware("openai:gpt-4o-mini", backend)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[tool_middleware],
)
```

## 溢出处理

当 `ContextOverflowError` 发生时，自动压缩并重试：

```python
try:
    return handler(request.override(messages=truncated_messages))
except ContextOverflowError:
    overflow_triggered = True
    # 继续执行压缩流程...

# 压缩后还有溢出？裁剪保留的大 ToolMessage
if overflow_triggered:
    preserved_messages, new_state_tail = _clip_overflow_tail(
        preserved_messages,
        backend,
        keep=self._lc_helper.keep,
        max_input_tokens=self._get_profile_limits(),
        token_counter=self.token_counter,
        large_tool_results_prefix=self._large_tool_results_prefix,
    )
```

## 下一步

- [MemoryMiddleware](./memory-middleware.md) - 记忆中间件
- [SkillsMiddleware](./skills-middleware.md) - 技能中间件
- [BackendProtocol](./backend-protocol.md) - 后端协议