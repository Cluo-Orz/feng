# LLM Provider 调研第 3 轮报告

## 1. 本轮目标

检查 DeepSeek 配置文件层是否清楚。

用户明确要求三层：

```text
feng 的 llm 调用层
两个厂商的协议层
deepseek 的配置文件
```

第 2 轮后，前两层已比较清楚，但 DeepSeek 配置文件边界仍需要更明确。

## 2. 发现的问题

主文档虽然有 DeepSeek YAML 片段，但没有明确：

```text
配置文件放在哪
self repo 能不能保存 provider 配置
API key 是否会进入 hatch package
使用者如何在另一台机器配置 DeepSeek
```

## 3. 已补充内容

主文档新增：

```text
5.4.1 Provider 配置文件位置
5.4.2 DeepSeek 示例配置文件
```

并新增示例文件：

```text
docs/llm-provider-research/deepseek.provider.example.yaml
```

## 4. 配置边界

最终边界：

```text
self repo
  只引用 provider/model。
  可以写 provider requirement。
  不能保存 API key。

本机 provider profile
  保存 base_url、protocol、api_key_env、capabilities。
  不提交。

release package
  包含 config.schema.yaml，引导使用者设置环境变量。
  不包含真实 key。
```

## 5. 本轮结论

三层模型现在完整：

```text
Feng LLM 调用层
  provider-neutral。

OpenAI / Anthropic 协议层
  adapter 编译。

DeepSeek 配置文件层
  本机 provider profile + env key。
```

下一轮只需要做最终 coverage check。
