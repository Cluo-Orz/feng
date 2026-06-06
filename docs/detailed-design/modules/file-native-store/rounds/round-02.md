# File-Native Store Spec Round 02

## 当前草稿判断

第二轮草稿把 File-Native Store 定义为安全文件底座：

```text
WorkspaceHandle。
LogicalPath。
ResolvedPath。
FileStat。
ContentHash。
ReadReceipt。
WriteReceipt。
AtomicWrite。
DirectoryListing。
```

## 顶层视角检测

从顶层模块设计看，File-Native Store 属于 Foundation。它必须足够稳定，但不能吞掉 Policy、Event Ledger、Artifact Registry 的职责。

关键边界：

```text
Policy & Capability Boundary 判断“是否允许”。
File-Native Store 判断“路径是否结构上安全、读写是否原子可靠”。
Event Ledger 记录“业务事实发生了什么”。
Artifact Registry 管理“这个内容作为 artifact 的语义和生命周期”。
```

## 问题

```text
1. 如果 File Store 直接调用 Policy，会形成基础模块依赖环。
2. 如果 File Store 直接追加业务事件，会替代 Event Ledger。
3. 如果 File Store 给每个文件赋 artifact 类型，会替代 Artifact Registry。
4. 如果 File Store 暴露真实绝对路径给所有模块，会削弱 workspace boundary。
```

## 调整

File-Native Store 的终态边界应是：

```text
它强制执行不可协商的结构安全：路径规范化、工作区 containment、拒绝 path traversal、拒绝 symlink escape。
它不做业务授权。调用方在需要时先通过 Policy 模块拿到允许结果。
它返回读写收据，供 Event Ledger 或 Artifact Registry 引用。
它不定义 artifact 类型，只返回 file metadata 和 content hash。
它尽量使用 logical path 和 refs，不把绝对路径扩散到业务模块。
```

## 进入下一轮的结论

Round 03 需要确认 spec 中的 port 和不变量既能支撑后续 Event Ledger/Artifact，又不会提前规定 feng 的目录 schema。
