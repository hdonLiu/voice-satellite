#include "vs_wake.h"

esp_err_t vs_wake_init(vs_wake_callback_t callback, void *context) {
    (void)callback;
    (void)context;
    return ESP_OK;
}

void vs_wake_set_enabled(bool enabled) { (void)enabled; }

void vs_wake_feed(const int16_t *samples, size_t count) {
    (void)samples;
    (void)count;
}
