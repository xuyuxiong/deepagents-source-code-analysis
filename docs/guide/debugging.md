# 调试指南

本文档将介绍如何调试 Deep Agents，包括 VSCode 配置、断点技巧、日志分析和常见问题排查。

## VSCode 配置

### 配置文件 `.vscode/launch.json`

在项目根目录创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Deep Agent",
      "type": "debugpy",
      "request": "launch",
      "module": "deepagents",
      "console": "integratedTerminal",
      "env": {
        "ANTHROPIC_API_KEY": "${input:anthropicKey}",
        "OPENAI_API_KEY": "${input:openaiKey}",
        "LANGCHAIN_TRACING_V2": "true",
        "LANGCHAIN_API_KEY": "${input:langchainKey}"
      },
      "justMyCode": false
    },
    {
      "name": "Debug Current File",
      "type": "debugpy",
      "request": "launch",
      "program": "${file}",
      "console": "integratedTerminal",
      "justMyCode": false
    },
    {
      "name": "Debug Tests",
      "type": "debugpy",
      "request": "launch",
      "module": "pytest",
      "args": ["${file}", "-v"],
      "console": "integratedTerminal",
      "justMyCode": false
    }
  ],
  "inputs": [
    {
      "id": "anthropicKey",
      "type": "promptString",
      "description": "Anthropic API Key"
    },
    {
      "id": "openaiKey",
      "type": "promptString",
      "description": "OpenAI API Key"
    },
    {
      "id": "langchainKey",
      "type": "promptString",
      "description": "LangChain API Key"
    }
  ]
}
```

### 配置文件 `.vscode/settings.json`

```json
{
  "python.analysis.extraPaths": [
    "${workspaceFolder}/libs/deepagents",
    "${workspaceFolder}/libs/code"
  ],
  "python.analysis.typeCheckingMode": "basic",
  "editor.formatOnSave": true,
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff"
  },
  "python.testing.pytestEnabled": true,
  "python.testing.pytestArgs": ["libs/deepagents/tests"]
}
```

## 断点技巧

### 1. 关键断点位置

```python
# 入口函数：libs/deepagents/deepagents/graph.py
def create_deep_agent(...):
    ...  # 在这里设置断点，观察中间件组装

# 模型调用：langchain.agents.create_agent
# 追踪模型调用的入参和返回值

# 工具执行：libs/deepagents/deepagents/middleware/filesystem.py
def _create_read_file_tool(self):
    def sync_read_file(...):
        ...  # 在这里设置断点，观察工具执行

# 子代理调用：libs/deepagents/deepagents/middleware/subagents.py
def task(description: str, subagent_type: str, runtime: ToolRuntime):
    ...  # 在这里设置断点，观察子代理调用
```

### 2. 条件断点

在 VSCode 中设置条件断点：

```python
# 只在特定工具调用时断点
if tool_name == "edit_file":
    breakpoint()  # 或使用 VSCode 条件断点

# 只在特定文件操作时断点
if file_path == "/project/target.txt":
    breakpoint()

# 只在错误发生时断点
if result.error is not None:
    breakpoint()
```

### 3. 日志点（Logpoint）

使用 VSCode 日志点代替 `print`：

```python
# 不要这样
print(f"File read: {file_path}")
return content

# 使用日志点
# 右键行号 → "添加日志点"
# 输入：File read: {file_path}
```

## 日志分析

### 启用详细日志

```python
import logging

# 启用 Deep Agents 日志
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("deepagents").setLevel(logging.DEBUG)

# 启用 LangChain 日志
logging.getLogger("langchain").setLevel(logging.DEBUG)

# 启用 LangGraph 日志
logging.getLogger("langgraph").setLevel(logging.DEBUG)
```

### LangSmith 追踪

```bash
# 启用追踪
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your_key_here
export LANGCHAIN_PROJECT=deepagents-debug
```

在 LangSmith 中查看：
- 每次模型调用的输入/输出
- 每个工具调用的参数和结果
- 中间件处理的耗时
- Token 使用量

### 添加自定义日志

```python
from deepagents import create_deep_agent
import logging

logger = logging.getLogger(__name__)

class LoggingMiddleware:
    """自定义日志中间件"""

    def wrap_model_call(self, request, handler):
        logger.info(f"Model call: {len(request.messages)} messages")
        response = handler(request)
        logger.info(f"Model response: {len(response.message.content)} chars")
        return response

    def wrap_tool_call(self, request, handler):
        logger.info(f"Tool call: {request.tool_call['name']}")
        result = handler(request)
        logger.info(f"Tool result: {len(result.content)} chars")
        return result

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[LoggingMiddleware()],
)
```

## 常见问题排查

### 1. 工具调用失败

**症状**：工具返回错误信息

**排查步骤**：

```python
# 1. 检查工具输入
print(f"Tool: {tool_call['name']}")
print(f"Args: {tool_call['args']}")

# 2. 检查后端状态
result = backend.ls("/project")
print(f"Backend ls result: {result}")

# 3. 检查权限
from deepagents import FilesystemPermission

permissions = [
    FilesystemPermission(
        operations=["read"],
        paths=["/readonly/**"],
        mode="deny",
    ),
]

# 4. 直接调用后端方法
result = backend.read("/project/test.py")
if result.error:
    print(f"Error: {result.error}")
```

### 2. 子代理不执行

**症状**：`task` 工具返回错误或子代理卡住

**排查步骤**：

```python
# 1. 检查子代理是否正确注册
from deepagents import create_deep_agent, SubAgent

subagent: SubAgent = {
    "name": "researcher",
    "description": "Research agent",  # 确保描述清晰
    "system_prompt": "You are a researcher...",
    "model": "anthropic:claude-sonnet-4-6",
    "tools": [],  # 确保工具可用
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[subagent],
)

# 2. 检查 Task 工具描述
# 在 SubAgentMiddleware 初始化后检查
print(agent.builder.middleware)  # 查看中间件栈

# 3. 启用调试模式
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[subagent],
    debug=True,
)
```

### 3. 上下文溢出

**症状**：模型返回上下文长度超限错误

**排查步骤**：

```python
# 1. 检查消息长度
result = agent.invoke({"messages": "..."})
print(f"Messages count: {len(result['messages'])}")

# 2. 检查摘要中间件
# SummarizationMiddleware 应该自动处理长上下文

# 3. 检查大内容卸载
# FilesystemMiddleware 应该自动卸载大工具结果

# 4. 手动检查 Token 估算
def estimate_tokens(messages):
    total = 0
    for msg in messages:
        if isinstance(msg.content, str):
            total += len(msg.content) // 4  # 粗略估算
    return total

print(f"Estimated tokens: {estimate_tokens(result['messages'])}")
```

### 4. HITL 不工作

**症状**：`interrupt_on` 不生效

**排查步骤**：

```python
from langgraph.checkpoint.memory import MemorySaver

# 1. 确保使用 Checkpointer
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    interrupt_on={"edit_file": True},
    checkpointer=MemorySaver(),  # 必需！
)

# 2. 检查线程配置
config = {"configurable": {"thread_id": "test-thread"}}

# 3. 第一次调用
result = agent.invoke({"messages": "Edit a file"}, config=config)

# 4. 检查中断状态
if "__interrupt__" in result:
    print(f"Interrupted: {result['__interrupt__']}")

    # 5. 继续执行
    result = agent.invoke(None, config=config)
```

### 5. 权限错误

**症状**：文件操作被拒绝

**排查步骤**：

```python
# 1. 检查权限配置
from deepagents import FilesystemPermission

permissions = [
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
]

# 2. 规则是按顺序匹配的
# 第一个匹配的规则生效

# 3. 调试权限检查
from deepagents.middleware.filesystem import _check_fs_permission

result = _check_fs_permission(
    permissions,
    operation="write",
    path="/project/test.py",
)
print(f"Permission: {result}")  # "allow" 或 "deny"
```

## 性能分析

### 使用 cProfile

```python
import cProfile
import pstats

profiler = cProfile.Profile()
profiler.enable()

# 运行 Agent
result = agent.invoke({"messages": "..."})

profiler.disable()
stats = pstats.Stats(profiler)
stats.sort_stats('cumulative')
stats.print_stats(20)  # 显示前 20 个耗时函数
```

### 分析 Token 使用

```python
from langchain.callbacks import get_openai_callback

with get_openai_callback() as cb:
    result = agent.invoke({"messages": "..."})
    print(f"Total Tokens: {cb.total_tokens}")
    print(f"Prompt Tokens: {cb.prompt_tokens}")
    print(f"Completion Tokens: {cb.completion_tokens}")
    print(f"Total Cost: ${cb.total_cost}")
```

## 单元测试调试

### 运行单个测试

```bash
# 运行特定测试文件
uv run pytest libs/deepagents/tests/unit_tests/test_end_to_end.py -v

# 运行特定测试类
uv run pytest libs/deepagents/tests/unit_tests/test_end_to_end.py::TestCreateDeepAgent -v

# 运行特定测试方法
uv run pytest libs/deepagents/tests/unit_tests/test_end_to_end.py::TestCreateDeepAgent::test_basic -v

# 带调试输出
uv run pytest libs/deepagents/tests/unit_tests/test_end_to_end.py -v -s
```

### 测试覆盖率

```bash
uv run pytest libs/deepagents/tests/ --cov=deepagents --cov-report=html
# 打开 htmlcov/index.html 查看覆盖率报告
```

## 下一步

- [整体架构](/architecture/overview)：理解框架的分层设计
- [中间件系统](/architecture/middleware-system)：深入中间件的工作原理
- [create_deep_agent](/core/create-deep-agent)：入口函数的完整实现分析