#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VS_INPUT_SAMPLE_RATE_HZ 16000
#define VS_INPUT_SAMPLES_PER_FRAME 320
#define VS_INPUT_BYTES_PER_FRAME 640
#define VS_OUTPUT_SAMPLES_PER_FRAME 480
#define VS_OUTPUT_BYTES_PER_FRAME 960

typedef void (*vs_audio_capture_callback_t)(const int16_t *samples, size_t count, void *context);
typedef void (*vs_audio_monitor_callback_t)(const int16_t *samples, size_t count, void *context);
typedef void (*vs_audio_drained_callback_t)(void *context);

esp_err_t vs_audio_init(vs_audio_capture_callback_t capture_callback,
                        vs_audio_monitor_callback_t monitor_callback,
                        vs_audio_drained_callback_t drained_callback, void *context);
void vs_audio_set_capture(bool enabled);
esp_err_t vs_audio_play(const uint8_t *pcm, size_t bytes, uint32_t timeout_ms);
void vs_audio_stop_playback(void);
size_t vs_audio_playback_pending(void);
uint32_t vs_audio_rms(const int16_t *samples, size_t count);

#ifdef __cplusplus
}
#endif
