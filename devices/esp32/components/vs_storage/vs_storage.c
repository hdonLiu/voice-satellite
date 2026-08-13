#include "vs_storage.h"

#include <string.h>
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_check.h"

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
