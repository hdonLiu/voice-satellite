#include "vs_transport.h"

#include <stdatomic.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include "esp_crt_bundle.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "vs_transport";
static const EventBits_t WIFI_READY = BIT0;
static const EventBits_t WIFI_FAILED = BIT1;
static EventGroupHandle_t wifi_events;
static esp_websocket_client_handle_t websocket;
static vs_transport_callback_t callback;
static void *callback_context;
static atomic_bool connected;

static void wifi_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(wifi_events, WIFI_READY);
    }
}

esp_err_t vs_transport_wifi_connect(const char *ssid, const char *password, uint32_t timeout_ms) {
    wifi_events = xEventGroupCreate();
    if (!wifi_events) return ESP_ERR_NO_MEM;
    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&init), TAG, "wifi init");
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_handler, NULL));
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "wifi mode");
    wifi_config_t config = {0};
    if (ssid && ssid[0]) {
        strlcpy((char *)config.sta.ssid, ssid, sizeof(config.sta.ssid));
        strlcpy((char *)config.sta.password, password ? password : "", sizeof(config.sta.password));
        config.sta.threshold.authmode = password && password[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
        config.sta.pmf_cfg.capable = true;
        ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &config), TAG, "wifi config");
    } else {
        ESP_RETURN_ON_ERROR(esp_wifi_get_config(WIFI_IF_STA, &config), TAG, "saved wifi config");
        if (!config.sta.ssid[0]) return ESP_ERR_INVALID_STATE;
        ESP_LOGI(TAG, "using Wi-Fi credentials already stored by the ESP-IDF driver");
    }
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    ESP_RETURN_ON_ERROR(esp_wifi_connect(), TAG, "wifi connect");
    EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_READY | WIFI_FAILED, pdFALSE, pdFALSE,
                                          pdMS_TO_TICKS(timeout_ms));
    return bits & WIFI_READY ? ESP_OK : ESP_ERR_TIMEOUT;
}

static void websocket_handler(void *args, esp_event_base_t base, int32_t id, void *event_data) {
    (void)args; (void)base;
    esp_websocket_event_data_t *event = event_data;
    vs_transport_event_t projected = {0};
    switch (id) {
        case WEBSOCKET_EVENT_CONNECTED:
            atomic_store(&connected, true); projected.type = VS_TRANSPORT_CONNECTED; break;
        case WEBSOCKET_EVENT_DISCONNECTED:
            atomic_store(&connected, false); projected.type = VS_TRANSPORT_DISCONNECTED; break;
        case WEBSOCKET_EVENT_ERROR:
            projected.type = VS_TRANSPORT_ERROR; break;
        case WEBSOCKET_EVENT_DATA:
            if (event->payload_offset != 0 || event->payload_len != event->data_len) {
                ESP_LOGE(TAG, "fragmented WebSocket message rejected");
                projected.type = VS_TRANSPORT_ERROR;
                break;
            }
            projected.type = event->op_code == 0x2 ? VS_TRANSPORT_BINARY : VS_TRANSPORT_TEXT;
            projected.data = (const uint8_t *)event->data_ptr;
            projected.size = event->data_len;
            break;
        default:
            return;
    }
    if (callback) callback(&projected, callback_context);
}

esp_err_t vs_transport_start(const char *url, const char *token,
                             vs_transport_callback_t event_callback, void *context) {
    if (!url || !token || !url[0] || !token[0]) return ESP_ERR_INVALID_ARG;
#if !CONFIG_VS_ALLOW_INSECURE_WS
    if (strncmp(url, "wss://", 6) != 0) return ESP_ERR_INVALID_ARG;
#endif
    static char headers[300];
    int written = snprintf(headers, sizeof(headers), "Authorization: Bearer %s\r\n", token);
    if (written < 0 || written >= sizeof(headers)) return ESP_ERR_INVALID_SIZE;
    callback = event_callback;
    callback_context = context;
    atomic_init(&connected, false);
    esp_websocket_client_config_t config = {
        .uri = url,
        .headers = headers,
        .buffer_size = 128 * 1024,
        .network_timeout_ms = 10000,
        .reconnect_timeout_ms = 2000,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    websocket = esp_websocket_client_init(&config);
    if (!websocket) return ESP_ERR_NO_MEM;
    ESP_ERROR_CHECK(esp_websocket_register_events(websocket, WEBSOCKET_EVENT_ANY,
                                                   websocket_handler, NULL));
    return esp_websocket_client_start(websocket);
}

esp_err_t vs_transport_send_text(const char *text) {
    if (!websocket || !atomic_load(&connected) || !text) return ESP_ERR_INVALID_STATE;
    int result = esp_websocket_client_send_text(websocket, text, strlen(text), pdMS_TO_TICKS(1000));
    return result >= 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t vs_transport_send_binary(const uint8_t *data, size_t size) {
    if (!websocket || !atomic_load(&connected) || !data || size > INT_MAX) return ESP_ERR_INVALID_STATE;
    int result = esp_websocket_client_send_bin(websocket, (const char *)data, size, pdMS_TO_TICKS(1000));
    return result >= 0 ? ESP_OK : ESP_FAIL;
}

bool vs_transport_connected(void) { return atomic_load(&connected); }

void vs_transport_stop(void) {
    if (!websocket) return;
    esp_websocket_client_stop(websocket);
    esp_websocket_client_destroy(websocket);
    websocket = NULL;
    atomic_store(&connected, false);
}
