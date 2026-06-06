# Hatch Builder Spec Round 01

## 当前草稿判断

第一版草稿容易把 hatch 写成：

```text
ready_to_hatch 后复制 grow 目录。
加一个入口命令。
输出为交付物。
```

这个方案必须拒绝。grow 目录是成长事实库，里面有失败尝试、临时上下文、调试 trace、私有材料和未采纳候选；它不是交付物。

## 顶层视角检测

可复制不是复制文件夹，而是从成长事实中提取稳定能力：

```text
被验证的候选能力。
locked runtime contract。
必要资源和依赖。
版本边界。
验证证据摘要。
debug 和 feedback 能力。
发布排除清单。
回滚目标。
```

如果 Hatch Builder 只是复制目录，feng 会失去隐私边界、版本边界和能力边界。

## 问题

```text
grow 目录可能包含 secret。
grow 目录包含未采纳候选和失败尝试。
message list 是 grow 过程产物，不等于 runtime 能力。
attempt trace 可能含私有内容。
tool_result 不一定是稳定资源。
```

## 调整

将模块定位改为：

```text
从 grow 单元提取稳定能力并构建可复制 hatch package 的 owning module。
```

补入：

```text
HatchRequest
HatchBuildPlan
HatchResourceSelection
HatchExclusionRecord
HatchPackageManifest
HatchPackageRecord
HatchBuildReceipt
```

## 进入下一轮的结论

Hatch Builder 不能复制 grow 目录。下一轮要检测它是否只是把 prompt 和少量文件包起来，退化成 prompt wrapper。

