# 第 18 轮推演报告

## 1. 本轮目的

第 17 轮删除了预置 skill。本轮重新阅读最新架构和 MVP 文档，检查删除预置能力后是否还能完整运行。

重点问题：

```text
没有 skill 时 message / tool / check 是否仍成立
baseline eval 和项目 eval 是否分清
是否还有“默认能力常驻”的残留假设
```

## 2. 七个 case 复核

### Coding Agent

空白 self 没有代码 skill。第一次 grow 通过 seed loop 读取文件树和测试命令。active tool pack 只需要 list/read/run/write，不需要暴露未来所有工具。check 先跑 baseline eval；只有 grow 生成代码修复 eval 后，才运行项目 eval。

结论：成立。

### API Testing Agent

空白 self 没有 HTTP tool。seed loop 感知 OpenAPI 和用户目标后生成 HTTP tool candidate。check 必须先验证 tool schema 和 permissions；如果还没有 API mock eval，不应因为“项目业务 eval 缺失”直接失败。

结论：需要明确 baseline eval 与 candidate 项目 eval。

### 汇总新闻 Agent

空白 self 没有抓取 skill。seed loop 根据 source 配置生成 world 和 tool。文章抓取日志不能进入稳定前缀。没有新闻 eval 时，只跑 baseline；生成 fixture 后再跑项目 eval。

结论：成立。

### 小车 Agent

空白 self 没有硬件能力。第一次 grow 只能读取用户提供的接口说明或模拟器文件，不能假设传感器 tool 已存在。check 先验证权限和工具声明，模拟器 eval 由 grow 产生。

结论：成立。

### Windows 桌面助手 Agent

空白 self 没有桌面整理能力。seed loop 使用初始工具感知授权目录和用户规则，生成 dry-run skill 和 eval。每轮暴露最小工具，否则 token 和权限边界都会膨胀。

结论：成立。

### Claude Code 会话管理 Agent

空白 self 没有会话格式知识。seed loop 读取用户指定文件和 Git 状态，生成 handoff skill。业务 eval 可为空，直到 grow 生成 fixture。

结论：成立。

### Feng 自举

空白 self 没有架构 review skill。seed loop 读取 docs 和 review 轮次，生成 candidate world/skills/evals。MVP check 不能硬编码 case-first review 为初始 eval；它只能运行 grow 后 candidate 声明的业务 eval。

结论：需要修正。

## 3. 结构性发现

```text
1. message list 中“bootstrap tools 常驻”会误导为每轮全量暴露初始工具。
2. check 中“核心 eval”太模糊，容易把项目 eval 当成默认必须存在。
3. MVP eval 列表只写了 load-self/provider，但正文说还要 schema/permissions/secret，列表不完整。
4. 空白 self 第一次 check 应允许没有业务 eval；有 candidate 业务 eval 时才运行。
```

## 4. 修改方向

```text
active tool pack 由 hook/skill 或 seed loop 选择。
baseline eval 验证 self 健康、schema、permissions、provider/config、secret。
project eval 由 grow 生成，存在才运行。
skills/world 为空时 index 为空，不伪造能力。
```
