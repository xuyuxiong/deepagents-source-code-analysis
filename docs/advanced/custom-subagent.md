# 自定义子代理

本文档介绍如何创建和配置自定义子代理来扩展 Deep Agents 的能力。

## 子代理类型

Deep Agents 支持两种子代理类型：

```python
from deepagents.subagents import SubAgent, CompiledSubAgent

# 类型 1: 配置式子代理
subagent = SubAgent(
    name="researcher",
    description="Conducts web research",
    model="anthropic:claude-sonnet-4-6",
    tools=["web_search", "read_file"],
)

# 类型 2: 编译式子代理
from langgraph.graph import StateGraph

graph = StateGraph(AgentState)
# 构建代理图...
compiled = graph.compile()
subagent = CompiledSubAgent(
    name="analyzer",
    description="Analyzes data",
    graph=compiled,
)
```

## SubAgent 配置

```python
class SubAgent(TypedDict):
    name: str  # 子代理名称（用于 task 工具）
    description: str  # 描述（用于系统提示）
    model: str | BaseChatModel  # 使用的模型
    tools: list[str] | None  # 可用工具列表
    middleware: list[AgentMiddleware] | None  # 中间件
    system_prompt: str | None  # 系统提示
    max_iterations: int | None  # 最大迭代次数
```

### 创建配置式子代理

```python
from deepagents.subagents import SubAgent

# 研究代理
research_subagent = SubAgent(
    name="researcher",
    description="Conducts thorough web research on a given topic",
    model="anthropic:claude-sonnet-4-6",
    tools=["web_search", "read_file", "grep"],
    system_prompt="""You are a research specialist.

Your responsibilities:
1. Search for information on the given topic
2. Extract key findings from multiple sources
3. Synthesize a comprehensive summary
4. Cite your sources

Always be thorough and accurate.""",
    max_iterations=10,
)

# 代码审查代理
code_review_subagent = SubAgent(
    name="code_reviewer",
    description="Reviews code for quality, security, and best practices",
    model="anthropic:claude-sonnet-4-6",
    tools=["read_file", "glob", "grep"],
    middleware=[
        # 自定义中间件
        ReviewValidationMiddleware(),
    ],
)
```

## CompiledSubAgent 配置

```python
class CompiledSubAgent(TypedDict):
    name: str  # 子代理名称
    description: str  # 描述
    graph: CompiledGraph  # 编译后的 LangGraph 图
```

### 创建编译式子代理

```python
from langgraph.graph import StateGraph, MessagesState
from langgraph.prebuilt import ToolNode

def build_analyzer_subagent():
    """构建数据分析子代理"""

    # 定义状态
    class AnalyzerState(MessagesState):
        data: dict
        results: list

    # 定义节点
    def analyze_node(state: AnalyzerState):
        # 分析逻辑
        return {"results": [...]}

    def summarize_node(state: AnalyzerState):
        # 总结逻辑
        return {"messages": [...]}

    # 构建图
    graph = StateGraph(AnalyzerState)
    graph.add_node("analyze", analyze_node)
    graph.add_node("summarize", summarize_node)
    graph.set_entry_point("analyze")
    graph.add_edge("analyze", "summarize")
    graph.set_finish_point("summarize")

    return CompiledSubAgent(
        name="data_analyzer",
        description="Analyzes data and produces insights",
        graph=graph.compile(),
    )
```

## 注册子代理

### 在 create_deep_agent 中注册

```python
from deepagents import create_deep_agent
from deepagents.subagents import SubAgent

# 定义子代理
researcher = SubAgent(
    name="researcher",
    description="Conducts research on given topics",
    model="anthropic:claude-sonnet-4-6",
    tools=["web_search"],
)

code_reviewer = SubAgent(
    name="code_reviewer",
    description="Reviews code for quality and security",
    model="anthropic:claude-sonnet-4-6",
    tools=["read_file", "grep"],
)

# 创建主代理
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    subagents=[researcher, code_reviewer],
)
```

### 运行时动态添加

```python
# 子代理通过 SubAgentMiddleware 自动注册
# 可以后续通过状态添加新子代理
```

## task 工具

子代理通过 `task` 工具被调用：

```
<tool_calls>
<invoke name="task">
<parameter name="description">Research the latest developments in quantum computing</parameter>
<parameter name="subagent_type">researcher</parameter>
</invoke>
</tool_calls>
```

### task 工具实现

```python
def task(description: str, subagent_type: str, runtime: ToolRuntime) -> str | Command:
    """调用子代理执行任务"""

    # 1. 验证子代理
    if subagent_type not in subagent_graphs:
        return f"Unknown subagent type. Allowed: {list(subagent_graphs.keys())}"

    # 2. 准备子代理状态
    subagent_state = {
        k: v for k, v in runtime.state.items()
        if k not in _EXCLUDED_STATE_KEYS
    }
    subagent_state["messages"] = [HumanMessage(content=description)]

    # 3. 调用子代理
    result = subagent.invoke(subagent_state, subagent_config)

    # 4. 返回结果
    return _return_command_with_state_update(result, runtime.tool_call_id)
```

## 状态隔离

子代理状态与主代理隔离：

```python
_EXCLUDED_STATE_KEYS = {
    "messages",  # 由任务描述替代
    "todos",  # 不传递
    "structured_response",  # 不传递
    "skills_metadata",  # 重新加载
    "skills_load_errors",  # 重新加载
    "memory_contents",  # 重新加载
}
```

## 子代理通信

### 输入

```python
# 通过 description 参数传递任务
task(
    description="Research quantum computing advancements in 2024",
    subagent_type="researcher",
)
```

### 输出

```python
# 子代理返回 Command，更新主代理状态
return Command(
    update={
        "messages": [AIMessage(content=result)],
        # 可选：更新其他状态字段
    }
)
```

## 异步子代理

异步子代理可以并行执行：

```python
from deepagents.middleware.async_subagents import AsyncSubAgentMiddleware

# 定义异步子代理
async_researcher = SubAgent(
    name="async_researcher",
    description="Asynchronously researches topics",
    model="anthropic:claude-sonnet-4-6",
    tools=["web_search"],
)

# 使用异步中间件
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[
        AsyncSubAgentMiddleware(subagents=[async_researcher]),
    ],
)
```

## 子代理模板

### 代码生成代理

```python
code_generator = SubAgent(
    name="code_generator",
    description="Generates code based on specifications",
    model="anthropic:claude-sonnet-4-6",
    tools=["write_file", "edit_file", "read_file"],
    system_prompt="""You are a code generation specialist.

Your responsibilities:
1. Understand the specification
2. Generate clean, well-documented code
3. Follow the project's coding standards
4. Include appropriate error handling

Always write production-ready code.""",
)
```

### 测试代理

```python
test_agent = SubAgent(
    name="tester",
    description="Tests code and reports issues",
    model="anthropic:claude-sonnet-4-6",
    tools=["read_file", "execute", "grep"],
    system_prompt="""You are a testing specialist.

Your responsibilities:
1. Read and understand the code
2. Write comprehensive test cases
3. Execute tests and analyze results
4. Report any issues found

Ensure full test coverage.""",
)
```

### 文档代理

```python
doc_agent = SubAgent(
    name="documenter",
    description="Creates and updates documentation",
    model="anthropic:claude-sonnet-4-6",
    tools=["read_file", "write_file", "edit_file"],
    system_prompt="""You are a documentation specialist.

Your responsibilities:
1. Analyze code to understand functionality
2. Write clear, comprehensive documentation
3. Include examples and usage instructions
4. Keep documentation up to date

Write for both beginners and advanced users.""",
)
```

## 最佳实践

### 1. 明确职责

```python
# ❌ 太宽泛
general_agent = SubAgent(
    name="helper",
    description="Helps with various tasks",
)

# ✅ 职责明确
research_agent = SubAgent(
    name="researcher",
    description="Conducts web research and synthesizes findings",
)
```

### 2. 限制工具

```python
# ❌ 工具过多
subagent = SubAgent(
    name="researcher",
    tools=["web_search", "read_file", "write_file", "edit_file", "execute"],
)

# ✅ 只提供必要工具
subagent = SubAgent(
    name="researcher",
    tools=["web_search", "read_file"],  # 只读工具
)
```

### 3. 合理设置最大迭代

```python
# ❌ 可能无限循环
subagent = SubAgent(
    name="researcher",
    max_iterations=None,  # 无限制
)

# ✅ 限制迭代次数
subagent = SubAgent(
    name="researcher",
    max_iterations=10,  # 合理限制
)
```

### 4. 状态共享

```python
# 子代理可以通过状态共享信息
def custom_subagent(state):
    # 读取主代理状态
    context = state.get("project_context")

    # 返回更新的状态
    return Command(update={
        "research_findings": findings,  # 暴露给主代理
    })
```

## 示例：多代理协作

```python
from deepagents import create_deep_agent
from deepagents.subagents import SubAgent

# 定义专业化子代理
researcher = SubAgent(
    name="researcher",
    description="Gathers information from the web",
    model="anthropic:claude-sonnet-4-6",
    tools=["web_search"],
    max_iterations=5,
)

analyzer = SubAgent(
    name="analyzer",
    description="Analyzes data and produces insights",
    model="anthropic:claude-sonnet-4-6",
    tools=["read_file", "grep"],
    max_iterations=10,
)

writer = SubAgent(
    name="writer",
    description="Writes clear, well-structured content",
    model="anthropic:claude-sonnet-4-6",
    tools=["write_file", "edit_file"],
    max_iterations=5,
)

# 创建协调代理
coordinator = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    subagents=[researcher, analyzer, writer],
)

# 主代理可以协调子代理：
# 1. 调用 researcher 收集信息
# 2. 调用 analyzer 分析数据
# 3. 调用 writer 生成报告
```

## 下一步

- [SubAgentMiddleware](../core/subagent-middleware.md) - 子代理中间件
- [AsyncSubAgentMiddleware](../core/async-subagent.md) - 异步子代理
- [Best Practices](./best-practices.md) - 最佳实践