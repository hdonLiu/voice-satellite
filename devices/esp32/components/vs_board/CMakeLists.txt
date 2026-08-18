idf_component_register(
  SRCS "../../boards/atk-dnesp32s3/board.c"
  INCLUDE_DIRS "include" "../../boards/atk-dnesp32s3"
  REQUIRES driver esp_lcd esp_lvgl_port lvgl espressif__esp_codec_dev
)
