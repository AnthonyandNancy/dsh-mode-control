# dsh-mode-control 修改指令：增加动态子代理模型策略

## 一、目标

在 `dsh-v0.1.2-rc.1` Subagent 能力基础上，为 `dsh-mode-control`
增加子代理模型动态路由能力。

要求：

1.  子代理默认模型根据当前父会话模型动态决定；
2.  支持不同 Provider 下不同主模型对应不同子代理模型；
3.  当前会话模型切换后，新创建的子代理必须使用新的映射规则；
4.  不允许缓存 Session 创建时模型；
5.  子代理模型解析必须基于创建子代理瞬间的父 Agent 当前模型。

------------------------------------------------------------------------

## 二、Provider + Model 到子代理模型映射

示例：

``` json
{
  "subAgentModelPolicy": {
    "provider1": {
      "mode1-1": {
        "provider": "provider1",
        "model": "mode1-2"
      }
    },
    "provider2": {
      "mode2-1": {
        "provider": "provider2",
        "model": "mode2-2"
      }
    }
  }
}
```

规则：

-   provider1/mode1-1 → 子代理 provider1/mode1-2
-   provider2/mode2-1 → 子代理 provider2/mode2-2

------------------------------------------------------------------------

## 三、核心实现

新增：

    src/subagent/modelResolver.ts

接口：

``` ts
interface ParentModelContext {
  provider: string
  model: string
}

interface ChildModelTarget {
  provider: string
  model: string
}

function resolveSubAgentModel(
  parent: ParentModelContext
): ChildModelTarget | undefined
```

------------------------------------------------------------------------

## 四、动态解析要求

禁止：

``` ts
session.initialModel
```

作为子代理模型来源。

禁止缓存：

``` ts
cache.childModel
```

必须在创建子代理时实时解析：

``` ts
const currentModel = getCurrentAgentModel(sessionId)

const childModel = resolveSubAgentModel(currentModel)

ctx.subagents.start({
  parent,
  prompt,
  agentOptions: childModel
})
```

------------------------------------------------------------------------

## 五、模型切换支持

场景：

初始：

    Parent:
    provider1/mode1-1

    Child:
    provider1/mode1-2

用户切换：

    Parent:
    provider2/mode2-1

再次创建子代理：

    Child:
    provider2/mode2-2

不能继续使用旧模型。

------------------------------------------------------------------------

## 六、配置结构

``` ts
interface SubAgentModelPolicy {
  [provider:string]: {
    [model:string]: {
      provider:string
      model:string
    }
  }
}
```

默认：

``` json
{
  "subAgentModelPolicy": {}
}
```

表示：

子代理继承父 Agent 模型。

------------------------------------------------------------------------

## 七、状态获取要求

错误：

``` ts
session.model
session.initialProvider
```

正确：

``` ts
agent.provider
agent.model
```

原因：

Session 生命周期内模型可能发生切换。

------------------------------------------------------------------------

## 八、兼容性

### 无配置

父：

    provider1/model1

子：

    provider1/model1

------------------------------------------------------------------------

### 有配置

父：

    provider1/mode1-1

子：

    provider1/mode1-2

------------------------------------------------------------------------

### 无匹配

继承父模型。

------------------------------------------------------------------------

## 九、测试要求

覆盖：

1.  provider1/mode1-1 → provider1/mode1-2
2.  provider2/mode2-1 → provider2/mode2-2
3.  无配置继承父模型
4.  运行过程中切换模型后，新子代理使用新的映射

------------------------------------------------------------------------

## 十、禁止实现方式

禁止：

``` ts
session.createdModel
```

决定子代理模型。

禁止：

``` ts
currentChildModel
```

全局缓存。

禁止：

``` ts
session.childModel
```

固定绑定。

正确：

    Parent Agent
        |
        +---- Child Agent(model override)

------------------------------------------------------------------------

## 十一、最终效果

初始：

    Parent:
    provider1/mode1-1

    Child:
    provider1/mode1-2

切换：

    Parent:
    provider2/mode2-1

    Child:
    provider2/mode2-2

未配置：

    Parent:
    providerX/modelX

    Child:
    providerX/modelX

------------------------------------------------------------------------

## 十二、修改原则

-   不修改 DSH Core；
-   使用 dsh-v0.1.2-rc.1 Subagent 能力；
-   子代理模型解析独立封装；
-   每次创建子代理实时解析；
-   保持无配置时默认继承。

后续可扩展：

-   根据任务类型自动选择子模型；
-   根据 Token 成本选择模型；
-   根据 Agent 角色选择模型；
-   多级子代理继承策略。
