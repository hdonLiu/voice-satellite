#include "vs_storage.h"

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "cJSON.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "vs_storage";

static esp_err_t read_string(nvs_handle_t handle, const char *key, char *value,
                             size_t capacity, const char *fallback) {
    size_t size = capacity;
    esp_err_t result = nvs_get_str(handle, key, value, &size);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        strlcpy(value, fallback, capacity);
        return ESP_OK;
    }
    return result;
}

esp_err_t vs_storage_init(void) {
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    return result;
}

esp_err_t vs_storage_load(vs_device_config_t *config) {
    if (!config) return ESP_ERR_INVALID_ARG;
    memset(config, 0, sizeof(*config));
    nvs_handle_t handle;
    esp_err_t result = nvs_open("vs_config", NVS_READONLY, &handle);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        strlcpy(config->wifi_ssid, CONFIG_VS_WIFI_SSID, sizeof(config->wifi_ssid));
        strlcpy(config->wifi_password, CONFIG_VS_WIFI_PASSWORD, sizeof(config->wifi_password));
        strlcpy(config->relay_url, CONFIG_VS_RELAY_URL, sizeof(config->relay_url));
        strlcpy(config->device_token, CONFIG_VS_DEVICE_TOKEN, sizeof(config->device_token));
        return ESP_OK;
    }
    if (result != ESP_OK) return result;
    result = read_string(handle, "wifi_ssid", config->wifi_ssid, sizeof(config->wifi_ssid), CONFIG_VS_WIFI_SSID);
    if (result == ESP_OK) result = read_string(handle, "wifi_pass", config->wifi_password, sizeof(config->wifi_password), CONFIG_VS_WIFI_PASSWORD);
    if (result == ESP_OK) result = read_string(handle, "relay_url", config->relay_url, sizeof(config->relay_url), CONFIG_VS_RELAY_URL);
    if (result == ESP_OK) result = read_string(handle, "device_token", config->device_token, sizeof(config->device_token), CONFIG_VS_DEVICE_TOKEN);
    nvs_close(handle);
    return result;
}

esp_err_t vs_storage_save(const vs_device_config_t *config) {
    if (!config) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle;
    ESP_RETURN_ON_ERROR(nvs_open("vs_config", NVS_READWRITE, &handle), "vs_storage", "open");
    esp_err_t result = nvs_set_str(handle, "wifi_ssid", config->wifi_ssid);
    if (result == ESP_OK) result = nvs_set_str(handle, "wifi_pass", config->wifi_password);
    if (result == ESP_OK) result = nvs_set_str(handle, "relay_url", config->relay_url);
    if (result == ESP_OK) result = nvs_set_str(handle, "device_token", config->device_token);
    if (result == ESP_OK) result = nvs_commit(handle);
    nvs_close(handle);
    return result;
}

bool vs_storage_is_provisioned(const vs_device_config_t *config) {
    return config && config->wifi_ssid[0] && config->relay_url[0] &&
           config->device_token[0];
}

esp_err_t vs_storage_provision_serial(vs_device_config_t *config) {
    if (!config) return ESP_ERR_INVALID_ARG;
    char line[768] = {0};
    size_t line_size = 0;
    bool overflow = false;
    printf("VS_PROVISION_READY\n");
    fflush(stdout);
    while (true) {
        int input = fgetc(stdin);
        if (input == EOF) {
            // The ESP-IDF console VFS is non-blocking until a byte arrives.
            clearerr(stdin);
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        if (input == '\r') continue;
        if (input != '\n') {
            if (overflow) continue;
            if (line_size + 1 >= sizeof(line)) {
                overflow = true;
            } else {
                line[line_size++] = (char)input;
            }
            continue;
        }
        if (line_size == 0 && !overflow) continue;
        if (overflow) {
            memset(line, 0, sizeof(line));
            line_size = 0;
            overflow = false;
            printf("VS_PROVISION_INVALID\n");
            fflush(stdout);
            continue;
        }
        line[line_size] = '\0';
        cJSON *root = cJSON_Parse(line);
        const cJSON *relay_url = cJSON_IsObject(root)
                                     ? cJSON_GetObjectItemCaseSensitive(root, "relayUrl")
                                     : NULL;
        const cJSON *device_token = cJSON_IsObject(root)
                                       ? cJSON_GetObjectItemCaseSensitive(root, "deviceToken")
                                       : NULL;
        const cJSON *wifi_ssid = cJSON_IsObject(root)
                                     ? cJSON_GetObjectItemCaseSensitive(root, "wifiSsid")
                                     : NULL;
        const cJSON *wifi_password = cJSON_IsObject(root)
                                         ? cJSON_GetObjectItemCaseSensitive(root, "wifiPassword")
                                         : NULL;
        bool relay_valid = cJSON_IsString(relay_url) && relay_url->valuestring[0] &&
                           strlen(relay_url->valuestring) < sizeof(config->relay_url);
        bool token_valid = cJSON_IsString(device_token) &&
                           device_token->valuestring[0] &&
                           strlen(device_token->valuestring) <
                               sizeof(config->device_token);
        bool wifi_valid = ((cJSON_IsString(wifi_ssid) && wifi_ssid->valuestring[0]) ||
                           config->wifi_ssid[0]) &&
                          (!wifi_ssid ||
                           (cJSON_IsString(wifi_ssid) &&
                            strlen(wifi_ssid->valuestring) < sizeof(config->wifi_ssid))) &&
                          (!wifi_password ||
                           (cJSON_IsString(wifi_password) &&
                            strlen(wifi_password->valuestring) <
                                sizeof(config->wifi_password)));
        bool valid = cJSON_IsObject(root) && relay_valid && token_valid && wifi_valid;
        if (valid) {
            strlcpy(config->relay_url, relay_url->valuestring, sizeof(config->relay_url));
            strlcpy(config->device_token, device_token->valuestring,
                    sizeof(config->device_token));
            if (wifi_ssid)
                strlcpy(config->wifi_ssid, wifi_ssid->valuestring, sizeof(config->wifi_ssid));
            if (wifi_password)
                strlcpy(config->wifi_password, wifi_password->valuestring,
                        sizeof(config->wifi_password));
            cJSON_Delete(root);
            memset(line, 0, sizeof(line));
            esp_err_t result = vs_storage_save(config);
            printf(result == ESP_OK ? "VS_PROVISION_OK\n" : "VS_PROVISION_ERROR\n");
            fflush(stdout);
            return result;
        }
        ESP_LOGW(TAG,
                 "provisioning rejected: bytes=%u first=0x%02x last=0x%02x "
                 "json=%d relay=%d token=%d wifi=%d lengths=%u/%u/%u/%u",
                 (unsigned)line_size, (unsigned)(uint8_t)line[0],
                 (unsigned)(uint8_t)line[line_size - 1], cJSON_IsObject(root),
                 relay_valid, token_valid, wifi_valid,
                 cJSON_IsString(relay_url) ? (unsigned)strlen(relay_url->valuestring) : 0,
                 cJSON_IsString(device_token) ? (unsigned)strlen(device_token->valuestring) : 0,
                 cJSON_IsString(wifi_ssid) ? (unsigned)strlen(wifi_ssid->valuestring) : 0,
                 cJSON_IsString(wifi_password) ?
                     (unsigned)strlen(wifi_password->valuestring) : 0);
        cJSON_Delete(root);
        memset(line, 0, sizeof(line));
        line_size = 0;
        printf("VS_PROVISION_INVALID\n");
        fflush(stdout);
    }
}
