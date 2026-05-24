# 目标 Agent：API Testing Agent

## 用户期望

创造者希望用 feng 孵化出一个 API 测试命令，例如 `apitest`。

使用者期望：

```text
apitest --spec openapi.yaml --base-url http://localhost:3000
apitest smoke
apitest regression
```

## 面对的世界

`apitest` 面对的是 API 服务和接口描述：

```text
OpenAPI/Swagger 文档
HTTP endpoint
认证方式
测试数据
响应 schema
服务日志
```

## 期望能力

1. 读取 API 规范。
2. 生成 smoke test 和 regression test。
3. 发送 HTTP 请求并检查响应。
4. 识别 schema mismatch、状态码错误、认证错误。
5. 输出可复现的失败报告。

## 期望权限

```text
读取 API spec 和测试数据
写入测试报告
访问指定 base URL
读取本地配置中的 token
```

不得默认访问未授权域名。

## 期望接口

```text
apitest smoke --spec openapi.yaml --base-url http://localhost:3000
apitest case GET /users
apitest report
```

## 验收方式

1. 能根据小型 OpenAPI 文件生成并执行 smoke test。
2. 能发现一个故意设置的错误响应。
3. 报告里包含请求、响应摘要和失败原因。
4. 不泄漏 token。

