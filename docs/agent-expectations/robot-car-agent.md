# 目标 Agent：小车 Agent

## 用户期望

创造者希望用 feng 孵化出一个运行在小车上的 agent，例如 `carbrain`。

使用者期望：

```text
carbrain patrol
carbrain avoid-obstacles
carbrain calibrate
```

## 面对的世界

`carbrain` 面对的是一个具备传感器和控制接口的小车：

```text
距离传感器
摄像头帧
电机控制
速度限制
空间障碍物
电量状态
安全停止条件
```

## 期望能力

1. 读取传感器状态。
2. 理解小车控制接口。
3. 避免碰撞。
4. 在低风险环境中移动。
5. 遇到异常时停止。
6. 根据运行记录改进控制策略。

## 期望权限

```text
读取传感器
写入电机控制指令
读取小车配置
写入运行日志
```

高风险动作必须受限，例如高速移动、持续前进、忽略障碍物。

## 期望接口

```text
carbrain patrol --speed low
carbrain stop
carbrain calibrate sensors
```

## 验收方式

1. 能在模拟传感器输入下正确选择停止或转向。
2. 能解释每次控制决策。
3. 失去传感器输入时进入安全停止。
4. 不在未授权模式下执行高风险动作。

