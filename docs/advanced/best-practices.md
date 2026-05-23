# 最佳实践

本文档总结了使用 Deep Agents 构建生产级应用的最佳实践。

## 后端选择

### 开发环境

```python
from deepagents.backends import FilesystemBackend

backend = FilesystemBackend(
    root_dir="./workspace",
    virtual_mode=True,  # 启用路径安全检查
)
```

### 生产环境 - Web 服务

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

# 推荐：使用 CompositeBackend 隔离存储
backend = CompositeBackend(
    default=StateBackend(),  # 临时文件在内存中
    routes={
        "/memories/": StoreBackend(),  # 持久化记忆
    },
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)
```

### 生产环境 - 沙箱执行

```python
from langchain_daytona import DaytonaSandbox

# 使用沙箱后端隔离执行环境
sandbox = DaytonaSandbox(api_key="...")
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=sandbox,
)
```

## 记忆管理

### 持久化记忆配置

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend, CompositeBackend, StateBackend

backend = CompositeBackend(
    default=StateBackend(),
    routes={
        "/memories/": FilesystemBackend(root_dir="./data/memories"),
    },
    artifacts_root="/artifacts",
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    memory=[
        "~/.deepagents/AGENTS.md",  # 全局记忆
        "./AGENTS.md",  # 项目记忆
    ],
)
```

### AGENTS.md 最佳实践

```markdown
# Project Memory

## User Preferences
- Always write tests for new features
- Use type hints in all function definitions
- Follow PEP 8 coding style

## Project Conventions
- API endpoints should follow RESTful patterns
- Error handling should use custom exception classes
- Database queries should use parameterized statements

## Known Issues
- Module X has performance issues with large datasets
- Feature Y is deprecated and will be removed in v2.0

## Important Context
- This project is designed for high-throughput processing
- Security is a top priority given PII handling
```

## 技能系统

### 技能目录结构

```
/skills/
├── code-review/
│   └── SKILL.md
├── testing/
│   └── SKILL.md
└── deployment/
    └── SKILL.md
```

### 完整技能示例

```markdown
---
name: code-review
description: Comprehensive code review with security and performance checks
license: MIT
compatibility: Python 3.10+
allowed-tools: read_file glob grep
---

# Code Review Skill

## When to Use
- Before merging Pull Requests
- After implementing new features
- When auditing code quality

## Review Checklist

### Security
- [ ] No hardcoded credentials
- [ ] Input validation present
- [ ] SQL injection prevention
- [ ] XSS protection measures

### Performance
- [ ] Efficient algorithms
- [ ] Proper indexing
- [ ] Caching opportunities

### Code Quality
- [ ] Clear variable names
- [ ] Proper error handling
- [ ] Sufficient documentation

## Workflow
1. Read all modified files
2. Check for security issues
3. Evaluate performance
4. Assess code quality
5. Generate detailed report

## Example Output
```markdown
## Code Review Report

### Security Issues
- ⚠️ Hardcoded API key in config.py:42
- ✅ Input validation present in user_handler.py

### Performance Concerns
- ❌ O(n²) algorithm in data_processor.py:78
- ✅ Proper database indexing in models.py

### Recommendations
1. Move API key to environment variable
2. Use memoization for frequently called functions
```
```

### 技能加载顺序

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    skills=[
        "/skills/global/",  # 全局技能（先加载，可被覆盖）
        "/skills/project/",  # 项目技能
        "/skills/user/",  # 用户技能（后加载，优先级最高）
    ],
)
```

## 上下文管理

### 摘要配置

```python
from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    SummarizationToolMiddleware,
    create_summarization_tool_middleware,
)

# 方法 1: 使用工厂函数（推荐）
tool_middleware = create_summarization_tool_middleware(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)

# 方法 2: 手动配置
summarization = SummarizationMiddleware(
    model="openai:gpt-4o-mini",
    backend=backend,
    trigger=("fraction", 0.85),  # 85% 上下文窗口
    keep=("messages", 20),  # 保留最近 20 条消息
    truncate_args_settings={
        "trigger": ("fraction", 0.75),
        "max_length": 2000,
    },
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[summarization],
)
```

### 工具结果裁剪

对于返回大量数据的工具，考虑在工具层面裁剪：

```python
from langchain_core.tools import StructuredTool

def search_database(query: str, runtime: ToolRuntime) -> str:
    results = db.execute(query)

    # 裁剪结果
    if len(results) > 100:
        results = results[:100]
        return f"Showing first 100 results:\n{format(results)}\n\n(Truncated)"

    return format(results)

tool = StructuredTool.from_function(
    name="search_database",
    func=search_database,
)
```

## 错误处理

### 中间件错误处理

```python
class RobustMiddleware(AgentMiddleware):
    def wrap_tool_call(self, tool_call, handler):
        try:
            result = handler(tool_call)

            # 验证结果
            if result is None:
                return "Error: Tool returned None"

            if isinstance(result, str) and len(result) > 100000:
                return f"Error: Result too large ({len(result)} chars). Please refine your query."

            return result

        except TimeoutError:
            return "Error: Tool execution timed out. Try a simpler operation."

        except Exception as e:
            logger.exception(f"Tool call failed: {tool_call['name']}")
            return f"Error: {type(e).__name__}: {e}"
```

### 后端错误恢复

```python
class ResilientBackend(BackendProtocol):
    def __init__(self, primary: BackendProtocol, fallback: BackendProtocol):
        self._primary = primary
        self._fallback = fallback

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        result = self._primary.read(file_path, offset, limit)

        if result.error:
            # 尝试后备存储
            logger.warning(f"Primary backend failed, trying fallback: {result.error}")
            return self._fallback.read(file_path, offset, limit)

        return result
```

## 性能优化

### 1. 异步调用

```python
# 批量读取文件
async def read_multiple_files(backend: BackendProtocol, paths: list[str]) -> dict[str, str]:
    results = {}
    for path in paths:
        result = await backend.aread(path)
        if result.file_data:
            results[path] = result.file_data["content"]
    return results
```

### 2. 缓存策略

```python
from functools import lru_cache

class CachedBackend(BackendProtocol):
    def __init__(self, backend: BackendProtocol, cache_size: int = 1000):
        self._backend = backend
        self._read_cache = {}

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        cache_key = f"{file_path}:{offset}:{limit}"

        if cache_key in self._read_cache:
            return ReadResult(file_data=self._read_cache[cache_key])

        result = self._backend.read(file_path, offset, limit)

        if result.file_data:
            self._read_cache[cache_key] = result.file_data

        return result
```

### 3. 懒加载

```python
class LazySkillLoader:
    def __init__(self, backend: BackendProtocol, skill_dirs: list[str]):
        self._backend = backend
        self._skill_dirs = skill_dirs
        self._skills = None

    def get_skills(self) -> list[SkillMetadata]:
        if self._skills is None:
            self._skills = self._load_skills()
        return self._skills

    def _load_skills(self) -> list[SkillMetadata]:
        # 只在需要时加载
        skills = []
        for skill_dir in self._skill_dirs:
            # 加载技能...
            pass
        return skills
```

## 安全实践

### 路径隔离

```python
# ✅ 好：启用虚拟模式
backend = FilesystemBackend(
    root_dir="/workspace",
    virtual_mode=True,  # 阻止路径遍历
)

# ❌ 不好：允许任意路径访问
backend = FilesystemBackend(
    root_dir="/workspace",
    virtual_mode=False,  # Agent 可访问 /etc/passwd 等
)
```

### 敏感文件排除

```python
from deepagents.middleware import FilesystemMiddleware

backend = FilesystemMiddleware(
    backend=FilesystemBackend(root_dir="/workspace"),
    read_deny_only=[
        "./prod-secrets",
        "./.env.prod*",
        "./**/*secret*",
        "./**/*token*",
    ],
)
```

### 沙箱隔离

```python
# 生产环境使用沙箱
from langchain_daytona import DaytonaSandbox

sandbox = DaytonaSandbox(api_key="...")
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=sandbox,
    # 配置沙箱限制
    sandbox_limits={
        "timeout": 60,
        "memory": "1GB",
    },
)
```

## 监控和日志

### 结构化日志

```python
import logging
import structlog

# 配置结构化日志
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()

# 在中间件中记录
class LoggingMiddleware(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        logger.info("model_call_started", messages=len(request.messages))

        start_time = time.time()
        response = handler(request)
        duration = time.time() - start_time

        logger.info(
            "model_call_completed",
            duration=duration,
            tokens=response.get("usage", {}),
        )

        return response
```

### 指标收集

```python
from prometheus_client import Counter, Histogram

MODEL_CALLS = Counter("model_calls_total", "Total model calls", ["model"])
MODEL_LATENCY = Histogram("model_latency_seconds", "Model call latency")
TOOL_CALLS = Counter("tool_calls_total", "Total tool calls", ["tool"])

class MetricsMiddleware(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        MODEL_CALLS.labels(model=request.model).inc()

        with MODEL_LATENCY.time():
            return handler(request)

    def wrap_tool_call(self, tool_call, handler):
        TOOL_CALLS.labels(tool=tool_call["name"]).inc()
        return handler(tool_call)
```

## 下一步

- [Performance Optimization](./performance.md) - 性能优化深入
- [Custom Middleware](./custom-middleware.md) - 自定义中间件
- [Custom Backend](./custom-backend.md) - 自定义后端