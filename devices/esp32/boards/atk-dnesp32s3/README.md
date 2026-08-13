# ATK-DNESP32S3 board adapter

This adapter owns the ATK-DNESP32S3-specific ES8388, key, and LED wiring. Shared
audio, state, storage, TLS, and Device Link code imports only `vs_board.h`.

| Function    | Pin / value |
| ----------- | ----------- |
| I2S MCLK    | GPIO 3      |
| I2S WS      | GPIO 9      |
| I2S BCLK    | GPIO 46     |
| I2S ADC IN  | GPIO 14     |
| I2S DAC OUT | GPIO 10     |
| I2C SDA     | GPIO 41     |
| I2C SCL     | GPIO 42     |
| ES8388      | I2C `0x10`  |
| BOOT key    | GPIO 0      |
| Status LED  | GPIO 1      |

The codec/I2S clock runs at 24 kHz. Capture converts 480 native samples into a
320-sample, 16 kHz Device Link frame; playback consumes native 480-sample,
24 kHz frames. Codec configuration follows the board pin definition and ES8388
initialization used by the upstream ATK board integration.

Hardware sources:

- [ALIENTEK board examples](https://github.com/openedv/ATK-DNESP32S3-Board)
- [ATK board integration pin definition](https://github.com/78/xiaozhi-esp32/blob/v2.4.2/main/boards/alientek/atk-dnesp32s3/config.h)
