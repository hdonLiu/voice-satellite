# ATK-DNESP32S3 board adapter

This adapter owns the ATK-DNESP32S3-specific ES8388, ST7789, XL9555, key, and
LED wiring. Shared audio, state, storage, TLS, and Device Link code imports only
`vs_board.h`.

| Function    | Pin / value    |
| ----------- | -------------- |
| I2S MCLK    | GPIO 3         |
| I2S WS      | GPIO 9         |
| I2S BCLK    | GPIO 46        |
| I2S ADC IN  | GPIO 14        |
| I2S DAC OUT | GPIO 10        |
| I2C SDA     | GPIO 41        |
| I2C SCL     | GPIO 42        |
| ES8388      | I2C `0x10`     |
| BOOT key    | GPIO 0         |
| Status LED  | GPIO 1         |
| LCD SCLK    | GPIO 12        |
| LCD MOSI    | GPIO 11        |
| LCD DC      | GPIO 40        |
| LCD CS      | GPIO 21        |
| LCD panel   | ST7789 320x240 |
| IO expander | XL9555 `0x20`  |

The codec/I2S clock runs at 24 kHz. Capture converts 480 native samples into a
320-sample, 16 kHz Device Link frame; playback consumes native 480-sample,
24 kHz frames. Codec configuration follows the board pin definition and ES8388
initialization used by the upstream ATK board integration.

LCD reset and backlight are controlled by XL9555 outputs 8 and 2. The display
uses SPI2 at 20 MHz and mirrors/swaps the panel exactly as the upstream ATK
integration does.

Hardware sources:

- [ALIENTEK board examples](https://github.com/openedv/ATK-DNESP32S3-Board)
- [ATK board integration pin definition](https://github.com/78/xiaozhi-esp32/blob/v2.4.2/main/boards/alientek/atk-dnesp32s3/config.h)
