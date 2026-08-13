# Voice Satellite 任务级执行计划

- 状态：Draft
- 日期：2026-08-13
- 依据：[详细技术设计](../design/detailed-design.zh-CN.md)

本文用于实际排期和领取任务。阶段级目标仍以
[Implementation Plan](implementation-plan.md) 为准；这里把每个阶段拆成有明确
依赖、产物和完成定义的工作项。

## 1. 执行原则

1. P0 是阻塞性验证，不通过就修改 ADR，不带着未经验证的假设进入实现。
2. P1 冻结协议和核心 Port；P1 之前允许重命名，之后必须走兼容性流程。
3. P2 必须先用 Fake 端到端跑通，真实硬件和云 Adapter 不直接驱动核心设计。
4. 每条真实轨道必须通过与 Fake 相同的 contract test。
5. 每个阶段只在 Exit Gate 全部满足后进入下一集成阶段。
6. 不自动重放 accepted 后状态不确定的 Agent 请求。
7. 一个 Connector 只构造一个 AgentRuntime，不实现多 Agent registry。
8. 可替换性不等于 Relay 扩容；v1 不引入分布式 Turn 状态或集群路由。

## 2. 轨道与任务前缀

| 前缀  | 轨道                          |
| ----- | ----------------------------- |
| `ARC` | 架构、ADR、协议决策           |
| `REP` | 仓库、工具链、CI、开源治理    |
| `DEV` | Device Link 和跨设备 contract |
| `ESP` | ESP32 shared firmware         |
| `ATK` | ATK-DNESP32S3 board adapter   |
| `REL` | Relay 核心与网关              |
| `SPH` | ASR/TTS 与文本音频管线        |
| `CON` | Connector 核心与本地服务      |
| `OCA` | OpenClaw AgentRuntime Adapter |
| `SEC` | 安全、凭据和威胁建模          |
| `OPS` | 部署、可观测性和运行维护      |
| `TST` | Testkit、一致性、HIL 和稳定性 |
| `DOC` | 用户和开发者文档              |

## 3. P0：兼容性验证

### 3.1 任务

| ID        | 任务                               | 依赖                          | 产物                       | 验证                              |
| --------- | ---------------------------------- | ----------------------------- | -------------------------- | --------------------------------- |
| `ARC-001` | 建立 P0 决策日志和报告模板         | 无                            | `docs/adr` 模板、P0 report | 每个 pending design 有 owner/证据 |
| `ATK-001` | 确认板卡 revision 与权威资料       | 无                            | board inventory            | 照片、丝印、原理图相互对应        |
| `ATK-002` | 独立记录音频/屏幕/按键/PA 引脚     | `ATK-001`                     | wiring/resource table      | 无冲突且来源可追踪                |
| `ATK-003` | 验证 ES8388 寄存器和上电时序       | `ATK-002`                     | codec spike                | 冷启动 20 次成功                  |
| `ATK-004` | 验证麦克风 PCM 采集                | `ATK-003`                     | WAV、幅值/噪声数据         | 连续 10 分钟无 DMA error          |
| `ATK-005` | 验证扬声器 PCM 播放                | `ATK-003`                     | tone/voice playback        | 连续 10 分钟无 underrun/watchdog  |
| `ESP-001` | 建立 ESP-IDF/组件兼容矩阵          | `ATK-003`                     | version matrix             | 干净构建且音频 spike 可运行       |
| `ESP-002` | 验证 16/24/48 kHz 策略             | `ATK-004`,`ATK-005`           | audio ADR                  | 输入输出格式和回退确定            |
| `OCA-001` | 记录目标 OpenClaw/Node 版本        | 无                            | compatibility baseline     | `doctor`、Gateway、ACP 可启动     |
| `OCA-002` | 验证 ACP initialize/session/prompt | `OCA-001`                     | sanitized trace            | 可获得完整回答和流式事件          |
| `OCA-003` | 验证 ACP cancel/permission         | `OCA-002`                     | behavior matrix            | cancel/权限终态可解释             |
| `OCA-004` | 验证 ACP kill/restart/resume       | `OCA-002`                     | restart report             | 当前轮失败、下一轮可恢复          |
| `OCA-005` | 评估官方 ACP TypeScript SDK        | `OCA-002`                     | SDK ADR                    | 能覆盖目标方法或列出缺口          |
| `SPH-001` | 验证流式 ASR 输入/final/cancel     | 无                            | provider trace             | 16 kHz PCM、唯一 final、cancel    |
| `SPH-002` | 验证流式 TTS append/output/cancel  | 无                            | provider trace             | 24 kHz PCM、首包与 cancel         |
| `SPH-003` | 建立延迟基准                       | `SPH-001`,`SPH-002`,`OCA-002` | latency report             | 分阶段 P50/P95 可复现             |
| `SEC-001` | 检查 P0 trace 脱敏                 | 所有 P0 trace                 | sanitized fixtures         | 无 token、私有文本、路径          |

### 3.2 Gate G0

- `ATK-004` 和 `ATK-005` 通过。
- 固定候选 ESP-IDF、ESP-SR、codec 版本。
- ACP prompt、delta、cancel 和 restart 行为有真实 trace。
- ASR/TTS 真实流式接口和格式已验证。
- 关闭详细设计中的 D-01 至 D-08，或记录明确替代方案。

G0 不通过时不得开始协议冻结。

## 4. P1：仓库、领域与协议

### 4.1 仓库和 CI

| ID        | 任务                               | 依赖                | 产物                   | 验证                        |
| --------- | ---------------------------------- | ------------------- | ---------------------- | --------------------------- |
| `REP-001` | 初始化 pnpm workspace 和 Node 版本 | G0                  | workspace files        | clean install/build         |
| `REP-002` | 初始化 ESP-IDF shared project      | G0                  | `devices/esp32` build  | clean build PTT profile     |
| `REP-003` | 配置 lint/typecheck/unit CI        | `REP-001`,`REP-002` | GitHub Actions         | PR 上全部运行               |
| `REP-004` | 固定依赖和升级策略                 | `REP-001`,`REP-002` | locks、Renovate policy | CI 不使用 floating latest   |
| `REP-005` | 配置 SPDX/REUSE/license 检查       | `REP-003`           | license CI             | 错误许可证 fixture 可被拒绝 |

### 4.2 Domain 与 Port

| ID        | 任务                               | 依赖      | 产物                  | 验证                             |
| --------- | ---------------------------------- | --------- | --------------------- | -------------------------------- |
| `ARC-010` | 定义 ID/value objects              | G0        | contracts/domain docs | 无 MAC/板型/native session 泄漏  |
| `REL-010` | 实现 Turn 状态与 `finishOnce`      | `ARC-010` | domain module         | 全部合法/非法转换单测            |
| `REL-011` | 定义 speech/agent/device ports     | `ARC-010` | TypeScript ports      | Fake 可实现，核心无 SDK import   |
| `CON-010` | 定义 AgentRuntime/Binding ports    | `ARC-010` | Connector ports       | Fake 与 OpenClaw contract 相同   |
| `ESP-010` | 定义 DeviceController ports/events | `ARC-010` | C++ domain interfaces | host tests 不依赖 ESP-IDF handle |

### 4.3 Wire protocol

| ID        | 任务                                | 依赖                | 产物                         | 验证                             |
| --------- | ----------------------------------- | ------------------- | ---------------------------- | -------------------------------- |
| `DEV-010` | 冻结 Device hello payload           | G0,`ARC-010`        | schema + examples            | 业务字段仅 physicalApproval      |
| `DEV-011` | 冻结 Device control messages        | `DEV-010`,`REL-010` | schema + golden traces       | 状态/角色/size 测试              |
| `DEV-012` | 冻结 binary audio header            | `ESP-002`,`DEV-010` | byte layout + parser vectors | C++/TS cross-language round-trip |
| `CON-011` | 冻结 Connector hello/ready contract | `CON-010`           | schema + examples            | 无能力矩阵和 Agent 选择字段      |
| `CON-012` | 冻结 Agent command/events           | `CON-011`,`REL-011` | schema + golden traces       | request/turn 关联完整            |
| `CON-013` | 定义 accepted/unknown/replay 规则   | `CON-012`,`OCA-004` | spec tests                   | uncertain request 不重放         |
| `SEC-010` | 定义 credential audiences/scopes    | `DEV-010`,`CON-011` | auth ADR                     | 角色互换 token 被拒绝            |

### 4.4 Testkit

| ID        | 任务                       | 依赖                | 产物                  | 验证                         |
| --------- | -------------------------- | ------------------- | --------------------- | ---------------------------- |
| `TST-010` | Fake Device                | `DEV-011`,`DEV-012` | testkit adapter       | Device conformance 通过      |
| `TST-011` | Fake ASR/TTS               | `REL-011`           | deterministic streams | cancel/error/slow paths      |
| `TST-012` | Fake AgentRuntime          | `CON-010`           | deterministic runtime | Agent contract 通过          |
| `TST-013` | Fake Connector/Relay peers | `CON-012`           | protocol peers        | valid/invalid traces 可重放  |
| `TST-014` | Fake ACP executable        | `OCA-002`           | NDJSON child process  | malformed/exit/cancel 可控制 |

### 4.5 Gate G1

- 两条协议 Schema、二进制向量和 Golden Trace 全部通过。
- Domain 不依赖任何具体 Adapter。
- Device 协议不含 ESP32 特有字段。
- Connector 协议不含 OpenClaw、ACP 或 Agent 选择字段。
- Fake Device 和 Fake AgentRuntime 可分别运行 contract test。

## 5. P2：全 Fake 垂直切片

| ID        | 任务                             | 依赖                          | 产物                  | 验证                            |
| --------- | -------------------------------- | ----------------------------- | --------------------- | ------------------------------- |
| `REL-020` | Device WSS Gateway               | G1                            | authenticated gateway | hello/seq/size/role tests       |
| `REL-021` | Connector WSS Gateway            | G1                            | authenticated gateway | ready/heartbeat/reconnect tests |
| `REL-022` | ConnectionDirectory              | `REL-020`,`REL-021`           | in-memory routing     | stale connection 不可路由       |
| `REL-023` | TurnRegistry/Orchestrator        | `REL-010`,`REL-022`           | core flow             | 每设备一个 Turn、终态唯一       |
| `REL-024` | BoundedAsyncQueue/timeout policy | `REL-023`                     | core primitives       | full/cancel/close 单测          |
| `SPH-020` | SentenceSegmenter                | G1                            | segmenter             | 中英文/无标点/尾部 flush        |
| `CON-020` | Relay outbound client            | G1                            | reconnecting client   | heartbeat/backoff/jitter tests  |
| `CON-021` | SingleRuntimeHost/coordinator    | `CON-020`,`TST-012`           | request flow          | busy/cancel/terminal tests      |
| `CON-022` | Request dedupe TTL cache         | `CON-021`                     | bounded cache         | duplicate 不再次 prompt         |
| `TST-020` | 完整 Fake audio-to-audio 测试    | `REL-023`,`SPH-020`,`CON-021` | E2E suite             | 100 Turn 全通过                 |
| `TST-021` | 故障矩阵                         | `TST-020`                     | failure suite         | 每阶段断线/取消/迟到事件        |

### Gate G2

- Fake Device → Relay → Fake ASR → Fake Agent → Fake TTS → Fake Device 闭环。
- 100 Turn 无未释放对象、重复执行、取消后输出和无界增长。
- accepted 后断线得到 `execution_unknown` 且不重放。
- 核心 Port 在此 Gate 后冻结。

## 6. P3：真实 Adapter 并行

### 6.1 ESP32 与 ATK board

| ID        | 任务                      | 依赖                          | 产物            | 验证                           |
| --------- | ------------------------- | ----------------------------- | --------------- | ------------------------------ |
| `ATK-030` | board adapter 骨架        | G2,`ATK-002`                  | board component | shared component 无板头依赖    |
| `ATK-031` | ES8388/PA 驱动接入        | `ATK-030`,`ATK-003`           | codec adapter   | 冷启动、mute、volume tests     |
| `ESP-030` | AudioCapture/ring         | `ATK-031`,`ESP-002`           | 16 kHz frames   | 30 分钟、无 DMA overflow       |
| `ESP-031` | AudioPlayback/jitter ring | `ATK-031`,`ESP-002`           | 24 kHz playback | 30 分钟、underrun 可控         |
| `ESP-032` | DeviceController/PTT      | `ESP-010`,`ESP-030`,`ESP-031` | PTT state flow  | 100 本地循环                   |
| `ESP-033` | Device Link transport     | `DEV-011`,`DEV-012`,`ESP-032` | WSS client      | Fake Relay conformance         |
| `ESP-034` | NVS versioned config      | `ESP-032`                     | storage adapter | migrate/corrupt/recovery tests |
| `ESP-035` | 最小状态 UI               | `ESP-032`,`ATK-030`           | UI adapter      | headless 时核心仍通过          |

### 6.2 真实 speech adapters

| ID        | 任务                           | 依赖                | 产物             | 验证                 |
| --------- | ------------------------------ | ------------------- | ---------------- | -------------------- |
| `SPH-030` | 首个 Streaming ASR Adapter     | G2,`SPH-001`        | provider adapter | speech contract test |
| `SPH-031` | 首个 Streaming TTS Adapter     | G2,`SPH-002`        | provider adapter | speech contract test |
| `SPH-032` | Provider error/timeout mapping | `SPH-030`,`SPH-031` | stable errors    | 故障注入             |
| `SPH-033` | 真实断句参数调优               | `SPH-020`,`SPH-031` | benchmark/config | 首包与自然度报告     |

### 6.3 Connector 与 OpenClaw

| ID        | 任务                        | 依赖                | 产物               | 验证                           |
| --------- | --------------------------- | ------------------- | ------------------ | ------------------------------ |
| `CON-030` | SessionBindingStore         | G2                  | atomic local store | 权限、crash、migrate tests     |
| `CON-031` | Runtime process supervisor  | G2,`TST-014`        | supervisor         | exit/backoff/shutdown tests    |
| `OCA-030` | ACP transport/initialize    | `CON-031`,`OCA-005` | OpenClaw adapter   | Fake ACP + real smoke          |
| `OCA-031` | session open/resume binding | `OCA-030`,`CON-030` | session mapper     | 三轮上下文和 restart           |
| `OCA-032` | prompt/delta/done mapping   | `OCA-031`           | runtime events     | monotonic delta contract       |
| `OCA-033` | cancel/permission mapping   | `OCA-032`,`OCA-003` | runtime operations | cancel/deny/timeout            |
| `OCA-034` | safe event filtering        | `OCA-032`           | sanitizer          | path/secret/tool JSON fixtures |
| `CON-032` | service config/doctor       | `OCA-030`,`CON-020` | CLI checks         | Relay/Gateway/ACP diagnosis    |

### Gate G3

- ESP32 通过与 Fake Device 相同的 Device Link conformance。
- ASR/TTS 通过 Fake 与真实 provider contract tests。
- OpenClaw 通过与 Fake AgentRuntime 相同的 contract test。
- 任一真实 Adapter 故障不会污染核心状态或泄漏原生错误对象。

## 7. P4：真实端到端与 v0.1.0

| ID        | 任务                           | 依赖                          | 产物               | 验证                          |
| --------- | ------------------------------ | ----------------------------- | ------------------ | ----------------------------- |
| `REL-040` | 真实 Adapter composition       | G3                            | runnable Relay     | config validation/health      |
| `CON-040` | OpenClaw Connector composition | G3                            | runnable Connector | 单 Agent、出站连接            |
| `ESP-040` | 真实 Relay 配置和 TLS          | G3                            | PTT firmware       | 错证书/token 必须失败         |
| `TST-040` | 单轮真实 E2E                   | `REL-040`,`CON-040`,`ESP-040` | test report        | 20 连续成功                   |
| `TST-041` | 三轮上下文 E2E                 | `TST-040`                     | trace              | 上下文保持，无 native ID 泄漏 |
| `TST-042` | 全阶段 cancel E2E              | `TST-040`                     | cancel matrix      | 本地播放 300 ms 内停止        |
| `TST-043` | 重连与旧音频隔离               | `TST-040`                     | failure report     | 旧 stream 不进入新 Turn       |
| `OPS-040` | 延迟与水位指标                 | `TST-040`                     | P50/P95 dashboard  | 可定位 ASR/Agent/TTS 延迟     |
| `REP-040` | 发布 v0.1.0                    | 所有 P4                       | signed prerelease  | 文档、checksum、known issues  |

### Gate G4

- 50 次真实 Turn，三轮上下文，流式分句播放。
- 各阶段取消正确，断线后无旧音频。
- OpenClaw 不开放公网端口，凭据不进入 Relay/设备。

## 8. P5：WakeNet、UI 与权限

| ID        | 任务                          | 依赖                | 产物                     | 验证                         |
| --------- | ----------------------------- | ------------------- | ------------------------ | ---------------------------- |
| `ESP-050` | PTT/WakeNet/headless profiles | G4                  | three builds             | PTT 不链接 ESP-SR            |
| `ESP-051` | ESP-SR WakeDetector adapter   | `ESP-050`           | wake adapter             | 仅 IDLE 运行                 |
| `ESP-052` | VAD/pre-roll/endpointer       | `ESP-051`           | input controller         | 首尾字声学测试               |
| `ESP-053` | 完整状态和文本 UI             | `ESP-035`,G4        | ViewModel UI             | 文本上限和刷新率测试         |
| `REL-050` | permission lifecycle          | G4                  | structured request state | stale/duplicate/timeout deny |
| `CON-050` | Agent permission bridge       | `OCA-033`,`REL-050` | permission events        | 原始 tool args 不出本机      |
| `ESP-054` | 实体键审批                    | `REL-050`,`ESP-053` | allow/deny UI            | 一次性且超时默认拒绝         |
| `TST-050` | 声学基准                      | `ESP-052`           | wake/VAD report          | 达到计划目标或记录调整       |
| `REP-050` | 发布 v0.2.0                   | 所有 P5             | prerelease               | profile/license 完整         |

## 9. P6：安全、运维与稳定性

| ID        | 任务                                 | 依赖                | 产物                    | 验证                       |
| --------- | ------------------------------------ | ------------------- | ----------------------- | -------------------------- |
| `SEC-060` | 完整 threat model                    | G4                  | threat model            | 信任边界/滥用场景/控制措施 |
| `SEC-061` | token 生命周期与轮换                 | `SEC-010`,`SEC-060` | auth implementation     | revoke/rotate/role tests   |
| `SEC-062` | 日志与指标脱敏审计                   | G4                  | redaction tests         | secret fixtures 全部拦截   |
| `OPS-060` | Relay health/ready/graceful shutdown | G4                  | ops endpoints           | shutdown 不接新 Turn       |
| `OPS-061` | Docker/Compose/TLS                   | `OPS-060`           | deploy templates        | 全新 VPS smoke test        |
| `OPS-062` | Connector system services            | `CON-032`           | launchd/systemd/Windows | reboot auto-start tests    |
| `ESP-060` | watchdog/safe mode/crash summary     | G4                  | diagnostics             | fault injection            |
| `ESP-061` | signed dual-slot OTA/rollback        | `ESP-060`           | OTA implementation      | 断电/坏签名/坏固件         |
| `ESP-062` | optional production security profile | `ESP-061`           | secure build            | boot/flash/NVS validation  |
| `TST-060` | 8 小时 soak                          | 所有 P6 runtime     | report                  | 无 crash/deadlock/增长     |
| `TST-061` | 500 Turn stress                      | 所有 P6 runtime     | report                  | 无串线/残留/旧音频         |
| `TST-062` | 协议 fuzz/oversize                   | `SEC-060`           | security suite          | 无 crash/越界/秘密泄漏     |
| `REP-060` | 发布 v0.9.0-rc.1                     | Gate G6             | RC artifacts            | SBOM/签名/known issues     |

### Gate G6

- 8 小时和 500 Turn 通过。
- OTA 可回滚，非法输入不崩溃。
- 日志、指标、错误响应无秘密或私有内容。
- Connector 安装后重启自动恢复，当前不确定请求不重放。

## 10. P7：开源 v1.0

| ID        | 任务                          | 依赖                | 产物                    | 验证                             |
| --------- | ----------------------------- | ------------------- | ----------------------- | -------------------------------- |
| `TST-070` | 最终 Device/Agent conformance | G6                  | public suite            | Fake 与真实 Adapter 全通过       |
| `TST-071` | 硬件在环自动化                | G6                  | HIL workflow            | build/flash/serial/result 自动化 |
| `DOC-070` | 开发者构建文档                | G6                  | build guides            | clean machine 复现               |
| `DOC-071` | 用户部署/恢复文档             | G6                  | deploy/recovery guides  | 新用户照文档跑通                 |
| `DOC-072` | 新 Device 实现指南            | `TST-070`           | adapter guide           | Fake second device 示例          |
| `DOC-073` | 新 AgentRuntime 指南          | `TST-070`           | adapter guide           | Fake replacement Agent 示例      |
| `REP-070` | 生成 Node/firmware SBOM       | G6                  | SPDX files              | 与 locks/artifacts 一致          |
| `REP-071` | license/provenance review     | `REP-070`           | review report           | PTT 无 ESP-SR，WakeNet 条款完整  |
| `SEC-070` | 发布前安全检查                | `SEC-060`,`TST-062` | security sign-off       | 无未处置高危项                   |
| `REP-072` | 签名 v1.0 制品                | 所有 P7             | firmware/image/binaries | checksum/signature 验证          |
| `REP-073` | 发布 v1.0                     | `REP-072`           | GitHub Release          | release checklist 完整           |

### Gate G7 / v1.0 DoD

- 全新用户可以仅按公开文档构建、刷写、部署、连接和恢复。
- ESP32、Fake Device 均通过 Device Link conformance。
- OpenClaw、Fake AgentRuntime 均通过 AgentRuntime contract。
- 替换 Device 不修改 Relay/Connector；替换 Agent 不修改 Relay/两条 Wire Link。
- 一个 Connector 始终只有一个 AgentRuntime，没有远端 Agent 选择。
- 安全、稳定性、许可证、SBOM、签名和校验值全部完成。

## 11. 推荐排期

### 单人

```text
第 1–2 周    P0
第 3–4 周    P1
第 5–6 周    P2
第 7–11 周   P3
第 12–13 周  P4 / v0.1.0
第 14–15 周  P5 / v0.2.0
第 16–18 周  P6 / RC
第 19–20 周  P7 / v1.0
```

### 三轨并行

```text
共同：P0 -> P1 -> P2

轨道 A：ATK/ESP32              ATK-030 ... ESP-035
轨道 B：Relay/Speech           REL-020 ... SPH-033
轨道 C：Connector/OpenClaw     CON-020 ... OCA-034

共同：G3 -> P4 -> P5/P6 可局部并行 -> P7
```

并行开发期间不得跳过 G1、G2、G3、G4 和 G6 集成门禁。

## 12. 第一批可立即执行的任务

建议从以下顺序开始：

1. `ARC-001`：创建 P0 报告和 ADR 模板。
2. `ATK-001`、`ATK-002`：核实当前实物 revision 和板级资源。
3. `OCA-001`：在另一台电脑记录 OpenClaw/Node/Gateway 基线。
4. `SPH-001`、`SPH-002`：确定首个 ASR/TTS Provider 和账号环境。
5. `ATK-003` 至 `ATK-005`：建立最小音频 spike。
6. `OCA-002` 至 `OCA-005`：ACP compatibility spike。
7. 汇总 G0，关闭 D-01 至 D-08 后再开始 P1。
