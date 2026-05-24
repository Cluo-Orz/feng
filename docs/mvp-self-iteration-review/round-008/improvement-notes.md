# MVP Review 第 8 轮改进文档

## 1. 补齐 baseline eval

新增到设计：

```text
evals/schema.yaml
evals/permission-boundary.yaml
evals/no-secret.yaml
```

与已有：

```text
evals/load-self.yaml
evals/llm-provider-boundary.yaml
```

共同形成 MVP baseline check。

## 2. 项目 eval 不再默认存在

改成：

```text
candidate 声明的项目业务 eval 能运行；如果还没有业务 eval，不因此失败。
```

## 3. active tool pack

明确：

```text
没有 skill 时，由 seed loop 选择最小必要工具。
```

这避免每轮暴露所有工具。
