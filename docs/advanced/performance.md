# 性能优化

本文档介绍 Deep Agents 的性能优化策略和最佳实践。

## 上下文管理

### 1. 自动摘要

```python
from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    create_summarization_tool_middleware,
)

# 自动压缩对话
summarization = SummarizationMiddleware(
    model="openai:gpt-4o-mini",  # 使用小模型生成摘要
    backend=backend,
    trigger=("fraction", 0.85),  # 85% 时触发
    keep=("fraction", 0.10),  # 保留 10%
)

# 手动压缩工具
tool_middleware = create_summarization_tool_middleware(
    model="openai:gpt-4o-mini",
    backend=backend,
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[summarization, tool_middleware],
)
```

### 2. 工具参数截断

```python
summarization = SummarizationMiddleware(
    model="openai:gpt-4o-mini",
    backend=backend,
    truncate_args_settings={
        "trigger": ("fraction", 0.75),  # 75% 时开始截断
        "keep": ("messages", 20),  # 保留最近 20 条消息
        "max_length": 2000,  # 参数最大 2000 字符
        "truncation_text": "...(truncated)",
    },
)
```

### 3. 消息过滤

```python
from langchain.agents.middleware.types import AgentMiddleware

class MessageFilterMiddleware(AgentMiddleware):
    """过滤旧消息以减少上下文"""

    def __init__(self, max_messages: int = 100):
        self.max_messages = max_messages

    def wrap_model_call(self, request, handler):
        if len(request.messages) <= self.max_messages:
            return handler(request)

        # 保留系统消息和最近的消息
        system = [m for m in request.messages if isinstance(m, SystemMessage)]
        recent = request.messages[-self.max_messages:]

        return handler(request.override(messages=[*system, *recent]))
```

## 缓存策略

### 1. 后端缓存

```python
from functools import lru_cache

class CachedBackend(BackendProtocol):
    """带缓存的文件系统后端"""

    def __init__(self, backend: BackendProtocol, ttl: int = 60):
        self._backend = backend
        self._ttl = ttl
        self._cache: dict[str, tuple[float, FileData]] = {}

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        # 检查缓存
        cache_key = f"{file_path}:{offset}:{limit}"
        if cache_key in self._cache:
            timestamp, data = self._cache[cache_key]
            if time.time() - timestamp < self._ttl:
                return ReadResult(file_data=data)

        # 读取并缓存
        result = self._backend.read(file_path, offset, limit)
        if result.file_data:
            self._cache[cache_key] = (time.time(), result.file_data)
        return result
```

### 2. 技能缓存

```python
class CachedSkillsMiddleware(SkillsMiddleware):
    """带缓存的技能加载"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._skills_cache: dict[str, SkillMetadata] = {}
        self._content_cache: dict[str, str] = {}

    def before_agent(self, state, runtime, config):
        # 使用缓存
        if "skills_metadata" in state:
            return None

        # 从缓存加载或读取
        skills = []
        for source_path in self.sources:
            if source_path in self._skills_cache:
                skills.append(self._skills_cache[source_path])
            else:
                skill = self._load_skill(source_path)
                self._skills_cache[source_path] = skill
                skills.append(skill)

        return SkillsStateUpdate(skills_metadata=skills)
```

### 3. 模型响应缓存

```python
from langchain.cache import InMemoryCache
from langchain.chat_models import ChatAnthropic

# 启用 LangChain 缓存
langchain.llm_cache = InMemoryCache()

# 或使用 Redis 缓存
from langchain.cache import RedisCache
import redis

langchain.llm_cache = RedisCache(redis.Redis(host="localhost", port=6379))
```

## 异步优化

### 1. 并行文件读取

```python
async def read_multiple_files(backend: BackendProtocol, paths: list[str]) -> dict[str, str]:
    """并行读取多个文件"""
    tasks = [backend.aread(path) for path in paths]
    results = await asyncio.gather(*tasks)

    return {
        path: result.file_data["content"]
        for path, result in zip(paths, results)
        if result.file_data
    }
```

### 2. 并行搜索

```python
async def parallel_search(backend: BackendProtocol, patterns: list[str]) -> list[GrepResult]:
    """并行搜索多个模式"""
    tasks = [backend.agrep(pattern) for pattern in patterns]
    return await asyncio.gather(*tasks)
```

### 3. 异步子代理

```python
from deepagents.middleware.async_subagents import AsyncSubAgentMiddleware

async_subagent_middleware = AsyncSubAgentMiddleware(
    subagents=[
        SubAgent(name="researcher", ...),
        SubAgent(name="analyzer", ...),
    ],
    max_concurrent=3,  # 最多 3 个并行
)

agent = create_deep_agent(
    middleware=[async_subagent_middleware],
)
```

## 搜索优化

### 1. 使用 ripgrep

FilesystemBackend 自动使用 ripgrep 进行搜索（如果可用）：

```python
# ripgrep 比 Python 搜索快 10-100 倍
# 无需额外配置，自动检测
```

### 2. Glob 预过滤

```python
# ❌ 慢：搜索所有文件
grep(pattern="function")

# ✅ 快：先过滤再搜索
grep(pattern="function", glob="*.py")
```

### 3. 路径限制

```python
# ❌ 慢：搜索整个项目
grep(pattern="error")

# ✅ 快：限制搜索路径
grep(pattern="error", path="/src")
```

## 批量操作

### 1. 批量文件操作

```python
# ❌ 慢：逐个操作
for path, content in files:
    backend.write(path, content)

# ✅ 快：批量操作
backend.upload_files([(path, content.encode()) for path, content in files])
```

### 2. 批量下载

```python
# ❌ 慢：逐个读取
contents = {}
for path in paths:
    result = backend.read(path)
    contents[path] = result.file_data

# ✅ 快：批量下载
responses = backend.download_files(paths)
contents = {
    r.path: r.content.decode()
    for r in responses
    if r.content
}
```

## 存储优化

### 1. CompositeBackend 路由

```python
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

# 将频繁访问的文件放在内存中
backend = CompositeBackend(
    default=StateBackend(),  # 默认：内存存储（快）
    routes={
        "/memories/": StoreBackend(),  # 持久化存储（慢）
    },
)
```

### 2. 虚拟模式优化

```python
# 启用虚拟模式可以避免路径解析开销
backend = FilesystemBackend(
    root_dir="/workspace",
    virtual_mode=True,  # 路径解析更快
)
```

## 模型优化

### 1. 使用小模型处理简单任务

```python
# 子代理使用小模型
research_subagent = SubAgent(
    name="researcher",
    model="anthropic:claude-haiku-3-5",  # 小模型
    tools=["web_search"],
)

# 摘要使用小模型
summarization = SummarizationMiddleware(
    model="openai:gpt-4o-mini",  # 小模型
)
```

### 2. 提示缓存

Anthropic 模型支持提示缓存：

```python
from langchain.chat_models import ChatAnthropic

model = ChatAnthropic(
    model="claude-sonnet-4-6",
    caching=True,  # 启用缓存
)
```

## 监控和调试

### 1. 性能指标

```python
import time
from langchain.agents.middleware.types import AgentMiddleware

class PerformanceMiddleware(AgentMiddleware):
    """性能监控中间件"""

    def wrap_model_call(self, request, handler):
        start_time = time.time()
        response = handler(request)
        duration = time.time() - start_time

        print(f"Model call: {duration:.2f}s, {len(request.messages)} messages")

        return response

    def wrap_tool_call(self, tool_call, handler):
        start_time = time.time()
        result = handler(tool_call)
        duration = time.time() - start_time

        print(f"Tool {tool_call['name']}: {duration:.2f}s")

        return result
```

### 2. 令牌使用分析

```python
class TokenAnalysisMiddleware(AgentMiddleware):
    """令牌使用分析"""

    def wrap_model_call(self, request, handler):
        # 估算输入令牌
        input_tokens = self._estimate_tokens(request.messages)

        response = handler(request)

        # 分析输出
        if hasattr(response, 'usage_metadata'):
            print(f"Input: {input_tokens}, Output: {response.usage_metadata}")

        return response

    def _estimate_tokens(self, messages) -> int:
        # 简化估算
        total = 0
        for msg in messages:
            total += len(str(msg.content).split())  # 词数估算
        return total
```

## 性能基准

### 典型场景性能

| 场景 | 优化前 | 优化后 |
|------|-------|--------|
| 100 个文件读取（串行） | 10s | 1s（并行） |
| 全局搜索 "function" | 30s | 0.5s（ripgrep） |
| 上下文超过 100k tokens | 失败 | 2s（摘要） |
| 50 个子代理调用（串行） | 5min | 1min（并行） |

### 建议配置

```python
# 生产环境推荐配置
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=CompositeBackend(
        default=StateBackend(),
        routes={"/memories/": StoreBackend()},
    ),
    middleware=[
        SummarizationMiddleware(
            model="openai:gpt-4o-mini",
            backend=backend,
            trigger=("fraction", 0.85),
        ),
        PerformanceMiddleware(),  # 监控
    ],
)
```

## 下一步

- [SummarizationMiddleware](../core/summarization-middleware.md) - 摘要中间件
- [Best Practices](./best-practices.md) - 最佳实践
- [Custom Backend](./custom-backend.md) - 自定义后端