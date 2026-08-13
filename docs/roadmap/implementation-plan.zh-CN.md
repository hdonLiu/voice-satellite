# 详细实施计划

本计划将项目从文档仓库推进到可公开发布的 v1.0。第一版锁定：单设备、单节点
Relay、一个出站 Connector、OpenClaw ACP、半双工 PCM、按键说话加可选
WakeNet/VAD。

## 阶段关系

```text
P0 兼容性验证
  → P1 仓库、领域模型、协议和 Testkit
  → P2 全 Fake 垂直闭环
  → P3A 固件音频/PTT ┐
     P3B 真实 ASR/TTS ├→ P4 真实端到端 PTT
     P3C 真实 ACP     ┘
  → P5 WakeNet/UI/权限
  → P6 安全/可靠性/OTA/部署
  → P7 一致性/文档/开源 v1.0
```

## P0：兼容性 Spike，5–8 人日

这是阻塞阶段，先验证风险，不先搭大框架。

- 核实 ATK-DNESP32S3 实际硬件版本和 ES8388、I²S、PA、LCD、按键引脚。
- 跑通麦克风录音和扬声器播放。
- 实测 ESP-IDF、ESP-SR、`esp_codec_dev` 版本组合。
- 验证 16 kHz 上行、24 kHz 下行，以及 codec 固定 48 kHz 的回退方案。
- 在 OpenClaw 电脑验证 ACP 初始化、会话、流式回答、取消、权限和进程重启。
- 验证官方 TypeScript ACP SDK。
- 跑通选定流式 ASR/TTS，测首包、取消、超时、重连和限流。
- 保存脱敏 Golden Trace，固定候选依赖版本。

完成标准：音频、ACP、ASR、TTS 四条链路可以分别运行。

## P1：仓库、领域模型和协议冻结，5–7 人日

- 初始化 pnpm、strict TypeScript、ESP-IDF、CI、格式化、测试和依赖锁。
- 将 `devices/esp32/boards/atk-dnesp32s3` 建为首个设备/板级适配器，将
  `apps/connector/src/adapters/agents/openclaw` 建为首个单 Agent 适配器。
- 实现各类 ID、Turn 状态机和稳定错误码。
- 冻结 Device Link v1、Connector Link v1、设备/Agent 能力和二进制音频头。
- 发布 JSON Schema 和生成 DTO。
- 建立 Fake Device、ASR、TTS、Connector、Relay 和 Fake ACP executable。
- 建立合法、非法、取消、超时和断线 Golden Trace。

完成标准：v1 现有字段不再重命名；以后只能增加兼容的可选字段。

## P2：全 Fake 垂直切片，7–10 人日

Relay 完成设备/Connector WSS、分离鉴权、连接注册、`TurnOrchestrator`、
内存 TurnRegistry、有界队列、Fake ASR、Agent 路由、断句和 Fake TTS。

Connector 完成主动出站、hello/ready、心跳、指数退避、请求去重、Fake
AgentRuntime、流式 delta、取消和终态。

Fake AgentRuntime 必须与后续 OpenClaw 使用同一端口，协议不包含 Agent 选择。

必须跑通：

```text
Fake Device PCM → Relay → Fake ASR → Connector → Fake Agent
→ Text Delta → Fake TTS → Fake Device PCM
```

完成标准：100 Turn 无资源泄漏、重复执行、取消后输出或无限队列。

## P3：三条真实轨道并行，20–30 人日

### 固件音频与 PTT

- 初始化 PSRAM、I²C、I²S、ES8388、LCD 和按键。
- 防爆音、静音、音量和麦克风增益。
- PCM16 16 kHz 单声道采集，每 20 ms 640 字节。
- PCM16 24 kHz 播放和有界抖动缓冲。
- DMA 使用内部 RAM，大环形缓冲使用 PSRAM。
- 录放互斥、按键开始/结束/取消和本地诊断。

完成标准：录音、播放各 30 分钟；100 次 PTT 状态循环无溢出、看门狗、
死锁或持续内存下降。

### 真实 ASR/TTS

- 实现真正流式 Provider adapter。
- 厂商错误映射稳定领域错误。
- 心跳、超时、取消、清理和有界输出。
- 中文/英文标点与最大长度断句，结束时 flush 尾部文字。

完成标准：partial 不调用 Agent，final 只调用一次；取消后不再输出音频。

### OpenClaw ACP

- 实现在 `apps/connector/src/adapters/agents/openclaw` 目录。
- `shell: false` 启动并监督 `openclaw acp`。
- stdout 只承载协议，stderr 只承载日志。
- 初始化、会话绑定、prompt、delta、cancel 和终态映射。
- Connector 本地派生允许的 session key。
- 过滤思考、路径、工具参数/输出、凭据和未知事件。
- 限制 NDJSON 行长度；畸形消息 fail closed。
- ACP 重启时失败当前请求，不自动重放。

完成标准：连续三轮保持上下文；取消生效；ACP 重启后下一轮恢复；Relay
不能任意选择 OpenClaw 会话。

## P4：真实 PTT 端到端，6–10 人日

- 固件以完整 TLS 校验和 Header 鉴权连接 Relay。
- 配置 Wi-Fi、Relay 地址、设备令牌和音量。
- 打通 ESP32 → ASR → Connector/ACP → TTS → ESP32 扬声器。
- 显示离线、聆听、思考、播放和错误。
- 实体键取消贯穿录音、ASR、ACP、TTS 和播放。
- 记录各阶段耗时和队列水位。

完成标准：50 次真实问答；三轮上下文；多句回答在 Agent 完成前播放；取消
300 ms 内停止本地播放；断线恢复不播放旧音频。发布 v0.1.0。

## P5：WakeNet、VAD、UI 和权限，8–12 人日

- 提供 `ptt`、`wakenet`、`headless` 构建。
- ESP-SR 完全位于可选 adapter，始终保留按键路径。
- 单麦 WakeNet/VAD 仅在 IDLE 运行；v1 关闭 AEC，播放时不唤醒。
- 配置唤醒冷却、无语音超时、VAD 尾静音和最大录音时长。
- 显示转写、回答、状态、错误和权限请求。
- 权限必须结构化，实体键允许/拒绝，超时默认拒绝。

声学目标：安静环境 0.5–2 米 50 次唤醒成功率不低于 90%；连续 8 小时背景
音目标不高于每小时一次误唤醒；95% 测试语句不截首尾。发布 v0.2.0。

## P6：安全、可靠性、部署和 OTA，10–15 人日

Relay：健康检查、分角色凭据、消息/速率/Turn 限制、优雅退出、日志脱敏、
Docker Compose 和 TLS 示例，默认不保存音频与转写。

Connector：受保护配置、systemd/launchd/Windows Service、OpenClaw/ACP
doctor、自恢复和原子会话映射。

固件：看门狗、boot-loop 安全模式、崩溃摘要、资源指标、签名 HTTPS OTA、
双分区、首启验证和自动回滚。

完成标准：8 小时和 500 Turn；无持续内存/句柄/队列增长；OTA 断电仍可启动；
畸形或超长输入不能崩溃或泄密；不确定请求绝不自动重放。发布 v0.9.0-rc.1。

## P7：开源 v1.0，5–8 人日

- 完成协议一致性与硬件在环测试。
- 写完构建、刷写、配网、部署、安装、恢复和 adapter 文档。
- 为固件与 Node 制品生成 SPDX SBOM。
- 验证 PTT 构建不链接 ESP-SR。
- 完成许可证、来源、DCO、治理、威胁模型和安全报告流程。
- 发布签名固件、Relay 镜像、Connector 制品、校验值和 SBOM。
- 在全新环境按公开文档完成复现。

v1.0 门槛：无需公开 OpenClaw 电脑端口；凭据不出本机；三轮上下文、流式播放、
取消和实体权限均工作；500 Turn 无串线、旧音频或永久卡死；非法版本、角色、
大小和会话选择全部被拒绝；Fake Device 替换 ESP32 不修改 Relay/Connector；
Fake AgentRuntime 与 OpenClaw 互换不修改 Relay、Device Link 或 Connector Link。

## 工作量

总计约 66–100 人日。单人预计 14–20 周；固件、Relay/语音、Connector/ACP
三条轨道并行时预计 8–12 周，并在 P1、P2、P4、P6 强制集成。
