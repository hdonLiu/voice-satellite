# Voice Satellite 详细技术设计

- 状态：Draft
- 日期：2026-08-13
- 适用版本：v1
- 相关规范：[Device Link v1](../../specs/device-link-v1.md)、
  [Connector Link v1](../../specs/connector-link-v1.md)、
  [Turn 生命周期](../../specs/turn-lifecycle.md)

本文描述“代码应当如何组织和运行”。必须经过真实硬件或真实 API 验证的内容标记
为 **P0 pending**，不在设计阶段假装已经确定。

## 1. 目标与非目标

### 1.1 v1 目标

- 一个符合 Device Link 的语音设备实现；首个实现是 ESP32-S3。
- 一个公网单节点 Relay，负责语音链路和 Turn 编排。
- 一个主动出站的 Connector，每次只启用一个 AgentRuntime。
- 首个 AgentRuntime 是 OpenClaw ACP，后续可在部署时整体替换。
- 半双工、流式 ASR、流式 Agent 文本、分句 TTS、流式播放。
- 一次完整取消可以贯穿设备、ASR、Agent、TTS 和播放。
- 模块可以使用 Fake Adapter 做确定性测试。

本文中的“可扩展”只指 Device 和 Agent 实现可替换。v1 不承诺 Relay
多实例横向扩容；该决策见
[ADR 0004](../adr/0004-single-node-replaceability.md)。

### 1.2 非目标

- 不做同时连接或动态切换多个 Agent。
- 不在 Relay 实现第二套 Agent、记忆或工具系统。
- 不提供任意 ACP、HTTP、shell、文件系统或 Agent session 代理。
- 不在 v1 实现全双工、自然抢话、声纹认证和 exactly-once 工具执行。
- 不为单节点系统引入 Kafka、Redis、Kubernetes、CQRS 或 Event Sourcing。

## 2. 部署视图与依赖方向

```text
devices/<platform>
  DeviceController
  Device Link client
        │
        │ WSS: control JSON + binary audio
        ▼
apps/relay
  DeviceGateway -> TurnOrchestrator -> AgentPort
                -> ASR / Segmenter / TTS
        │
        │ WSS: typed agent commands/events
        ▼
apps/connector
  RelayClient -> ConnectorCoordinator -> AgentRuntimePort
                                      -> agents/openclaw
                                             │ local ACP/stdio
                                             ▼
                                          OpenClaw
```

每个可执行单元内部只能按以下方向依赖：

```text
adapters -> application/ports -> domain
```

Domain 不导入 WebSocket、ACP、ESP-IDF、云厂商 SDK、文件系统或进程 API。

## 3. 核心身份与关联关系

| 类型               | 创建方         | 生命周期         | 说明                                      |
| ------------------ | -------------- | ---------------- | ----------------------------------------- |
| `DeviceId`         | Relay 配对系统 | 长期             | 逻辑身份，不等于 MAC、芯片 ID 或板型      |
| `ConnectorId`      | Relay 配对系统 | 长期             | 标识一个安装实例，不是 Agent 类型         |
| `ConnectionId`     | Relay          | 单次 WSS         | 握手成功后分配，重连必定变化              |
| `ConversationId`   | Relay          | 多个 Turn        | 设备当前的多轮上下文，可显式重置          |
| `TurnId`           | Device         | 单轮             | 128-bit 随机 ID；Relay 在设备作用域内去重 |
| `RequestId`        | Relay          | 单次 Agent 调用  | Connector 去重和不确定状态判断依据        |
| `AudioStreamId`    | 音频发送方     | 单个方向的音频流 | 输入、输出分别创建                        |
| Native session ref | Agent Adapter  | 本机持久化       | 永远不进入 Connector Link                 |

认证后的 principal 决定 `DeviceId` 或 `ConnectorId`。客户端消息不能自行声明另一
个 principal 的身份。

### 3.1 Conversation 规则

- `device.welcome` 返回 Relay 当前授权的 `ConversationId`。
- `turn.start` 必须携带该 ID，不能自由访问其他 Conversation。
- Conversation reset 是独立的受控操作，v1 可以先通过管理配置完成。
- Connector 使用 `ConversationId` 查找本机 opaque session binding。
- Connector 优先恢复已绑定的 native session；绑定失效时显式报告
  Conversation 已重置，不能假装历史仍然存在。

## 4. 握手与 v1 实现契约

### 4.1 通用握手规则

1. TLS 和 HTTP Header 鉴权先完成。
2. 客户端第一个应用消息为 `device.hello` 或 `connector.hello`。
3. 首个 hello 不携带 `ConnectionId`；使用 `seq = 0`。
4. Relay 校验协议版本和角色后生成 `ConnectionId`。
5. Relay 返回 welcome；Connector 在本地 AgentRuntime 健康后再发送 ready。
6. 后续消息必须携带该 `ConnectionId`，`seq` 在连接内严格递增。
7. 握手超时或重复 hello 关闭连接。

上述握手细节在 P1 写入 JSON Schema 并冻结。

### 4.2 Device hello payload

v1 不定义通用设备能力或音频格式协商矩阵。所有合规设备必须支持
Device Link 的固定 PCM 输入/输出基线。hello 只有一个会改变 Relay 决策的
业务字段：

```text
DeviceHelloPayload
  physicalApproval: boolean
  diagnostics?: platform / board / softwareVersion / buildProfile
```

`diagnostics` 只用于日志和兼容性分析，TurnOrchestrator 禁止按 `platform == esp32`
或具体板名分支。没有实体审批时，权限请求默认拒绝。

PTT 和 WakeNet 是构建 profile，唤醒/VAD 完全在设备本地发生。两个 profile
在线上都只产生 `turn.start` → audio → `turn.input_end`，因此不上报为业务
字段。屏幕、按键、OTA 和板型也是本地实现细节。v1 是半双工，不声明
barge-in 能力。

### 4.3 AgentRuntime v1 contract

Connector 不与 Relay 协商 Agent 能力。一个 v1 合规的 `AgentRuntimePort`
必须完整实现：

```text
monotonic text delta
cancellation
local session resume
filtered status event
structured permission request
```

契约不包含 `agentId`、`agentAlias`、`backend` 或动态选择字段。缺失必选操作的
Adapter 不能发送 `connector.ready`，而不是让 Relay 为它增加降级分支。

## 5. 领域状态设计

### 5.1 Turn 主状态

```text
NEW
  -> CAPTURING
  -> TRANSCRIBING
  -> WAITING_AGENT
  -> SPEAKING
  -> COMPLETED

任意非终态 -> CANCELLED | FAILED
```

由于 Agent 仍可能在产生文本时 TTS 已经开始，不能只用一个线性枚举描述内部
并发。`TurnContext` 额外维护子状态：

```text
agentStage: idle | pending | streaming | done | failed | cancelled
ttsStage:   idle | streaming | draining | done | failed | cancelled
```

设备 UI 只接收稳定的主状态，Relay 内部使用子状态判断何时可以真正终止 Turn。

### 5.2 TurnContext

```text
TurnContext
  deviceId
  connectionId
  conversationId
  turnId
  requestId?
  phase
  agentStage
  ttsStage
  startedAt
  timeoutBudget
  abortController
  inputQueue
  textQueue
  outputQueue
  metrics
  terminalResult?
```

所有终态通过一个原子 `finishOnce(result)` 入口产生。任何 Adapter 的迟到事件先
检查 Turn token 和终态；终态之后不得重新打开队列或发送设备消息。

### 5.3 Device 状态

```text
BOOT -> PROVISIONING | CONNECTING -> IDLE
IDLE -> LISTENING -> WAITING_AGENT -> SPEAKING -> IDLE
WAITING_AGENT | SPEAKING -> PERMISSION_WAIT
任意状态 -> CONNECTING | ERROR
IDLE -> UPDATING -> BOOT
```

只有 `DeviceController` 可以改变主状态。音频、网络、UI 和按键任务只能发送
事件，不能直接互相调用改变状态。

## 6. 端口契约

以下为设计接口，不是最终代码签名。

### 6.1 Relay speech ports

```ts
interface StreamingAsrPort {
  open(context: AsrContext, signal: AbortSignal): Promise<AsrStream>;
}

interface AsrStream {
  readonly events: AsyncIterable<AsrEvent>;
  push(frame: AudioFrame): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

interface StreamingTtsPort {
  open(context: TtsContext, signal: AbortSignal): Promise<TtsStream>;
}

interface TtsStream {
  readonly audio: AsyncIterable<AudioFrame>;
  append(segment: TextSegment): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}
```

Adapter 必须把云厂商错误转换成稳定错误，不能把厂商错误码泄漏进 Domain 或
Device Link。

### 6.2 Relay AgentPort

```ts
interface AgentPort {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(requestId: RequestId): Promise<void>;
}
```

Relay 中的实现通过 Connector Link 发送命令，不知道本地 Agent 类型。
该边界统一命名为 `AgentPort`；Connector Link 只是它的 WSS 实现协议。

### 6.3 Relay DeviceOutputPort

```ts
interface DeviceOutputPort {
  state(turnId: TurnId, state: DeviceTurnState): Promise<void>;
  transcript(turnId: TurnId, text: string): Promise<void>;
  audio(turnId: TurnId, frames: AsyncIterable<AudioFrame>): Promise<void>;
  permission(request: PermissionRequest): Promise<void>;
  finish(turnId: TurnId, result: TurnResult): Promise<void>;
}
```

`DeviceGateway` 负责输入解析，并向 TurnOrchestrator 提供与当前连接绑定的
`DeviceOutputPort`。该 port 不知道 GPIO、屏幕或具体设备平台。

### 6.4 Connector AgentRuntimePort

```ts
interface AgentRuntimePort {
  health(): Promise<RuntimeHealth>;
  open(binding: SessionBinding): Promise<AgentConversation>;
}

interface AgentConversation {
  run(prompt: AgentPrompt, signal: AbortSignal): AsyncIterable<RuntimeEvent>;
  cancel(requestId: RequestId): Promise<void>;
  resolvePermission(result: PermissionResult): Promise<void>;
  close(): Promise<void>;
}
```

一个 Connector 进程只构造一个 `AgentRuntimePort`。不同 Agent 子目录是构建或
部署时替换方案，不是并行 registry。

### 6.5 Device ports

```text
AudioInput       start / readFrame / stop
AudioOutput      start / writeFrame / stop
WakeDetector     arm / events / disarm
VoiceTransport   connect / sendControl / sendAudio / receive
DeviceView       render stable ViewModel
KeyInput         key events
CredentialStore  load / provision / rotate
OtaUpdater       check / download / verify / apply
```

设备 Domain 使用自有值类型，禁止直接依赖 ESP-IDF handle。

## 7. Relay 详细设计

### 7.1 模块

```text
adapters/device-ws       设备鉴权、握手、控制与二进制音频解析
adapters/agent-port-ws   Connector Link 鉴权、握手和 AgentPort 实现
adapters/asr/*           流式 ASR
adapters/tts/*           流式 TTS
application/turn         TurnOrchestrator、状态和取消
application/segmenter    单调 delta 累积与安全断句
application/routing      已认证连接目录
domain                   ID、状态、事件、错误和值对象
bootstrap                配置、composition root、health、shutdown
```

### 7.2 TurnOrchestrator 流程

1. 校验设备 principal、Conversation、当前无活跃 Turn。
2. 验证该 Turn 使用 v1 固定输入/输出格式。
3. 创建 `TurnContext`、有界队列和根 `AbortController`。
4. 打开 ASR，将设备音频按背压规则写入。
5. `turn.input_end` 后结束 ASR 输入并等待唯一 final。
6. 创建 `RequestId`，通过 AgentPort 发起请求并等待 accepted。
7. 对 `text_delta` 做单调性校验、累计和分句。
8. 第一段文字到达后打开 TTS；TTS 音频边生成边发送设备。
9. Agent done 后 flush 断句器和 TTS。
10. Agent 与 TTS 都结束后发送 `audio.end` 与 `turn.done`。

任何步骤失败都调用统一终止逻辑，取消所有子任务、关闭队列并发送一个稳定终态。

### 7.3 断句器

断句器只接受“新增 delta”，不接受累计全文：

- 优先中文句号、问号、叹号、分号和换行。
- 英文标点后需要合理空白或结束条件。
- 短片段等待更多文本，避免 TTS 语调破碎。
- 超过最大字符数即使无标点也强制切段。
- 代码块、URL 和 Markdown 标记只做最小文本清理，不执行渲染。
- Agent done 时强制 flush 尾段。
- 每个字符只进入一次 TTS，最终完整回答不得重复播放。

具体最小/最大字符阈值在真实 TTS Spike 后确定。

### 7.4 有界队列与背压

设备输入 PCM、Agent 文本、TTS 输出 PCM 和 WSS 待发送都必须有上限。
v1 只提供一个经 P0/P1 实测固定的 `standard` 队列预算，不向运维面
暴露每条队列的独立容量。短暂拥塞使用自然背压；到达高水位且无法在
有限时间内恢复时，以 `backpressure` 终止 Turn，绝不转为无界缓存。

WSS/TCP 已有可靠有序传输，因此不对音频逐帧 ACK。若发现音频 `seq` 跳变，代表
本地实现错误或错误复用连接，应终止当前音频流而不是补发实时旧音频。

### 7.5 Relay 持久化

v1 只持久化配置和长期 principal/binding；活跃连接和 Turn 保存在单个
Relay 进程的内存中。Relay 重启允许当前 Turn 失败，设备和 Connector
重连后从下一轮恢复。这是“状态可重建”，不是“活跃 Turn 可跨节点恢复”。
不引入 durable work queue，避免误重放已经执行过副作用的 Agent 请求。

## 8. Connector 详细设计

### 8.1 模块

```text
adapters/relay-ws              出站连接、鉴权、心跳、重连
adapters/agents/openclaw       OpenClaw ACP 实现
application/coordinator       请求调度、取消、事件过滤
application/runtime-host      唯一 AgentRuntime 生命周期
application/dedupe            RequestId 有界去重记录
ports                         AgentRuntimePort、RelayClientPort、SessionBindingStore
storage                       原子 session binding 与本地配置
bootstrap                     composition root、service、doctor
```

### 8.2 单 Agent 构造

composition root 从本地配置构造一个 Adapter。例如 v1 直接实例化
`OpenClawAcpRuntime`。Relay 不能传入 Adapter 名称，Connector Link 也没有运行
时切换命令。

未来更换 Agent 的步骤是：

1. 新增 `adapters/agents/<agent>`。
2. 实现相同 `AgentRuntimePort` contract test。
3. 在本地 composition root 配置/构建中替换实现。
4. Relay、Device Link 和 Connector Link 不修改。

### 8.3 请求处理

- v1 Connector 同时只处理一个活跃 `RequestId`；其他请求返回 `busy`。
- 收到 `agent.run` 后先验证 schema、Conversation 作用域、deadline 和去重。
- 只有成功打开 runtime conversation 后才发送 `agent.accepted`。
- accepted 前断线可以明确失败；accepted 后失联必须视为不确定状态。
- 最近完成的 RequestId 保存在有界 TTL 缓存中，重复命令返回既有终态或拒绝，
  但不会再次 prompt。
- TTL 和最大条数在 P1 固定为配置常量并测试淘汰行为。

### 8.4 SessionBindingStore

```text
ConversationId -> {
  runtimeKind: local constant, not wire data
  opaqueSessionRef
  createdAt
  updatedAt
  schemaVersion
}
```

- 文件以临时文件写入、fsync、rename 的方式原子更新。
- 文件权限仅当前用户可读写。
- 日志不输出 opaque ref。
- Adapter 不支持 resume 时可使用纯内存 binding，并显式报告 reset。

## 9. OpenClaw Adapter 详细设计

### 9.1 进程监督

```text
STOPPED -> STARTING -> INITIALIZING -> READY
任意运行态 -> BACKOFF -> STARTING
```

- 使用固定 executable/参数数组和 `shell: false`。
- stdout 只允许 ACP NDJSON；stderr 作为有长度限制且脱敏的日志。
- 初始化失败进入有上限的指数退避。
- ACP stdout 畸形、超长行或协议关联错误时 fail closed 并重启。
- 进程退出立即失败当前请求，不重放。
- shutdown 先取消会话，超时后发送终止信号，再到强制结束。

### 9.2 ACP 映射

| 通用操作        | OpenClaw Adapter 内部映射                                |
| --------------- | -------------------------------------------------------- |
| `open(binding)` | ACP initialize + session new/resume/load，按 P0 实测决定 |
| `run(prompt)`   | ACP session prompt                                       |
| `text delta`    | 只映射用户可见 assistant message chunk                   |
| `cancel`        | ACP session cancel，最终映射到 Gateway abort             |
| `permission`    | ACP request permission 的安全投影                        |
| `done/error`    | ACP stop reason 转稳定终态                               |

P0 必须记录目标 OpenClaw 版本的真实方法名、事件顺序和 SDK 行为。公共协议不得
依赖 OpenClaw 的私有字段。

### 9.3 输出过滤

默认不出本机：

- reasoning/thought
- system prompt 和 hidden context
- Gateway token、URL 和 native session key
- 工具原始参数/输出
- 文件系统绝对路径
- shell 命令和环境变量
- 未识别 ACP update

允许的 status 是固定枚举或安全摘要，例如“正在查询日历”，而不是原始工具 JSON。

## 10. ESP32 设备详细设计

### 10.1 目录

```text
devices/esp32/
  main/
  components/
    vs_domain/
    vs_protocol/
    vs_transport/
    vs_audio/
    vs_wake/
    vs_ui/
    vs_storage/
    vs_ota/
    vs_diag/
  boards/
    atk-dnesp32s3/
```

`boards/<board>` 只拥有 GPIO、codec/PA 连接、显示/按键、电源时序、board-specific
sdkconfig 和自检 hook。共享组件禁止导入具体板头文件。

### 10.2 FreeRTOS 执行单元

| 执行单元           | 职责                                     |
| ------------------ | ---------------------------------------- |
| `DeviceController` | 唯一主状态写入者，处理所有控制事件       |
| `AudioCapture`     | I²S DMA、可选 AFE、固定音频帧和输入 ring |
| `AudioPlayback`    | 输出 ring、重采样/格式适配、I²S DMA      |
| `Transport`        | WSS 收发、心跳、重连和协议解码           |
| `Wake/VAD`         | IDLE 本地唤醒、LISTENING 尾静音判断      |
| `UI`               | 消费不可变 ViewModel，低优先级刷新       |

控制事件使用有界队列；PCM 使用预分配 ring。音频热路径禁止频繁 new/malloc 和
动态字符串。

### 10.3 输入音频

```text
ES8388 ADC -> I2S DMA -> AudioCapture
  -> 可选 AFE/WakeNet/VAD
  -> pre-roll ring
  -> LISTENING 时 uplink ring
  -> Device Link binary frame
```

- PTT profile 不链接 ESP-SR。
- WakeNet profile 在 IDLE 持续处理本地 PCM，但不上传。
- 唤醒后可补发短 pre-roll，避免截掉第一个字；长度由声学测试确定。
- 播放期间暂停 WakeNet 和上行，保持 v1 半双工。
- 松键、VAD、无语音超时或最大时长只产生 controller 事件。

### 10.4 输出音频

```text
WSS binary frame -> output ring -> format/rate adapter -> I2S DMA -> ES8388 DAC
```

- 收到 `audio.start` 后校验格式并清空旧 stream。
- 达到低水位后开始播放，防止首包抖动。
- underrun 输出静音并计数；连续超阈值终止 Turn。
- `turn.cancel` 立即 mute、清空 ring，再发送取消事件。
- 新 Turn/stream ID 永远不能消费旧 ring 内容。

### 10.5 内存策略

- I²S DMA 和 ISR 所需数据放内部 RAM。
- pre-roll、网络音频 ring 和 UI 大对象优先放 PSRAM。
- 所有 ring 容量在编译或启动时固定。
- 每轮结束记录最小 heap、PSRAM、水位、drop/underrun。
- 具体 DMA 个数、ring 时长和任务优先级为 **P0 pending**。

### 10.6 配置与凭据

NVS 不做通用参数注册表。v1 只保存启动和连接所必需的记录，加一个
用户可调设置：

```text
configuration schema version
wifi credentials
relay URL
device credential
output volume
```

麦克风增益是 board profile 的校准常量；PTT/WakeNet 是构建 profile，不再加
一层运行时切换。v0.1 优先提供串口/安全本地配置，避免把配网页面
扩大为首个阻塞项。生产 profile 可启用 NVS encryption、Secure Boot 和
Flash Encryption。

## 11. 取消、超时与错误

### 11.1 根取消

每个 Turn 有一个根 `AbortController`。下列事件调用同一取消入口：

- 设备 `turn.cancel`
- 设备连接断开
- 输入或整体 deadline
- ASR、Agent 或 TTS 失败
- 背压超限
- Relay shutdown

取消顺序：标记终态意图、停止新输出、abort 子任务、清理队列、通知 Connector/
设备、记录唯一终态。清理函数必须幂等。

### 11.2 运行预算

v1 的运维配置面只暴露三项，并且都有内置默认值：

- Turn 总超时
- Agent 总超时
- 队列水位 profile；v1 只提供 `standard`

hello、无语音、最长录音、ASR final、Connector accepted、permission 和 TTS stall
仍必须有内部上限，但它们是由 P0/P1 实测固定的实现常量，不各自暴露
为运维参数。协议中的 `deadlineMs` 只表示 Agent 此次请求的更早截止时间，
不能扩大 Relay 内置上限。

### 11.3 稳定错误

Adapter 错误统一转换为小而稳定的 v1 错误集；详细原因只进入本地脱敏
日志。设备只看到 `unsupported_version`、`unauthorized`、`invalid_message`、
`invalid_state`、`busy`、`connector_offline`、`timeout`、`cancelled`、
`backpressure`、`execution_unknown` 或 `internal`。不预先为每个 Provider 或
Agent 故障建立公共错误码。

## 12. 安全设计

- Device 和 Connector 使用不同 credential audience/scope。
- token 只进入 `Authorization` Header，不放 URL、日志或指标标签。
- Relay 不保存 OpenClaw/Agent 原生凭据。
- Connector 不信任 Relay 传入的 session、路径、命令或 runtime 选择。
- Voice Agent 使用最小工具权限；语音不是高风险操作的充分认证。
- 权限请求是结构化一次性对象，有超时、状态和 request ID。
- 原始音频和 transcript 默认不持久化。
- Metrics 禁止使用高基数 transcript、Turn 内容或 credential 作为 label。
- OTA 必须签名、双分区、首启验证和回滚。

完整 threat model 在 P6 前完成。

## 13. 可观测性

统一 correlation 字段：

```text
component
connectionId
deviceIdHash / connectorIdHash
conversationIdHash
turnId
requestId
event
durationMs
errorCode
```

ID 可记录短 hash，禁止记录 token、完整 transcript、原始音频、工具参数、绝对路径
或 native session ref。

关键指标：连接数、Turn 终态、各阶段耗时、ASR/TTS 首包、队列高水位、音频
underrun、重连、ACP restart、取消和不确定执行次数。

## 14. 测试设计

### 14.1 Contract tests

- 每个 Device 实现运行相同 Device Link conformance。
- 每个 Agent Adapter 运行相同 `AgentRuntimePort` contract test。
- 每个 ASR/TTS Adapter 运行流式、取消、错误和清理 contract test。

### 14.2 Golden traces

- 正常单轮和三轮上下文。
- PTT profile 不需要唤醒词。
- Device 无实体审批时默认拒绝。
- 每个阶段取消、断线和迟到事件。
- 重复 RequestId、非法 seq、错误角色和超长消息。
- Connector accepted 后断线的 `execution_unknown`。

### 14.3 结构可替换验收

- Fake Device 替换 ESP32 时不修改 Relay/Connector。
- Fake AgentRuntime 替换 OpenClaw 时不修改 Relay、Device Link 或 Connector Link。
- 新 ESP32 board adapter 不修改 ESP32 shared components。

## 15. P0 必须关闭的设计问题

| 编号 | 问题                                       | 决策产物                 |
| ---- | ------------------------------------------ | ------------------------ |
| D-01 | ESP-IDF/ESP-SR/codec 的固定兼容版本        | ADR + lock               |
| D-02 | ES8388 实际稳定采样/时钟模式               | 音频 ADR                 |
| D-03 | DMA、ring、任务优先级和 PSRAM 预算         | 固件资源表               |
| D-04 | OpenClaw ACP 实际方法、事件和 restart 行为 | ACP compatibility report |
| D-05 | ACP SDK 是否直接使用                       | ADR                      |
| D-06 | ASR final、TTS append/cancel 的真实语义    | Provider contract trace  |
| D-07 | 音频二进制头最终字节布局                   | Device Link schema/spec  |
| D-08 | 断句长度和 TTS 首包参数                    | 性能基准                 |

P0 结束前不把这些值散落到业务代码中。
