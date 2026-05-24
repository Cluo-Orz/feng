# 目标 Agent：汇总新闻 Agent

## 用户期望

创造者希望用 feng 孵化出一个新闻汇总命令，例如 `newsbrief`。

使用者期望：

```text
newsbrief --topic AI --since today
newsbrief --source rss.yaml
newsbrief daily
```

## 面对的世界

`newsbrief` 面对的是新闻源和用户关注主题：

```text
RSS 源
网页文章
搜索结果
用户关注主题
时间范围
引用来源
```

## 期望能力

1. 拉取或读取新闻源。
2. 去重相似新闻。
3. 按主题聚类。
4. 生成短摘要。
5. 保留来源链接和时间。
6. 区分事实、推测和观点。

## 期望权限

```text
访问声明过的新闻源
写入摘要文件
读取本地订阅配置
```

不得默认抓取不相关网站或绕过访问限制。

## 期望接口

```text
newsbrief daily
newsbrief --topic "AI agent" --limit 10
newsbrief --format markdown
```

## 验收方式

1. 能对一组示例文章生成去重摘要。
2. 每条摘要包含来源链接。
3. 能按时间范围过滤。
4. 不把旧新闻误报为新新闻。

