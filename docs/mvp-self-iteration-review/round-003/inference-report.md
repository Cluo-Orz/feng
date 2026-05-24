# MVP Review 第 3 轮推演报告

## 1. 本轮目标

检查 MVP hatch 产物是否能在另一台机器运行，同时不携带 secret 或本机状态。

## 2. 当前设计

Hatch 输出：

```text
dist/feng/
  feng
  feng.ps1
  runner/
  self/
  feng-release.yaml
  checksums.json
```

不包含：

```text
API key
本机 provider profile
.feng/runs
.feng/cache
未通过 check 的 candidate
```

## 3. 发现的缺口

当前文档写了 `required_provider_profiles` 和 `required_env`，但没有明确首次运行的行为：

```text
如果缺少 provider profile，应该如何创建。
如果缺少 DEEPSEEK_API_KEY，应该如何提示。
是否允许 hatch package 带 provider example。
```

## 4. 建议

补充 hatch package 中可以包含：

```text
provider example
config.schema.yaml
```

但只能包含占位，不包含真实 key。

首次运行：

```text
检查 provider profile 是否存在。
检查 required_env 是否存在。
缺失则 status 显示 missing_config。
grow 不启动 LLM。
提供配置路径和环境变量名。
```

## 5. 判断

这是通用配置引导，不是 feng 自举专用逻辑。
