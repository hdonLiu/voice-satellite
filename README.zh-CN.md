# Voice Satellite

Voice Satellite 是一个独立开源的语音设备协议和参考系统，用于通过云端语音
中继访问运行在另一台电脑上的 AI Agent；ESP32-S3 是第一个设备实现。

第一版接入 OpenClaw，但不会公开 OpenClaw Gateway。远端电脑上的 Connector
主动连接云端 Relay，OpenClaw 凭据始终只保存在本地电脑。

> 本项目是独立社区项目，与 OpenClaw、乐鑫、正点原子和 cc-connect 均无官方
> 关联，也不代表这些项目对本项目的认可。

## 当前状态

核心实现已开始：契约、Relay/Connector 稳定 Port、有界 Turn 编排器、Fake
Adapter 和 100 Turn 全 Fake 垂直闭环已在测试中运行。目前仍没有可用的固件或
服务端 Release；详见[实现状态](docs/roadmap/implementation-status.md)。

## 总体结构

```text
ESP32-S3                         云端                     OpenClaw 所在电脑
┌──────────────────┐   WSS   ┌──────────────────┐   WSS   ┌──────────────────┐
│ 唤醒/VAD/音频/UI  ├────────►│ Voice Relay      ├────────►│ Local Connector  │
│ Device Link v1   │◄────────┤ ASR / TTS        │◄────────┤ Connector Link v1│
└──────────────────┘  PCM/控制└──────────────────┘  事件   └────────┬─────────┘
                                                                   │ ACP/stdio
                                                          ┌────────▼─────────┐
                                                          │ openclaw acp     │
                                                          │ localhost Gateway│
                                                          └──────────────────┘
```

- **设备实现**：本地唤醒、VAD、录音、播放、屏幕和 Device Link；ESP32 是
  第一个参考实现，其他设备平台可以实现相同协议。
- **Relay**：设备鉴权、流式 ASR/TTS、Turn 编排、背压和 Connector 路由，不
  持有 OpenClaw 凭据。
- **Connector**：只建立出站连接，每个 Connector 只启用一个可替换的
  AgentRuntime；OpenClaw 是第一个实现。

## v1 范围

- ATK-DNESP32S3 + ES8388
- 独立 ESP-IDF 固件
- 按键说话，以及可选 ESP-SR WakeNet/VAD 构建
- 半双工 PCM 音频和 WSS
- TypeScript Relay 与 Connector
- OpenClaw ACP 本机适配器
- 流式回答、取消、屏幕状态和实体键权限确认
- 签名 OTA、回滚、Fake 组件、协议一致性测试和 SBOM

详细路线见[详细技术设计](docs/design/detailed-design.zh-CN.md)、
[阶段计划](docs/roadmap/implementation-plan.md)和
[任务级执行计划](docs/roadmap/execution-plan.zh-CN.md)。

## 设计原则

1. OpenClaw 凭据永远只留在 OpenClaw 电脑。
2. ACP 只存在于 Connector 本机，不透传到云端或 ESP32。
3. 协议有版本并在适配器边界进行强校验。
4. 核心模块只交换语义事件，不交换厂商响应和原始 ACP JSON。
5. 所有队列有上限；状态不确定的 Agent 操作不得盲目重放。
6. 永久提供不依赖 ESP-SR 的按键说话构建。
7. 本项目是独立实现，不是 cc-connect 的 fork 或兼容实现。

## 可替换实现目录

```text
devices/
  esp32/
    boards/atk-dnesp32s3/

apps/connector/src/adapters/agents/
  openclaw/
```

更换设备时增加新的 `devices/<platform>` 实现；更换 Agent 时增加新的
`agents/<agent>` 适配器。系统不做多 Agent 路由，一个 Connector 同时只运行
一个 AgentRuntime。

这里指的是设备和 Agent 实现可替换，不是 Relay 多实例横向扩容。v1
明确使用单节点 Relay 和内存 Turn 状态；Relay 重启可以使当前 Turn
失败，设备和 Connector 重连后从下一轮恢复。

## 开源许可

项目原创代码和文档使用 Apache-2.0。ESP-SR/WakeNet 等可选依赖有独立许可，
不能重新标记为 Apache-2.0。详见[许可说明](docs/licensing.md)。
