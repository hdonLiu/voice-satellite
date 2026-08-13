#include "vs_board.h"

#include <assert.h>
#include "board.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "vs_board_atk";
static i2c_master_bus_handle_t i2c_bus;
static i2s_chan_handle_t tx_channel;
static i2s_chan_handle_t rx_channel;
static const audio_codec_data_if_t *data_if;
static const audio_codec_ctrl_if_t *ctrl_if;
static const audio_codec_gpio_if_t *gpio_if;
static const audio_codec_if_t *codec_if;
static esp_codec_dev_handle_t input_device;
static esp_codec_dev_handle_t output_device;
static QueueHandle_t button_queue;
static vs_board_button_callback_t button_callback;
static void *button_context;

static void IRAM_ATTR button_isr(void *context) {
    (void)context;
    bool pressed = gpio_get_level(ATK_BOOT_BUTTON) == 0;
    BaseType_t wake = pdFALSE;
    xQueueSendFromISR(button_queue, &pressed, &wake);
    if (wake) portYIELD_FROM_ISR();
}

static void button_task(void *context) {
    (void)context;
    bool pressed;
    while (xQueueReceive(button_queue, &pressed, portMAX_DELAY) == pdTRUE) {
        vTaskDelay(pdMS_TO_TICKS(25));
        if ((gpio_get_level(ATK_BOOT_BUTTON) == 0) == pressed && button_callback)
            button_callback(pressed, button_context);
    }
}

static esp_err_t initialize_i2c(void) {
    const i2c_master_bus_config_t config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = ATK_I2C_SDA,
        .scl_io_num = ATK_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    return i2c_new_master_bus(&config, &i2c_bus);
}

static esp_err_t initialize_i2s(void) {
    const i2s_chan_config_t channel_config = {
        .id = I2S_NUM_0,
        .role = I2S_ROLE_MASTER,
        .dma_desc_num = 6,
        .dma_frame_num = 240,
        .auto_clear_after_cb = true,
        .auto_clear_before_cb = false,
        .intr_priority = 0,
    };
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel_config, &tx_channel, &rx_channel), TAG, "i2s channels");
    const i2s_std_config_t config = {
        .clk_cfg = {
            .sample_rate_hz = VS_BOARD_PLAYBACK_RATE_HZ,
            .clk_src = I2S_CLK_SRC_DEFAULT,
            .ext_clk_freq_hz = 0,
            .mclk_multiple = I2S_MCLK_MULTIPLE_256,
        },
        .slot_cfg = {
            .data_bit_width = I2S_DATA_BIT_WIDTH_16BIT,
            .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO,
            .slot_mode = I2S_SLOT_MODE_STEREO,
            .slot_mask = I2S_STD_SLOT_BOTH,
            .ws_width = 16,
            .ws_pol = false,
            .bit_shift = true,
            .left_align = true,
            .big_endian = false,
            .bit_order_lsb = false,
        },
        .gpio_cfg = {
            .mclk = ATK_I2S_MCLK,
            .bclk = ATK_I2S_BCLK,
            .ws = ATK_I2S_WS,
            .dout = ATK_I2S_DOUT,
            .din = ATK_I2S_DIN,
        },
    };
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(tx_channel, &config), TAG, "i2s tx mode");
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(rx_channel, &config), TAG, "i2s rx mode");
    ESP_RETURN_ON_ERROR(i2s_channel_enable(tx_channel), TAG, "i2s tx enable");
    return i2s_channel_enable(rx_channel);
}

static esp_err_t initialize_codec(void) {
    const audio_codec_i2s_cfg_t i2s_config = {
        .port = I2S_NUM_0,
        .rx_handle = rx_channel,
        .tx_handle = tx_channel,
    };
    data_if = audio_codec_new_i2s_data(&i2s_config);
    const audio_codec_i2c_cfg_t i2c_config = {
        .port = I2C_NUM_0,
        .addr = ATK_ES8388_ADDR,
        .bus_handle = i2c_bus,
    };
    ctrl_if = audio_codec_new_i2c_ctrl(&i2c_config);
    gpio_if = audio_codec_new_gpio();
    if (!data_if || !ctrl_if || !gpio_if) return ESP_ERR_NO_MEM;
    es8388_codec_cfg_t codec_config = {
        .ctrl_if = ctrl_if,
        .gpio_if = gpio_if,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
        .master_mode = true,
        .pa_pin = GPIO_NUM_NC,
        .pa_reverted = false,
        .hw_gain = {.pa_voltage = 5.0, .codec_dac_voltage = 3.3},
    };
    codec_if = es8388_codec_new(&codec_config);
    if (!codec_if) return ESP_ERR_NOT_FOUND;
    const esp_codec_dev_cfg_t input_config = {
        .dev_type = ESP_CODEC_DEV_TYPE_IN,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    const esp_codec_dev_cfg_t output_config = {
        .dev_type = ESP_CODEC_DEV_TYPE_OUT,
        .codec_if = codec_if,
        .data_if = data_if,
    };
    input_device = esp_codec_dev_new(&input_config);
    output_device = esp_codec_dev_new(&output_config);
    if (!input_device || !output_device) return ESP_ERR_NO_MEM;
    esp_codec_set_disable_when_closed(input_device, false);
    esp_codec_set_disable_when_closed(output_device, false);
    const esp_codec_dev_sample_info_t format = {
        .bits_per_sample = 16,
        .channel = 1,
        .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0),
        .sample_rate = VS_BOARD_CAPTURE_RATE_HZ,
        .mclk_multiple = 0,
    };
    ESP_RETURN_ON_ERROR(esp_codec_dev_open(input_device, &format), TAG, "codec input");
    ESP_RETURN_ON_ERROR(esp_codec_dev_open(output_device, &format), TAG, "codec output");
    ESP_RETURN_ON_ERROR(esp_codec_dev_set_in_gain(input_device, 24), TAG, "input gain");
    uint8_t analog_volume = 30;
    const uint8_t registers[] = {46, 47, 48, 49};
    for (size_t i = 0; i < sizeof(registers); ++i)
        ctrl_if->write_reg(ctrl_if, registers[i], 1, &analog_volume, 1);
    ESP_RETURN_ON_ERROR(esp_codec_dev_set_out_vol(output_device, CONFIG_VS_OUTPUT_VOLUME), TAG, "output volume");
    return esp_codec_dev_set_out_mute(output_device, true);
}

esp_err_t vs_board_init(vs_board_button_callback_t callback, void *context) {
    button_callback = callback;
    button_context = context;
    gpio_config_t output = {
        .pin_bit_mask = 1ULL << ATK_STATUS_LED,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&output));
    gpio_config_t button = {
        .pin_bit_mask = 1ULL << ATK_BOOT_BUTTON,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .intr_type = GPIO_INTR_ANYEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&button));
    button_queue = xQueueCreate(8, sizeof(bool));
    if (!button_queue) return ESP_ERR_NO_MEM;
    ESP_ERROR_CHECK(gpio_install_isr_service(ESP_INTR_FLAG_IRAM));
    ESP_ERROR_CHECK(gpio_isr_handler_add(ATK_BOOT_BUTTON, button_isr, NULL));
    xTaskCreate(button_task, "vs_button", 2048, NULL, 8, NULL);
    ESP_RETURN_ON_ERROR(initialize_i2c(), TAG, "i2c");
    ESP_RETURN_ON_ERROR(initialize_i2s(), TAG, "i2s");
    ESP_RETURN_ON_ERROR(initialize_codec(), TAG, "es8388");
    ESP_LOGI(TAG, "ATK-DNESP32S3 audio board ready");
    return ESP_OK;
}

esp_err_t vs_board_audio_read(int16_t *samples, size_t count) {
    return esp_codec_dev_read(input_device, samples, count * sizeof(int16_t));
}

esp_err_t vs_board_audio_write(const int16_t *samples, size_t count) {
    return esp_codec_dev_write(output_device, (void *)samples, count * sizeof(int16_t));
}

esp_err_t vs_board_set_output(bool enabled) {
    return esp_codec_dev_set_out_mute(output_device, !enabled);
}

void vs_board_set_status(bool active) {
    gpio_set_level(ATK_STATUS_LED, active ? 1 : 0);
}
