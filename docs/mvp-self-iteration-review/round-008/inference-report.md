# MVP Review 第 8 轮推演报告

## 1. 本轮目的

第 7 轮删除了预置 skill。本轮检查 MVP 是否仍然可实施。

## 2. 可实施性推演

### bootstrap

生成最小 self：

```text
identity.md
goal.md
hooks.yaml
permissions.yaml
interface.yaml
config.schema.yaml
skills/README.md
world/README.md
evals/load-self.yaml
evals/schema.yaml
evals/permission-boundary.yaml
evals/no-secret.yaml
evals/llm-provider-boundary.yaml
.feng/
```

### first grow

hooks 为空，因此进入 seed loop。

seed loop 选择最小工具：

```text
list_files
read_file
run_command
write_file
```

但这些工具不是每轮强制全量暴露。message compiler 根据 latest event 和上下文预算选择。

### candidate 形成

LLM 生成当前项目需要的 world、skills、evals 和修改。

### check

check 固定运行 baseline eval：

```text
load self
schema
permissions
secret
provider boundary
```

项目业务 eval 只有在 candidate 声明后才运行。这样空白 self 可以启动，成长后的 self 又能被项目 eval 约束。

## 3. 发现的问题

```text
1. MVP eval 列表不完整。
2. check 写法暗示项目业务 eval 必须存在。
3. active tool pack 需要说明 seed loop 也负责选择最小工具。
```

## 4. 修改

已在 MVP 主文档中补齐 baseline eval，并把项目业务 eval 改成“candidate 声明时运行”。

## 5. 结论

MVP 现在更可实施：

```text
空白 self 可以启动。
第一个 grow 可以生成项目能力。
check 不会因为还没有业务 eval 而阻塞。
业务 eval 一旦被 grow 生成，就会约束 candidate。
```
