#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    VS_TRANSPORT_CONNECTED,
    VS_TRANSPORT_DISCONNECTED,
    VS_TRANSPORT_TEXT,
    VS_TRANSPORT_BINARY,
    VS_TRANSPORT_ERROR,
} vs_transport_event_type_t;

typedef struct {
    vs_transport_event_type_t type;
    const uint8_t *data;
    size_t size;
} vs_transport_event_t;

typedef void (*vs_transport_callback_t)(const vs_transport_event_t *event, void *context);

esp_err_t vs_transport_wifi_connect(const char *ssid, const char *password, uint32_t timeout_ms);
esp_err_t vs_transport_start(const char *url, const char *token,
                             vs_transport_callback_t callback, void *context);
esp_err_t vs_transport_send_text(const char *text);
esp_err_t vs_transport_send_binary(const uint8_t *data, size_t size);
bool vs_transport_connected(void);
void vs_transport_stop(void);

#ifdef __cplusplus
}
#endif
