# CLI Spec Round 02

## 当前草稿判断

第二版草稿已经避免命令手册化，但 CLI 仍有一个风险：它可能被写成“什么都知道、什么都做”的业务中枢。

如果 CLI 直接写文件、拼 message list、判断 readiness、复制 grow 目录或改 feedback status，它就绕开了前面 19 个模块。

## 顶层视角检测

CLI 的合理定位是：

```text
解析用户意图。
定位 workspace。
调用模块 port。
展示可解释结果。
处理 approval 入口。
```

业务事实仍由模块拥有：

```text
Grow Unit Manager 拥有 lifecycle。
Admission 拥有输入和反馈状态。
Context Compiler 拥有 compiled_message_list。
Evidence & Readiness 拥有 readiness verdict。
Hatch Builder 拥有 hatch_package。
Agent Runtime Kernel 拥有 runtime_message_list 和 runtime trace。
Debug Bridge 拥有 bridge packet。
Policy 拥有 decision、approval 和 grant。
```

## 问题

CLI 不能：

```text
直接追加业务事件。
直接写 .feng 文件。
把命令历史当 grow 记忆。
把用户输入拼进下一轮 prompt。
把 status/explain 做成会改变状态的命令。
把 approval 当作动作执行结果。
```

## 调整

最终 spec 补充：

```text
Grow Command Boundary。
Hatch Command Boundary。
Runtime Command Boundary。
Debug and Feedback Command Boundary。
Policy Approval Boundary。
Explain Boundary。
```

每个边界都写清楚 CLI 只能调用哪个模块，不能拥有哪个事实。

## 进入下一轮的结论

下一轮重点检查长程任务恢复、非 LLM hatch 产物、debug feedback 和机器可读输出是否破坏边界。

