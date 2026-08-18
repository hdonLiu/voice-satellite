# ESP32 device implementation

This is the first Device Link reference firmware. It is an independent ESP-IDF
project and contains no XiaoZhi networking, protocol, or agent code.

Implemented components:

```text
main/                  Device state machine and composition
components/vs_audio/   24 kHz codec I/O, 16 kHz capture conversion, bounded playback
components/vs_board/   Board port; selects boards/atk-dnesp32s3
components/vs_protocol Device Link JSON and VSA1 binary audio codec
components/vs_storage/ Versioned NVS-owned configuration namespace
components/vs_transport Wi-Fi, TLS verification, authenticated WebSocket
components/vs_wake/    Optional ESP-SR WakeNet detector
boards/atk-dnesp32s3/  ES8388 audio and ST7789 display implementation
```

The default `ptt` profile uses the BOOT key: hold to speak and release to end
input. During a permission request, pressing BOOT allows the operation; not
pressing it causes Relay's approval deadline to deny it. Pressing BOOT during
playback cancels the turn. The `wakenet` profile runs WakeNet only while idle and
uses local energy endpointing after detection. Both profiles speak identical
Device Link v1 messages.

The 320x240 display shows link/turn state and the latest
`transcript.final`. The built-in LVGL Source Han Sans SC font covers 1,338
common CJK characters. Unsupported uncommon glyphs fall back to a missing-glyph
marker; dynamic server-pushed glyphs are intentionally deferred until the
speech path is proven.

## Configure and build

Install ESP-IDF 5.5.2 or 6.0.x, then:

```bash
cd devices/esp32
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
```

PTT does not resolve or link ESP-SR. To build WakeNet, select the separate
component profile and sdkconfig overlay:

```bash
idf.py -D VS_FIRMWARE_PROFILE=wakenet \
  -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;profiles/wakenet/sdkconfig.defaults' \
  reconfigure build
```

Set these under **Voice Satellite** before building:

- Wi-Fi SSID and password
- `wss://.../v1/device` Relay URL
- per-device bearer token
- PTT or WakeNet input profile

If Relay URL/token are absent at first boot, the device shows `Provisioning`
and emits `VS_PROVISION_READY` on the 115200-baud console. Send exactly one JSON
line:

```json
{
  "wifiSsid": "your-wifi",
  "wifiPassword": "your-wifi-password",
  "relayUrl": "wss://relay.example/v1/device",
  "deviceToken": "per-device-token"
}
```

`wifiSsid` is required when no Wi-Fi SSID was compiled into the firmware or
already stored in `vs_config`; `wifiPassword` may be empty for an open network.
The firmware does not depend on another application's private NVS layout or
assume that the ESP-IDF Wi-Fi driver retained usable credentials. Provisioning
is accepted only while required configuration is missing and is then persisted
in `vs_config`.

For production provisioning, write the same fields into NVS namespace
`vs_config` with keys `wifi_ssid`, `wifi_pass`, `relay_url`, and `device_token`.
NVS values override compile-time fallbacks. `ws://` is rejected unless the
explicit local-development option is enabled.

Flashing is intentionally a separate operator step:

```bash
idf.py -p /dev/your-port flash monitor
```

The project does not erase or flash a connected board automatically.
