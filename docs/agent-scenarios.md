# Agent Scenarios

这些场景用于检查架构是否过拟合。所有场景都必须使用同一套模型：

```text
runtime command
current directory instance root
workspace files
optional hatch package self
```

共同成长链路：

```text
raw world intake
-> .实例/world 当前理解
-> .实例/tools 感知或行动
-> .实例/evals 验证目标
-> .实例/skills 复用能力
-> hatch package self
```

## 1. Coding Agent

创造者：

```text
cd coder-dev
feng grow "孵化一个代码修改和 review agent"
feng hatch --name coder --portable
```

使用者：

```text
cd project
coder "修复 failing tests"
```

目录：

```text
project/
  .coder/
    state.yaml
    artifacts/
    history/
  src/
  tests/
```

`coder` 的稳定能力在安装包 `self/skills`、`self/tools`、`self/world` 中。项目目录只保存运行态和产物。

## 2. API Testing Agent

使用者：

```text
cd api-project
apitest "为登录接口生成 smoke test"
```

`self/world` 保存稳定 API 测试方法和 schema 解释规则；本机 token、base URL 和环境名进入 `.apitest/config.yaml` 或 env。完整响应、测试日志和 diff 进入 `.apitest/artifacts`。

intake 可以是 OpenAPI、curl 示例或自然语言。只有当 feng 长出 HTTP tool、认证边界和 smoke eval 后，API 测试能力才算稳定。

## 3. News Summary Agent

使用者：

```text
cd news-workspace
newsbrief "汇总今天 AI 新闻"
```

网页正文、RSS 内容和去重报告写 artifact。message 只保留来源、时间、hash、summary 和 why_relevant。

## 4. Robot Car Agent

运行目录是小车控制 workspace：

```text
car-runtime/
  .carbrain/
  sensor-config.yaml
```

传感器、电机和安全边界进入 packaged `self/world` 和 `self/tools`。设备地址、校准参数和本机密钥进入 `.carbrain/config.yaml`。高风险动作必须由 permissions 和 evals 约束。

intake 可以是设备 SDK、串口协议、用户描述或传感器日志。feng 不能因为读懂说明就直接控制小车；必须先长出受权限约束的 sensor/motor tools 和安全 eval。

## 5. Windows Desktop Assistant

使用者：

```text
cd C:\Users\me\Downloads
deskhelper "整理下载目录，先 dry-run"
```

`.deskhelper` 保存运行报告和 dry-run artifact。真实文件修改必须受 permissions 和确认策略约束。

## 6. Claude Code Session Manager

使用者：

```text
cd project
ccmanage "总结最近一次 Claude Code 会话并生成 handoff"
```

长会话日志、diff 和 transcript 不进 prompt，进入 artifacts。稳定的 handoff 格式和 review 规则在 packaged self 中。

## 7. Feng Self-Iteration

在 feng 源码仓库：

```text
cd feng
feng grow "改进 feng 自己"
```

目录：

```text
feng/
  cmd/
  internal/
  docs/
  .feng/
    skills/iterate-feng.md
    tools/go-test.tool.yaml
    prompts/
    messages/
    world/
    evals/
    artifacts/
    history/
```

`cmd/internal/docs` 是被迭代对象，`.feng` 是负责迭代的实例。这个场景不能依赖 Codex 手动串联每轮 check/hatch。

intake 可以是用户新诉求、失败测试、架构文档或实现 diff。feng 必须把它沉淀成 runtime world、迭代 skill、Go/check/hatch tools 和 portable smoke eval。

## 共同验收

```text
1. 用户项目根目录不散落 feng 的 skills/tools/world。
2. 产品命令使用安装包 self，用户目录只写 .产品名 运行态。
3. 长内容 artifact 化。
4. 工具经过 permissions。
5. message list 可观察且 token-efficient。
6. 失败进入 artifacts/history，下一轮可修复。
7. 没有为某个场景写 runtime 特殊分支。
8. raw intake 不直接等同于稳定能力，必须经过 world/tools/evals/skills 沉淀。
```
