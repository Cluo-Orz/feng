# LLM Gateway Spec Round 01

## 当前草稿判断

第一版容易写成 provider SDK 薄包装：

```text
传入 messages。
调用某个 provider。
返回 text。
```

这不足以支撑 feng。feng 需要长程 grow 的可恢复、可审计执行链路，provider 响应、streaming、tool call block、错误和能力差异都必须归一化。

## 顶层视角检测

顶层模块设计要求 LLM Gateway 拥有：

```text
LLM request/response adapter。
provider/model 选择结果。
streaming event normalization。
tool call block normalization。
错误分类、重试、fallback 策略的底层执行。
```

同时它不拥有 prompt 语义、grow 目标、工具权限或 readiness。

## 问题

薄包装会带来：

```text
provider 差异泄漏到 Grow Attempt Runner。
streaming 与非 streaming 输出无法统一追踪。
tool call block 无法稳定交给 Tool Runtime。
错误只能作为自然语言或异常传播，无法重试、归因和写 trace。
```

## 调整

第二版改为 gateway：

```text
输入 provider-neutral message list 和 request options。
输出 normalized response 或 normalized stream events。
维护 ModelCapabilitySummary。
生成 ProviderCallReceipt。
把错误归一化为 DomainError。
```

## 进入下一轮的结论

下一轮需要检查：

```text
Gateway 是否越权选择 prompt 内容。
Gateway 是否越权判断工具权限。
Gateway 是否把 provider/model catalog 做成产品中心。
Gateway 如何处理 policy 和 credentials 边界。
```
