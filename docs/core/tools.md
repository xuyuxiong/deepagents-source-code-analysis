# 工具系统

Deep Agents 通过工具系统扩展 Agent 能力，提供文件操作、搜索、执行等核心功能。

**源码路径**: `libs/deepagents/deepagents/middleware/filesystem.py`

工具由 FilesystemMiddleware 提供，而非独立的 tools 目录。

## 工具概览

### FilesystemMiddleware 提供的工具

- `ls` - 列出目录内容
- `read_file` - 读取文件
- `write_file` - 写入新文件
- `edit_file` - 编辑文件
- `glob` - Glob 模式匹配
- `grep` - 文本搜索
- `execute` - 执行 Shell 命令（需要 SandboxBackend）

## ls 工具

列出目录内容：

```python
def ls(path: str, runtime: ToolRuntime) -> str:
    """列出目录内容"""
```

**使用示例**:

```
列出 /workspace 目录:
ls(path="/workspace")

返回格式:
- /workspace/src/ (directory)
- /workspace/README.md (file, 1024 bytes, modified 2024-01-15)
- /workspace/config.yaml (file, 512 bytes, modified 2024-01-14)
```

## read_file 工具

读取文件内容，自动添加行号：

```python
def read_file(
    file_path: str,
    offset: int = 0,
    limit: int = 2000,
    runtime: ToolRuntime,
) -> str:
    """读取文件内容"""
```

**参数**:
- `file_path`: 文件路径
- `offset`: 起始行号（从 0 开始）
- `limit`: 读取行数

**使用示例**:

```
读取文件:
read_file(file_path="/src/main.py")

分页读取:
read_file(file_path="/src/large.py", offset=100, limit=50)
```

**输出格式**:

```
     1 | def main():
     2 |     print("Hello, World!")
     3 |
     4 | if __name__ == "__main__":
     5 |     main()
```

## write_file 工具

创建新文件：

```python
def write_file(
    file_path: str,
    content: str,
    runtime: ToolRuntime,
) -> str:
    """写入新文件"""
```

**注意**: 如果文件已存在，返回错误。

**使用示例**:

```
创建新文件:
write_file(
    file_path="/src/new.py",
    content="# New module\n\ndef hello():\n    print('Hello')\n"
)
```

## edit_file 工具

编辑现有文件，精确字符串替换：

```python
def edit_file(
    file_path: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
    runtime: ToolRuntime,
) -> str:
    """编辑文件"""
```

**参数**:
- `old_string`: 要替换的字符串（必须精确匹配）
- `new_string`: 替换后的字符串
- `replace_all`: 是否替换所有匹配项

**使用示例**:

```
单次替换:
edit_file(
    file_path="/src/main.py",
    old_string="print('Hello')",
    new_string="print('Hello, World!')",
)

替换所有:
edit_file(
    file_path="/src/main.py",
    old_string="old_name",
    new_string="new_name",
    replace_all=true,
)
```

**错误处理**:
- 文件不存在：返回错误
- `old_string` 不唯一且未设置 `replace_all`：返回错误
- `old_string` 未找到：返回错误

## glob 工具

Glob 模式匹配文件：

```python
def glob(
    pattern: str,
    path: str = "/",
    runtime: ToolRuntime,
) -> str:
    """匹配文件"""
```

**模式语法**:
- `*` - 匹配任意字符（不包括 `/`）
- `**` - 递归匹配目录
- `?` - 匹配单个字符
- `[abc]` - 匹配字符集合

**使用示例**:

```
匹配所有 Python 文件:
glob(pattern="**/*.py")

匹配特定目录:
glob(pattern="docs/*.md", path="/workspace")

匹配测试文件:
glob(pattern="**/test_*.py")
```

## grep 工具

文本搜索（精确字符串匹配，非正则）：

```python
def grep(
    pattern: str,
    path: str = "",
    glob: str = "",
    output_mode: str = "content",
    context: int = 0,
    runtime: ToolRuntime,
) -> str:
    """搜索文本"""
```

**参数**:
- `pattern`: 搜索文本（非正则表达式）
- `path`: 搜索路径
- `glob`: 文件过滤模式
- `output_mode`: 输出模式（content/content_with_context/files_with_matches/head_limit）
- `context`: 上下文行数

**使用示例**:

```
搜索所有文件:
grep(pattern="TODO")

在特定目录搜索:
grep(pattern="error", path="/src")

过滤文件类型:
grep(pattern="import", glob="*.py")

显示上下文:
grep(pattern="function", context=3)
```

## execute 工具

执行 Shell 命令（需要 SandboxBackend）：

```python
def execute(
    command: str,
    timeout: int | None = None,
    runtime: ToolRuntime,
) -> str:
    """执行命令"""
```

**注意**: 需要后端实现 `SandboxBackendProtocol`。

**使用示例**:

```
执行命令:
execute(command="npm test")

带超时:
execute(command="python train.py", timeout=300)
```

## 工具执行流程

```
1. Agent 决定调用工具
   ↓
2. FilesystemMiddleware.wrap_tool_call
   - 验证工具名称
   - 解析参数
   ↓
3. 后端执行
   - ls/read/write/edit/grep/glob/execute
   ↓
4. 格式化结果
   - 添加元数据
   - 处理错误
   ↓
5. 返回给 Agent
```

## 工具排除

可以通过配置排除特定工具：

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    exclude_tools=["execute"],  # 禁用命令执行
)
```

## 自定义工具

### 添加新工具

通过中间件添加自定义工具：

```python
from langchain_core.tools import StructuredTool
from deepagents.middleware import FilesystemMiddleware

class CustomToolsMiddleware(FilesystemMiddleware):
    def __init__(self, backend: BackendProtocol, **kwargs):
        super().__init__(backend=backend, **kwargs)
        self.tools = [
            *super().tools,
            self._create_custom_tool(),
        ]

    def _create_custom_tool(self) -> StructuredTool:
        from pydantic import BaseModel

        class CustomInput(BaseModel):
            param: str

        def custom_function(param: str, runtime: ToolRuntime) -> str:
            # 访问运行时状态
            thread_id = runtime.state.get("thread_id")
            return f"Processed {param} for thread {thread_id}"

        return StructuredTool.from_function(
            name="custom_tool",
            description="Custom tool description",
            func=custom_function,
            args_schema=CustomInput,
        )
```

### 工具运行时

`ToolRuntime` 提供工具执行上下文：

```python
class ToolRuntime:
    state: dict  # 当前状态
    context: Any  # 上下文
    stream_writer: StreamWriter  # 流式写入器
    store: BaseStore  # 持久化存储
    config: RunnableConfig  # 运行配置
    tool_call_id: str | None  # 工具调用 ID
```

## 最佳实践

### 1. 使用 glob 预过滤

```
# ❌ 慢：搜索所有文件
grep(pattern="function")

# ✅ 快：只搜索 Python 文件
grep(pattern="function", glob="*.py")
```

### 2. 分页读取大文件

```
# ❌ 可能超限
read_file(file_path="/large/log.txt")

# ✅ 分页读取
read_file(file_path="/large/log.txt", offset=0, limit=100)
read_file(file_path="/large/log.txt", offset=100, limit=100)
```

### 3. 精确匹配编辑

```
# ❌ 可能匹配多个
edit_file(
    file_path="/file.py",
    old_string="x = 1",  # 可能在多处出现
    new_string="x = 2",
)

# ✅ 包含上下文
edit_file(
    file_path="/file.py",
    old_string="def init():\n    x = 1\n    return x",
    new_string="def init():\n    x = 2\n    return x",
)
```

## 下一步

- [FilesystemMiddleware](./filesystem-middleware.md) - 文件系统中间件
- [BackendProtocol](./backend-protocol.md) - 后端协议
- [Custom Middleware](../advanced/custom-middleware.md) - 自定义中间件