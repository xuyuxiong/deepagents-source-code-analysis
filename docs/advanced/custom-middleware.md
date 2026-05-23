# 自定义中间件

本文档介绍如何创建自定义中间件来扩展 Deep Agents 的能力。

## AgentMiddleware 接口

所有中间件都继承自 `AgentMiddleware`：

```python
from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, ModelResponse
from typing import Callable, Awaitable

class MyMiddleware(AgentMiddleware):
    """自定义中间件"""

    state_schema = AgentState  # 可选：定义状态 schema

    def __init__(self, **kwargs):
        self.tools = []  # 可选：提供工具
        self.system_prompt = None  # 可选：注入系统提示

    # 钩子方法（按调用顺序）

    def before_agent(self, state, runtime, config) -> AgentStateUpdate | None:
        """在 Agent 开始执行前调用"""
        pass

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse | ExtendedModelResponse:
        """包装模型调用"""
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | ExtendedModelResponse:
        """异步包装模型调用"""
        return await handler(request)

    def wrap_tool_call(
        self,
        tool_call: dict,
        handler: Callable[[dict], Any],
    ) -> Any:
        """包装工具调用"""
        return handler(tool_call)

    async def awrap_tool_call(
        self,
        tool_call: dict,
        handler: Callable[[dict], Awaitable[Any]],
    ) -> Any:
        """异步包装工具调用"""
        return await handler(tool_call)
```

## 钩子执行顺序

```
1. before_agent (所有中间件按顺序执行)
   ↓
2. wrap_model_call (中间件链条，按顺序)
   - 修改系统提示
   - 修改消息列表
   - 调用模型
   - 处理响应
   ↓
3. [工具调用] wrap_tool_call (如果模型调用工具)
   - 验证工具参数
   - 执行工具
   - 处理结果
   - [可能触发更多模型调用]
   ↓
4. [循环：工具调用 → 模型调用 直到无更多工具调用]
```

## before_agent 钩子

在 Agent 开始执行前运行，用于预处理状态：

```python
class PreloadingMiddleware(AgentMiddleware):
    def __init__(self, backend: BackendProtocol, data_path: str):
        self._backend = backend
        self._data_path = data_path

    def before_agent(self, state, runtime, config) -> AgentStateUpdate | None:
        if "preload_data" in state:
            return None  # 已加载

        # 从后端加载数据
        result = self._backend.read(self._data_path)
        if result.file_data:
            return AgentStateUpdate(preload_data=result.file_data["content"])

        return None
```

### 状态更新

```python
from langgraph.types import Command

def before_agent(self, state, runtime, config):
    # 返回状态更新
    return AgentStateUpdate(
        my_field="value",
        another_field=[1, 2, 3],
    )

    # 或使用 Command（更灵活）
    return Command(update={"my_field": "value"})
```

## wrap_model_call 钩子

包装模型调用，可修改请求和响应：

### 修改系统提示

```python
class SystemPromptMiddleware(AgentMiddleware):
    def __init__(self, additional_prompt: str):
        self.additional_prompt = additional_prompt

    def wrap_model_call(self, request, handler):
        new_system = append_to_system_message(
            request.system_message,
            self.additional_prompt
        )
        return handler(request.override(system_message=new_system))
```

### 修改消息列表

```python
class MessageFilterMiddleware(AgentMiddleware):
    def __init__(self, max_messages: int = 100):
        self.max_messages = max_messages

    def wrap_model_call(self, request, handler):
        if len(request.messages) <= self.max_messages:
            return handler(request)

        # 保留系统消息和最近的消息
        filtered = request.messages[-self.max_messages:]
        return handler(request.override(messages=filtered))
```

### 处理响应

```python
from langchain.agents.middleware.types import ExtendedModelResponse

class ResponseLoggingMiddleware(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        response = handler(request)

        # 记录响应
        logger.info(f"Model response: {response}")

        # 返回扩展响应
        return ExtendedModelResponse(
            model_response=response,
            command=Command(update={"last_model_call": datetime.now().isoformat()})
        )
```

### 异步实现

```python
class AsyncMiddleware(AgentMiddleware):
    async def awrap_model_call(self, request, handler):
        # 异步操作
        data = await async_load_data()

        new_system = append_to_system_message(request.system_message, data)
        return await handler(request.override(system_message=new_system))

    def wrap_model_call(self, request, handler):
        # 同步版本（可选，默认包装异步版本）
        return asyncio.run(self.awrap_model_call(request, handler))
```

## wrap_tool_call 钩子

包装工具调用，可验证参数、记录日志、修改结果：

### 参数验证

```python
class ToolValidationMiddleware(AgentMiddleware):
    def __init__(self, allowed_tools: set[str]):
        self.allowed_tools = allowed_tools

    def wrap_tool_call(self, tool_call, handler):
        tool_name = tool_call.get("name")

        if tool_name not in self.allowed_tools:
            return f"Error: Tool '{tool_name}' is not allowed"

        return handler(tool_call)
```

### 日志记录

```python
class ToolLoggingMiddleware(AgentMiddleware):
    def wrap_tool_call(self, tool_call, handler):
        start_time = time.time()
        logger.info(f"Tool call: {tool_call['name']}")

        try:
            result = handler(tool_call)
            duration = time.time() - start_time
            logger.info(f"Tool result: {tool_call['name']} took {duration:.2f}s")
            return result
        except Exception as e:
            logger.error(f"Tool error: {tool_call['name']}: {e}")
            raise
```

### 结果修改

```python
class ResultSanitizationMiddleware(AgentMiddleware):
    def __init__(self, patterns: list[tuple[str, str]]):
        self.patterns = [(re.compile(p), r) for p, r in patterns]

    def wrap_tool_call(self, tool_call, handler):
        result = handler(tool_call)

        if isinstance(result, str):
            for pattern, replacement in self.patterns:
                result = pattern.sub(replacement, result)

        return result
```

## 提供工具

中间件可以通过 `self.tools` 提供工具：

```python
from langchain_core.tools import StructuredTool

class CustomToolsMiddleware(AgentMiddleware):
    def __init__(self):
        self.tools = [self._create_hello_tool()]

    def _create_hello_tool(self) -> StructuredTool:
        def hello(name: str, runtime: ToolRuntime) -> str:
            return f"Hello, {name}!"

        return StructuredTool.from_function(
            name="hello",
            description="Greet someone",
            func=hello,
        )
```

## 状态 Schema

中间件可以定义自己的状态 schema：

```python
from typing import Annotated, NotRequired
from typing_extensions import TypedDict
from langchain.agents.middleware.types import PrivateStateAttr

class MyState(TypedDict):
    my_custom_field: Annotated[str, PrivateStateAttr]
    another_field: NotRequired[int]

class MyMiddleware(AgentMiddleware):
    state_schema = MyState

    def before_agent(self, state, runtime, config):
        # 访问自定义状态
        custom_field = state.get("my_custom_field", "default")
        return MyState(my_custom_field="updated")
```

## 中间件组合

多个中间件按注册顺序执行：

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[
        LoggingMiddleware(),  # 先执行
        ValidationMiddleware(),
        CustomToolsMiddleware(),
    ],
)
```

### 执行顺序

```
before_agent:
  LoggingMiddleware.before_agent()
  ValidationMiddleware.before_agent()
  CustomToolsMiddleware.before_agent()

wrap_model_call:
  LoggingMiddleware.wrap_model_call(
    ValidationMiddleware.wrap_model_call(
      CustomToolsMiddleware.wrap_model_call(
        handler()  # 实际模型调用
      )
    )
  )

wrap_tool_call:
  LoggingMiddleware.wrap_tool_call(
    ValidationMiddleware.wrap_tool_call(
      CustomToolsMiddleware.wrap_tool_call(
        handler()  # 实际工具调用
      )
    )
  )
```

## 最佳实践

### 1. 避免阻塞操作

```python
# ❌ 不好：阻塞调用
def wrap_model_call(self, request, handler):
    time.sleep(1)  # 阻塞
    return handler(request)

# ✅ 好：使用异步
async def awrap_model_call(self, request, handler):
    await asyncio.sleep(1)
    return await handler(request)
```

### 2. 保持幂等性

```python
def before_agent(self, state, runtime, config):
    # ✅ 检查是否已加载
    if "my_data" in state:
        return None

    return AgentStateUpdate(my_data=load_data())
```

### 3. 合理使用状态

```python
# ❌ 不好：滥用全局状态
def before_agent(self, state, runtime, config):
    return AgentStateUpdate(
        cache={},  # 过大的状态
        history=[],  # 无限增长
    )

# ✅ 好：限制状态大小
def before_agent(self, state, runtime, config):
    cache = state.get("cache", {})
    if len(cache) > 100:
        cache = dict(list(cache.items())[-100:])
    return AgentStateUpdate(cache=cache)
```

### 4. 错误处理

```python
def wrap_tool_call(self, tool_call, handler):
    try:
        return handler(tool_call)
    except Exception as e:
        # 记录错误但不中断执行
        logger.error(f"Tool call failed: {e}")
        return f"Error: {type(e).__name__}: {e}"
```

## 示例：速率限制中间件

```python
import asyncio
from datetime import datetime, timedelta

class RateLimitMiddleware(AgentMiddleware):
    def __init__(self, max_calls: int = 60, window_seconds: int = 60):
        self.max_calls = max_calls
        self.window = timedelta(seconds=window_seconds)
        self.calls: list[datetime] = []

    def _clean_old_calls(self):
        cutoff = datetime.now() - self.window
        self.calls = [t for t in self.calls if t > cutoff]

    def _wait_time(self) -> float:
        self._clean_old_calls()
        if len(self.calls) < self.max_calls:
            return 0.0
        # 等待最旧的调用过期
        oldest = self.calls[0]
        return (oldest + self.window - datetime.now()).total_seconds()

    async def awrap_model_call(self, request, handler):
        wait = self._wait_time()
        if wait > 0:
            await asyncio.sleep(wait)

        self.calls.append(datetime.now())
        return await handler(request)
```

## 下一步

- [SkillsMiddleware](../core/skills-middleware.md) - 技能中间件
- [MemoryMiddleware](../core/memory-middleware.md) - 记忆中间件
- [SummarizationMiddleware](../core/summarization-middleware.md) - 摘要中间件