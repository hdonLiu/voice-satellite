#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VS_BOARD_CAPTURE_RATE_HZ 24000
#define VS_BOARD_PLAYBACK_RATE_HZ 24000

typedef void (*vs_board_button_callback_t)(bool pressed, void *context);

esp_err_t vs_board_init(vs_board_button_callback_t button_callback, void *context);
esp_err_t vs_board_audio_read(int16_t *samples, size_t sample_count);
esp_err_t vs_board_audio_write(const int16_t *samples, size_t sample_count);
esp_err_t vs_board_set_output(bool enabled);
void vs_board_set_status(bool active);
void vs_board_display_set_state(const char *state);
void vs_board_display_set_transcript(const char *text);
void vs_board_display_set_connectivity(bool wifi_connected, bool cloud_connected);
void vs_board_display_set_audio_level(uint32_t rms);

#ifdef __cplusplus
}
#endif
