#include "vs_board.h"

#include <assert.h>
#include <string.h>
#include "board.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/spi_master.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_check.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "esp_timer.h"
#include "fonts/fonts.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lvgl.h"

static const char *TAG = "vs_board_atk";
static i2c_master_bus_handle_t i2c_bus;
static i2c_master_dev_handle_t xl9555;
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
static lv_obj_t *display_title_label;
static lv_obj_t *display_card_title_label;
static lv_obj_t *display_transcript_label;
static lv_obj_t *display_wifi_dot;
static lv_obj_t *display_wifi_arcs[2];
static lv_obj_t *display_cloud_parts[4];
static lv_obj_t *display_mic_parts[7];
static lv_obj_t *display_orb;

#define DISPLAY_WAVE_BAR_COUNT 15
static lv_obj_t *display_wave_bars[DISPLAY_WAVE_BAR_COUNT];
static int64_t display_last_level_update_us;
static uint32_t display_smoothed_level;

static esp_err_t xl9555_write(uint8_t reg, uint8_t value) {
    const uint8_t data[] = {reg, value};
    return i2c_master_transmit(xl9555, data, sizeof(data), 1000);
}

static esp_err_t xl9555_read(uint8_t reg, uint8_t *value) {
    return i2c_master_transmit_receive(xl9555, &reg, 1, value, 1, 1000);
}

static esp_err_t xl9555_set_output(uint8_t bit, bool high) {
    uint8_t reg = bit < 8 ? 0x02 : 0x03;
    uint8_t shift = bit < 8 ? bit : bit - 8;
    uint8_t value = 0;
    ESP_RETURN_ON_ERROR(xl9555_read(reg, &value), TAG, "xl9555 read");
    value = high ? (value | (1U << shift)) : (value & ~(1U << shift));
    return xl9555_write(reg, value);
}

static esp_err_t initialize_xl9555(void) {
    const i2c_device_config_t config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = ATK_XL9555_ADDR,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(i2c_bus, &config, &xl9555), TAG,
                        "xl9555 device");
    ESP_RETURN_ON_ERROR(xl9555_write(0x06, 0x03), TAG, "xl9555 config 0");
    return xl9555_write(0x07, 0xF0);
}

static lv_obj_t *create_panel(lv_obj_t *parent) {
    lv_obj_t *panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    return panel;
}

static void style_dot(lv_obj_t *dot, uint32_t color) {
    lv_obj_set_style_bg_color(dot, lv_color_hex(color), 0);
    lv_obj_set_style_shadow_color(dot, lv_color_hex(color), 0);
    lv_obj_set_style_shadow_width(dot, 8, 0);
    lv_obj_set_style_shadow_opa(dot, LV_OPA_50, 0);
}

static void initialize_display_ui(void) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x050B16), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_set_style_text_font(screen, &vs_font_cjk_16, 0);

    lv_obj_t *input_chip = create_panel(screen);
    lv_obj_set_pos(input_chip, 8, 8);
    lv_obj_set_size(input_chip, 68, 28);
    lv_obj_set_style_bg_color(input_chip, lv_color_hex(0x0E1929), 0);
    lv_obj_set_style_radius(input_chip, 14, 0);
    lv_obj_set_style_border_width(input_chip, 1, 0);
    lv_obj_set_style_border_color(input_chip, lv_color_hex(0x1C2B41), 0);

    display_mic_parts[0] = create_panel(input_chip);
    lv_obj_set_pos(display_mic_parts[0], 11, 5);
    lv_obj_set_size(display_mic_parts[0], 8, 12);
    lv_obj_set_style_radius(display_mic_parts[0], LV_RADIUS_CIRCLE, 0);
    display_mic_parts[1] = create_panel(input_chip);
    lv_obj_set_pos(display_mic_parts[1], 14, 17);
    lv_obj_set_size(display_mic_parts[1], 2, 5);
    display_mic_parts[2] = create_panel(input_chip);
    lv_obj_set_pos(display_mic_parts[2], 10, 21);
    lv_obj_set_size(display_mic_parts[2], 10, 2);
    lv_obj_set_style_radius(display_mic_parts[2], LV_RADIUS_CIRCLE, 0);
    static const uint8_t mic_bar_heights[] = {4, 8, 12, 6};
    for (size_t i = 0; i < 4; ++i) {
        display_mic_parts[i + 3] = create_panel(input_chip);
        lv_obj_set_size(display_mic_parts[i + 3], 3, mic_bar_heights[i]);
        lv_obj_set_pos(display_mic_parts[i + 3], 31 + (int)i * 7,
                       14 - mic_bar_heights[i] / 2);
        lv_obj_set_style_radius(display_mic_parts[i + 3], LV_RADIUS_CIRCLE, 0);
    }

    static const int16_t wifi_sizes[][2] = {{26, 22}, {18, 14}};
    static const int16_t wifi_positions[][2] = {{250, 7}, {254, 12}};
    for (size_t i = 0; i < 2; ++i) {
        display_wifi_arcs[i] = lv_arc_create(screen);
        lv_obj_remove_style_all(display_wifi_arcs[i]);
        lv_obj_set_size(display_wifi_arcs[i], wifi_sizes[i][0], wifi_sizes[i][1]);
        lv_obj_set_pos(display_wifi_arcs[i], wifi_positions[i][0], wifi_positions[i][1]);
        lv_arc_set_bg_angles(display_wifi_arcs[i], 200, 340);
        lv_obj_set_style_arc_width(display_wifi_arcs[i], 2, LV_PART_MAIN);
        lv_obj_set_style_arc_rounded(display_wifi_arcs[i], true, LV_PART_MAIN);
        lv_obj_set_style_arc_opa(display_wifi_arcs[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_clear_flag(display_wifi_arcs[i], LV_OBJ_FLAG_CLICKABLE);
    }
    display_wifi_dot = create_panel(screen);
    lv_obj_set_size(display_wifi_dot, 5, 5);
    lv_obj_set_style_radius(display_wifi_dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_pos(display_wifi_dot, 260, 27);

    static const int16_t cloud_geometry[][4] = {
        {286, 16, 10, 10}, {293, 11, 14, 14}, {303, 17, 9, 9}, {287, 20, 25, 8},
    };
    for (size_t i = 0; i < 4; ++i) {
        display_cloud_parts[i] = create_panel(screen);
        lv_obj_set_pos(display_cloud_parts[i], cloud_geometry[i][0], cloud_geometry[i][1]);
        lv_obj_set_size(display_cloud_parts[i], cloud_geometry[i][2], cloud_geometry[i][3]);
        lv_obj_set_style_radius(display_cloud_parts[i], LV_RADIUS_CIRCLE, 0);
    }

    lv_obj_t *halo = create_panel(screen);
    lv_obj_set_size(halo, 80, 80);
    lv_obj_align(halo, LV_ALIGN_TOP_MID, 0, 38);
    lv_obj_set_style_bg_opa(halo, LV_OPA_TRANSP, 0);
    lv_obj_set_style_radius(halo, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(halo, 1, 0);
    lv_obj_set_style_border_color(halo, lv_color_hex(0x174A89), 0);
    lv_obj_set_style_border_opa(halo, LV_OPA_60, 0);

    display_orb = create_panel(screen);
    lv_obj_set_size(display_orb, 58, 58);
    lv_obj_align(display_orb, LV_ALIGN_TOP_MID, 0, 49);
    lv_obj_set_style_radius(display_orb, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(display_orb, lv_color_hex(0x0B3A70), 0);
    lv_obj_set_style_bg_grad_color(display_orb, lv_color_hex(0x137BDA), 0);
    lv_obj_set_style_bg_grad_dir(display_orb, LV_GRAD_DIR_VER, 0);
    lv_obj_set_style_border_width(display_orb, 2, 0);
    lv_obj_set_style_border_color(display_orb, lv_color_hex(0x52B8FF), 0);
    lv_obj_set_style_shadow_color(display_orb, lv_color_hex(0x1677FF), 0);
    lv_obj_set_style_shadow_width(display_orb, 18, 0);
    lv_obj_set_style_shadow_opa(display_orb, LV_OPA_50, 0);

    lv_obj_t *orb_label = lv_label_create(display_orb);
    lv_label_set_text(orb_label, "VOICE");
    lv_obj_set_style_text_color(orb_label, lv_color_white(), 0);
    lv_obj_center(orb_label);

    display_title_label = lv_label_create(screen);
    lv_label_set_text(display_title_label, "启动中");
    lv_obj_set_style_text_font(display_title_label, &vs_font_ui_22, 0);
    lv_obj_set_style_text_color(display_title_label, lv_color_white(), 0);
    lv_obj_set_width(display_title_label, ATK_LCD_WIDTH - 20);
    lv_obj_set_style_text_align(display_title_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(display_title_label, LV_ALIGN_TOP_MID, 0, 112);

    static const uint8_t initial_heights[DISPLAY_WAVE_BAR_COUNT] = {
        3, 5, 8, 12, 8, 6, 4, 7, 4, 6, 8, 12, 8, 5, 3,
    };
    const int bar_width = 5;
    const int bar_gap = 5;
    const int wave_width = DISPLAY_WAVE_BAR_COUNT * bar_width +
                           (DISPLAY_WAVE_BAR_COUNT - 1) * bar_gap;
    const int wave_left = (ATK_LCD_WIDTH - wave_width) / 2;
    for (size_t i = 0; i < DISPLAY_WAVE_BAR_COUNT; ++i) {
        lv_obj_t *bar = create_panel(screen);
        display_wave_bars[i] = bar;
        lv_obj_set_size(bar, bar_width, initial_heights[i]);
        lv_obj_set_pos(bar, wave_left + i * (bar_width + bar_gap),
                       147 - initial_heights[i] / 2);
        lv_obj_set_style_radius(bar, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(bar, lv_color_hex(0x318DFF), 0);
        lv_obj_set_style_bg_opa(bar, i == 0 || i == DISPLAY_WAVE_BAR_COUNT - 1
                                        ? LV_OPA_40
                                        : LV_OPA_COVER,
                                0);
    }

    lv_obj_t *transcript_card = create_panel(screen);
    lv_obj_set_pos(transcript_card, 9, 163);
    lv_obj_set_size(transcript_card, 302, 69);
    lv_obj_set_style_bg_color(transcript_card, lv_color_hex(0x0C1524), 0);
    lv_obj_set_style_radius(transcript_card, 18, 0);
    lv_obj_set_style_border_width(transcript_card, 1, 0);
    lv_obj_set_style_border_color(transcript_card, lv_color_hex(0x1B2B42), 0);

    display_card_title_label = lv_label_create(transcript_card);
    lv_label_set_text(display_card_title_label, "连接状态");
    lv_obj_set_style_text_color(display_card_title_label, lv_color_hex(0x3E9BFF), 0);
    lv_obj_set_pos(display_card_title_label, 14, 7);

    display_transcript_label = lv_label_create(transcript_card);
    lv_label_set_text(display_transcript_label, "正在准备设备…");
    lv_label_set_long_mode(display_transcript_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_size(display_transcript_label, 274, 36);
    lv_obj_set_style_text_color(display_transcript_label, lv_color_hex(0xF2F7FF), 0);
    lv_obj_set_style_text_line_space(display_transcript_label, 3, 0);
    lv_obj_set_pos(display_transcript_label, 14, 29);

    for (size_t i = 0; i < 7; ++i)
        lv_obj_set_style_bg_color(display_mic_parts[i], lv_color_hex(0x2F8CFF), 0);
    for (size_t i = 0; i < 2; ++i)
        lv_obj_set_style_arc_color(display_wifi_arcs[i], lv_color_hex(0x5C6B80), LV_PART_MAIN);
    style_dot(display_wifi_dot, 0x5C6B80);
    for (size_t i = 0; i < 4; ++i)
        lv_obj_set_style_bg_color(display_cloud_parts[i], lv_color_hex(0x5C6B80), 0);
}

static esp_err_t initialize_display(void) {
    const spi_bus_config_t bus = {
        .mosi_io_num = ATK_LCD_MOSI,
        .miso_io_num = GPIO_NUM_NC,
        .sclk_io_num = ATK_LCD_SCLK,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = ATK_LCD_WIDTH * 20 * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO), TAG,
                        "lcd spi bus");

    esp_lcd_panel_io_handle_t panel_io = NULL;
    const esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = ATK_LCD_CS,
        .dc_gpio_num = ATK_LCD_DC,
        .spi_mode = 0,
        .pclk_hz = 20 * 1000 * 1000,
        .trans_queue_depth = 7,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_config, &panel_io), TAG,
                        "lcd panel io");

    esp_lcd_panel_handle_t panel = NULL;
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = GPIO_NUM_NC,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_BIG,
        .bits_per_pixel = 16,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(panel_io, &panel_config, &panel), TAG,
                        "st7789 panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(panel), TAG, "lcd reset");
    ESP_RETURN_ON_ERROR(xl9555_set_output(ATK_XL9555_LCD_RESET, true), TAG,
                        "lcd release reset");
    ESP_RETURN_ON_ERROR(xl9555_set_output(ATK_XL9555_LCD_BACKLIGHT, false), TAG,
                        "lcd backlight");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), TAG, "lcd init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(panel, true), TAG, "lcd invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(panel, true), TAG, "lcd swap xy");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(panel, true, false), TAG, "lcd mirror");
    esp_err_t display_on = esp_lcd_panel_disp_on_off(panel, true);
    if (display_on != ESP_OK && display_on != ESP_ERR_NOT_SUPPORTED) return display_on;

    lv_init();
    lvgl_port_cfg_t port_config = ESP_LVGL_PORT_INIT_CONFIG();
    port_config.task_priority = 1;
    port_config.task_affinity = 1;
    ESP_RETURN_ON_ERROR(lvgl_port_init(&port_config), TAG, "lvgl port");
    const lvgl_port_display_cfg_t display_config = {
        .io_handle = panel_io,
        .panel_handle = panel,
        .buffer_size = ATK_LCD_WIDTH * 20,
        .double_buffer = false,
        .hres = ATK_LCD_WIDTH,
        .vres = ATK_LCD_HEIGHT,
        .monochrome = false,
        .rotation = {
            .swap_xy = true,
            .mirror_x = true,
            .mirror_y = false,
        },
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = {
            .buff_dma = true,
            .swap_bytes = true,
        },
    };
    if (!lvgl_port_add_disp(&display_config)) return ESP_FAIL;
    if (!lvgl_port_lock(1000)) return ESP_ERR_TIMEOUT;
    initialize_display_ui();
    lvgl_port_unlock();
    ESP_LOGI(TAG, "ATK-DNESP32S3 display ready");
    return ESP_OK;
}

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
        .addr = ATK_ES8388_CODEC_ADDR,
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
    ESP_RETURN_ON_ERROR(initialize_xl9555(), TAG, "xl9555");
    ESP_RETURN_ON_ERROR(initialize_display(), TAG, "display");
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

static void set_ui_accent(uint32_t color, uint32_t deep_color) {
    lv_obj_set_style_bg_color(display_orb, lv_color_hex(deep_color), 0);
    lv_obj_set_style_bg_grad_color(display_orb, lv_color_hex(color), 0);
    lv_obj_set_style_border_color(display_orb, lv_color_hex(color), 0);
    lv_obj_set_style_shadow_color(display_orb, lv_color_hex(color), 0);
    lv_obj_set_style_text_color(display_card_title_label, lv_color_hex(color), 0);
    for (size_t i = 0; i < 7; ++i)
        lv_obj_set_style_bg_color(display_mic_parts[i], lv_color_hex(color), 0);
    for (size_t i = 0; i < DISPLAY_WAVE_BAR_COUNT; ++i)
        lv_obj_set_style_bg_color(display_wave_bars[i], lv_color_hex(color), 0);
}

void vs_board_display_set_state(const char *state) {
    if (!display_title_label || !state || !lvgl_port_lock(100)) return;

    const char *title = "启动中";
    const char *card = "连接状态";
    uint32_t accent = 0x2F8CFF;
    uint32_t deep = 0x0B3A70;

    if (!strcmp(state, "Provisioning")) {
        title = "等待设备配置";
        accent = 0xFFAA33;
        deep = 0x6A3A08;
    } else if (!strcmp(state, "WiFiConnecting")) {
        title = "正在连接网络";
        accent = 0xFFAA33;
        deep = 0x6A3A08;
    } else if (!strcmp(state, "CloudConnecting")) {
        title = "正在连接云端";
        accent = 0xFFAA33;
        deep = 0x6A3A08;
    } else if (!strcmp(state, "Ready")) {
        title = "按住说话";
        card = "使用提示";
        accent = 0x39D98A;
        deep = 0x075A45;
    } else if (!strcmp(state, "WakeReady")) {
        title = "等待唤醒";
        card = "唤醒提示";
        accent = 0x39D98A;
        deep = 0x075A45;
    } else if (!strcmp(state, "Listening")) {
        title = "我在听…";
        card = "你说：";
    } else if (!strcmp(state, "Recognizing")) {
        title = "正在识别…";
        card = "你说：";
        accent = 0xFFB84D;
        deep = 0x6A3A08;
    } else if (!strcmp(state, "Forwarding")) {
        title = "正在转发…";
        card = "你说：";
        accent = 0x8C6CFF;
        deep = 0x35206E;
    } else if (!strcmp(state, "Recognized")) {
        title = "识别完成";
        card = "你说：";
        accent = 0x39D98A;
        deep = 0x075A45;
    } else if (!strcmp(state, "Speaking")) {
        title = "我在说…";
        card = "AI 回答：";
        accent = 0xB45CFF;
        deep = 0x4A176D;
    } else if (!strcmp(state, "Offline")) {
        title = "云端重连中";
        accent = 0xFFAA33;
        deep = 0x6A3A08;
    } else if (!strcmp(state, "Error")) {
        title = "连接失败";
        accent = 0xFF5D73;
        deep = 0x701C31;
    }

    lv_label_set_text(display_title_label, title);
    lv_label_set_text(display_card_title_label, card);
    set_ui_accent(accent, deep);
    lvgl_port_unlock();
}

void vs_board_display_set_transcript(const char *text) {
    if (!display_transcript_label || !text || !lvgl_port_lock(100)) return;
    lv_label_set_text(display_transcript_label, text);
    lvgl_port_unlock();
}

void vs_board_display_set_connectivity(bool wifi_connected, bool cloud_connected) {
    if (!display_wifi_arcs[0] || !lvgl_port_lock(100)) return;

    uint32_t wifi_color = wifi_connected ? 0x39D98A : 0xFFAA33;
    uint32_t cloud_color = cloud_connected ? 0x39D98A
                                           : (wifi_connected ? 0xFFAA33 : 0x5C6B80);
    for (size_t i = 0; i < 2; ++i)
        lv_obj_set_style_arc_color(display_wifi_arcs[i], lv_color_hex(wifi_color), LV_PART_MAIN);
    style_dot(display_wifi_dot, wifi_color);
    for (size_t i = 0; i < 4; ++i)
        lv_obj_set_style_bg_color(display_cloud_parts[i], lv_color_hex(cloud_color), 0);
    lvgl_port_unlock();
}

void vs_board_display_set_audio_level(uint32_t rms) {
    if (!display_wave_bars[0]) return;
    int64_t now = esp_timer_get_time();
    if (rms > 0 && now - display_last_level_update_us < 80000) return;
    display_last_level_update_us = now;
    display_smoothed_level = rms == 0 ? 0 : (display_smoothed_level * 2 + rms) / 3;
    uint32_t amplitude = display_smoothed_level * 18 / 3000;
    if (amplitude > 18) amplitude = 18;
    static const uint8_t weights[DISPLAY_WAVE_BAR_COUNT] = {
        2, 4, 6, 8, 6, 5, 7, 10, 7, 5, 6, 8, 6, 4, 2,
    };

    if (!lvgl_port_lock(5)) return;
    for (size_t i = 0; i < DISPLAY_WAVE_BAR_COUNT; ++i) {
        int height = 3 + (int)(amplitude * weights[i] / 10);
        lv_obj_set_height(display_wave_bars[i], height);
        lv_obj_set_y(display_wave_bars[i], 147 - height / 2);
    }
    lvgl_port_unlock();
}
