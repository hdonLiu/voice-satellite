idf_component_register(
  SRCS "app_main.c" "vs_device.c"
  INCLUDE_DIRS "."
  PRIV_REQUIRES
    app_update
    esp_event
    esp_netif
    esp_wifi
    nvs_flash
    vs_audio
    vs_board
    vs_protocol
    vs_storage
    vs_transport
    vs_wake
)
