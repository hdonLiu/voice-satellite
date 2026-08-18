#pragma once

#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char wifi_ssid[33];
    char wifi_password[65];
    char relay_url[257];
    char device_token[257];
} vs_device_config_t;

esp_err_t vs_storage_init(void);
esp_err_t vs_storage_load(vs_device_config_t *config);
esp_err_t vs_storage_save(const vs_device_config_t *config);
bool vs_storage_is_provisioned(const vs_device_config_t *config);
esp_err_t vs_storage_provision_serial(vs_device_config_t *config);

#ifdef __cplusplus
}
#endif
