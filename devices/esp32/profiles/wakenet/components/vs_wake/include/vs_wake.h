#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef void (*vs_wake_callback_t)(const char *wake_word, void *context);

esp_err_t vs_wake_init(vs_wake_callback_t callback, void *context);
void vs_wake_set_enabled(bool enabled);
void vs_wake_feed(const int16_t *samples, size_t count);
