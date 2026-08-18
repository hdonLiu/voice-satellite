#pragma once

#include "driver/gpio.h"

#define ATK_I2S_MCLK GPIO_NUM_3
#define ATK_I2S_WS GPIO_NUM_9
#define ATK_I2S_BCLK GPIO_NUM_46
#define ATK_I2S_DIN GPIO_NUM_14
#define ATK_I2S_DOUT GPIO_NUM_10
#define ATK_I2C_SDA GPIO_NUM_41
#define ATK_I2C_SCL GPIO_NUM_42
// esp_codec_dev accepts the ES8388 8-bit control address and converts it to
// the 7-bit I2C address (0x10) when using ESP-IDF's new I2C master driver.
#define ATK_ES8388_CODEC_ADDR 0x20
#define ATK_BOOT_BUTTON GPIO_NUM_0
#define ATK_STATUS_LED GPIO_NUM_1

#define ATK_LCD_SCLK GPIO_NUM_12
#define ATK_LCD_MOSI GPIO_NUM_11
#define ATK_LCD_DC GPIO_NUM_40
#define ATK_LCD_CS GPIO_NUM_21

#define ATK_LCD_WIDTH 320
#define ATK_LCD_HEIGHT 240

#define ATK_XL9555_ADDR 0x20
#define ATK_XL9555_LCD_RESET 8
#define ATK_XL9555_LCD_BACKLIGHT 2
