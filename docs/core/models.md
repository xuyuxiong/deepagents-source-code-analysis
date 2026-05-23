# 模型解析

本文档分析 Deep Agents 如何解析和处理不同 LLM 模型。

**源码路径**: `libs/deepagents/deepagents/_models.py`

## 核心函数

### resolve_model

```python
def resolve_model(model: str | BaseChatModel) -> BaseChatModel:
    """解析模型字符串为 BaseChatModel

    支持格式：
    - "anthropic:claude-sonnet-4-6"
    - "openai:gpt-4o"
    - "google:gemini-2.0-flash"
    - 已初始化的 BaseChatModel 实例
    """
    if isinstance(model, BaseChatModel):
        return model

    return init_chat_model(model, **apply_provider_profile(model))
```

### get_model_identifier

```python
def get_model_identifier(model: BaseChatModel) -> str | None:
    """提取模型标识符"""
    return _string_attr(model, "model_name") or _string_attr(model, "model")
```

### get_model_provider

```python
def get_model_provider(model: BaseChatModel) -> str | None:
    """提取 Provider 名称"""
    try:
        ls_params = model._get_ls_params()
        return ls_params.get("ls_provider")
    except (AttributeError, TypeError, NotImplementedError):
        return None
```

## Provider Profile 应用

```python
def apply_provider_profile(model_spec: str) -> dict[str, Any]:
    """应用 Provider Profile 初始化参数"""
    provider = model_spec.split(":")[0] if ":" in model_spec else None

    if provider in _PROVIDER_PROFILES:
        return _PROVIDER_PROFILES[provider].init_kwargs

    return {}

# 内置 Profiles
_PROVIDER_PROFILES = {
    "openai": ProviderProfile(
        name="openai",
        init_kwargs={"use_responses_api": True},
    ),
    "openrouter": ProviderProfile(
        name="openrouter",
        init_kwargs={"default_headers": {...}},
    ),
}
```

## 模型匹配

```python
def model_matches_spec(model: BaseChatModel, spec: str) -> bool:
    """检查模型是否匹配 spec"""
    current = get_model_identifier(model)
    if current is None:
        return False
    if spec == current:
        return True

    # 检查 model-name 部分
    _, separator, model_name = spec.partition(":")
    return bool(separator) and model_name == current
```

## 下一步

- [ProviderProfile](../architecture/profile-system.md)
- [create_deep_agent](./create-deep-agent.md)