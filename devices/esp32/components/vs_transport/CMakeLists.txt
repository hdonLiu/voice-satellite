idf_component_register(
  SRCS "vs_transport.c"
  INCLUDE_DIRS "include"
  REQUIRES esp_event esp_netif esp_wifi espressif__esp_websocket_client mbedtls
)
