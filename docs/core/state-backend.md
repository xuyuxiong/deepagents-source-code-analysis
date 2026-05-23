# StateBackend

StateBackend 将文件存储在 LangGraph Agent State 中，是 Deep Agents 的默认后端。

**源码路径**: `libs/deepagents/deepagents/backends/state.py`

## 特点

- 文件存储在 Agent State 中（临时、会话级）
- 状态自动 Checkpoint
- 通过 `CONFIG_KEY_READ` / `CONFIG_KEY_SEND` 访问 LangGraph 内部通道
- 不支持命令执行

## 初始化

```python
class StateBackend(BackendProtocol):
    def __init__(
        self,
        runtime: object = None,  # 已弃用
        *,
        file_format: FileFormat = "v2",
    ):
        self._file_format = file_format
```

## 状态访问

```python
def _get_config(self) -> RunnableConfig:
    """获取 LangGraph 配置"""
    try:
        config = get_config()
    except RuntimeError:
        raise RuntimeError(
            "StateBackend must be used inside a LangGraph graph execution"
        )

    configurable = config.get("configurable", {})
    if CONFIG_KEY_READ not in configurable:
        raise RuntimeError("CONFIG_KEY_READ / CONFIG_KEY_SEND not found")

    return config

def _read_files(self) -> dict[str, Any]:
    """读取 files 通道"""
    config = self._get_config()
    read = config["configurable"][CONFIG_KEY_READ]
    return read("files", fresh=True) or {}

def _send_files_update(self, update: dict[str, Any]) -> None:
    """发送 files 更新"""
    config = self._get_config()
    send = config["configurable"][CONFIG_KEY_SEND]
    send([("files", update)])
```

## 文件操作实现

### read

```python
def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
    """读取文件"""
    files = self._read_files()
    file_data = files.get(file_path)

    if file_data is None:
        return ReadResult(error=f"File '{file_path}' not found")

    if _get_file_type(file_path) != "text":
        return ReadResult(file_data=file_data)

    # 分页读取
    sliced = slice_read_response(file_data, offset, limit)
    ...
```

### write

```python
def write(self, file_path: str, content: str) -> WriteResult:
    """写入新文件"""
    files = self._read_files()

    if file_path in files:
        return WriteResult(error=f"File '{file_path}' already exists")

    new_file_data = create_file_data(content)
    self._send_files_update({file_path: self._prepare_for_storage(new_file_data)})

    return WriteResult(path=file_path)
```

### edit

```python
def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
    """编辑文件"""
    files = self._read_files()
    file_data = files.get(file_path)

    if file_data is None:
        return EditResult(error=f"File '{file_path}' not found")

    content = file_data_to_string(file_data)
    result = perform_string_replacement(content, old_string, new_string, replace_all)

    if isinstance(result, str):
        return EditResult(error=result)

    new_content, occurrences = result
    new_file_data = update_file_data(file_data, new_content)
    self._send_files_update({file_path: self._prepare_for_storage(new_file_data)})

    return EditResult(path=file_path, occurrences=int(occurrences))
```

## 使用示例

```python
from deepagents import create_deep_agent
from deepagents.backends import StateBackend

# StateBackend 是默认后端
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=StateBackend(),
)

# 预填充文件
result = agent.invoke({
    "messages": "Read the file",
    "files": {
        "/hello.txt": {
            "content": "Hello World",
            "encoding": "utf-8",
        }
    }
})
```

## 限制

- 不支持命令执行（没有 `execute` 方法）
- 文件随会话结束而消失
- 大量文件可能影响状态大小

## 下一步

- [FilesystemBackend](./filesystem-backend.md)
- [BackendProtocol](./backend-protocol.md)