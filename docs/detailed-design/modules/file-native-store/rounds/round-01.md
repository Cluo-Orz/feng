# File-Native Store Spec Round 01

## 当前草稿判断

初稿容易把 File-Native Store 写成 TypeScript 的 `fs` 封装：

```text
readFile。
writeFile。
listFiles。
exists。
delete。
```

这个方向太弱，无法支撑 feng 的 file-native 可信度。

## 顶层视角检测

从产品概念看，file-native 不是实现偏好，而是可信度要求：目标、材料、候选能力、运行记录、反馈、验证证据、hatch 产物和下一轮 message list 都必须可定位。

从 opencode 和 CodeWhale 的调研看，成熟系统不会让 UI、聊天历史或进程内存成为事实来源。它们会维护持久事件、投影、artifact、checkpoint、tool result 和 replay 边界。

因此 File-Native Store 不能只是 fs wrapper。它必须是所有文件事实的安全底座。

## 问题

```text
1. 只封装 fs 会遗漏工作区边界，容易产生路径逃逸。
2. 没有原子写，崩溃会制造半写文件。
3. 没有内容摘要和收据，后续 Event Ledger 和 Artifact Registry 难以证明读写了什么。
4. 没有大文件保护，Context Compiler 可能把巨大文件误读进内存或上下文。
5. 如果 File Store 理解 grow/feedback/hatch 语义，会和上层模块纠缠。
```

## 调整

File-Native Store 应定位为：

```text
工作区内安全文件定位。
路径规范化和 containment。
文本/二进制读写。
原子写和读写收据。
内容摘要。
受限目录遍历。
大文件分页读取。
```

它不负责：

```text
事件语义。
artifact 生命周期。
grow 状态。
message list 编译。
feedback 采纳。
hatch 打包。
```

## 进入下一轮的结论

Round 02 需要补充路径模型、读写 port、收据和不变量，并处理 File Store 与 Policy、Artifact、Event Ledger 的边界。
