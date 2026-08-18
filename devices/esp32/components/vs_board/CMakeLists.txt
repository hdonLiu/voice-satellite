idf_component_register(
  SRCS
    "../../boards/atk-dnesp32s3/board.c"
    "../../boards/atk-dnesp32s3/fonts/vs_font_cjk_16.c"
    "../../boards/atk-dnesp32s3/fonts/vs_font_ui_22.c"
  INCLUDE_DIRS "include" "../../boards/atk-dnesp32s3"
  REQUIRES driver esp_lcd esp_lvgl_port lvgl espressif__esp_codec_dev
)
