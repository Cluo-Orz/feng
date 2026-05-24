# 第 2 轮架构修改 Review

## 1. 本轮修改

本轮在 `docs/architecture.md` 中增加：

```text
Creator Workspace 和 User Runtime
world/config/args 边界
release manifest 最小内容
```

## 2. 一致性检查

### 与核心诉求的一致性

符合。

核心诉求要求：

```text
使用者不理解 feng
release 是命名命令
密钥和机器相关配置不打进包
架构不复杂
```

新增边界让 release 后的使用者运行态更清楚：

```text
self 固化规则和能力
config 保存本地事实
args 表示单次输入
artifacts 保存运行证据
```

### 与简单架构的一致性

基本符合。

没有新增服务、数据库、插件市场或复杂环境系统。只是把 release 边界写清楚。

### 与六个 case 的一致性

能解释：

```text
coder 的目标项目路径属于 args/config
apitest 的 token 和 base URL 属于 config/args
newsbrief 的订阅源属于 config
carbrain 的设备地址和校准参数属于 config
deskhelper 的用户目录属于 config/args
ccmanage 的会话目录属于 config
```

## 3. 残余风险

### 文档长度继续增长

`architecture.md` 已超过 600 行。后续不应继续在这份文档里展开实现细节。

建议后续若需要细化：

```text
tool spec -> 独立文档
release manifest spec -> 独立文档
eval spec -> 独立文档
```

架构概念文档只保留顶层边界。

### Manifest 内容仍是概念级

当前 manifest 只列出最小字段，没有定义格式。这符合架构文档定位。暂不需要展开。

## 4. Review 结论

本轮修改可以保留。

没有发现新的逻辑冲突。下一轮建议不要继续扩展字段细节，应从整体链路上看：

```text
用户是否能从 new/teach/try/release 走通
是否仍然过度暴露内部结构
长任务状态是否足以支持 teach
```

