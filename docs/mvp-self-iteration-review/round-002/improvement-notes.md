# MVP Review 第 2 轮改进文档

## 1. 问题

MVP 设计定义了 check 内容，但没有明确 check 通过后如何更新 `validated_commit`。

## 2. 修改建议

补充：

```text
check 失败不更新 validated_commit。
check 通过更新 .feng/state.yaml 的 validated_commit。
hatch 只能从 validated_commit 打包。
```

## 3. 为什么必须补

自迭代依赖稳定基线。

如果没有 validated marker：

```text
repair 无法确定启动基线。
hatch 可能打包未验证 candidate。
status 无法解释当前状态。
```

## 4. 不复杂化理由

这不需要新系统。

已有 `.feng/state.yaml` 和 Git 模型足够表达。
