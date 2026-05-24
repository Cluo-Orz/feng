# MVP Review 第 2 轮推演报告

## 1. 本轮目标

检查 MVP 的 `check` 是否足够支撑自迭代。

如果 `check` 太弱，feng 可能把坏 candidate promote 成 validated commit，自迭代会失去稳定基线。

## 2. 当前设计

当前 MVP check 包含：

```text
self repo 能加载
YAML/Markdown schema 能解析
hooks.yaml 能解析
permissions.yaml 能解析
tools 能加载
active tool pack 能生成
message compiler 能编译
provider profile 能解析，但不要求真实调用
evals 能运行
禁止特殊 runtime 检查通过
case-first review 检查通过
```

自迭代额外检查：

```text
没有 fengsmith
没有 if project == feng
没有真实 API key
没有默认 push / reset / delete history
```

## 3. 发现的缺口

当前 check 还缺一个关键动作：

```text
check 通过后如何更新 validated commit。
```

文档有 Git 模型，但 MVP check 章节没有明确：

```text
check 失败：不得更新 validated commit。
check 通过：写入 validated marker，并可以提交 Git checkpoint。
validated marker 位置在哪里。
```

## 4. 风险

如果不定义 validated marker：

```text
grow 失败后不知道从哪里恢复。
hatch 不知道应该打包哪个 commit。
status 不知道 candidate 与 validated 的差异。
```

## 5. 建议

在 MVP 设计中补充：

```text
.feng/state.yaml 记录 validated_commit。
check 通过后更新 validated_commit。
check 失败时只写 check report，不更新 validated_commit。
hatch 只能从 validated_commit 打包。
```

这仍是通用逻辑，不是 feng 专用逻辑。
