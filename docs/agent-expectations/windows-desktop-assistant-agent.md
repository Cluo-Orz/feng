# 目标 Agent：Windows 桌面助手 Agent

## 用户期望

创造者希望用 feng 孵化出一个 Windows 桌面助手，例如 `deskhelper`。

使用者期望：

```text
deskhelper "整理桌面上的截图"
deskhelper find "上周的发票"
deskhelper cleanup --dry-run
```

## 面对的世界

`deskhelper` 面对的是用户的 Windows 桌面环境：

```text
桌面文件
下载目录
文档目录
窗口和进程
本地应用
PowerShell 命令
用户偏好
```

## 期望能力

1. 查找和整理本地文件。
2. 执行安全的 PowerShell 命令。
3. 根据用户偏好分类。
4. 支持 dry-run 和确认。
5. 生成操作报告。

## 期望权限

```text
读取用户授权目录
写入目标整理目录
运行受限 PowerShell 命令
```

不得默认删除文件、读取敏感目录或关闭用户应用。

## 期望接口

```text
deskhelper organize --input ~/Downloads --dry-run
deskhelper find "invoice"
deskhelper config
```

## 验收方式

1. 能在示例目录中生成安全整理计划。
2. dry-run 不修改文件。
3. 实际执行前展示变更摘要。
4. 不访问未授权目录。

