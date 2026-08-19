#include "vs_audio.h"

#include <inttypes.h>
#include <math.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "esp_ae_rate_cvt.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "vs_board.h"

static const char *TAG = "vs_audio";
static atomic_bool capture_enabled;
static atomic_uint playback_generation;
static vs_audio_capture_callback_t capture_callback;
static vs_audio_monitor_callback_t monitor_callback;
static vs_audio_drained_callback_t drained_callback;
static void *callback_context;
static QueueHandle_t playback_queue;
static StaticQueue_t playback_queue_control;
static uint8_t *playback_queue_storage;
static atomic_uint pending_playback_frames;
static esp_ae_rate_cvt_handle_t input_resampler;
static int16_t *input_resampler_output;
static uint32_t input_resampler_output_capacity;

#define PLAYBACK_QUEUE_FRAMES 100
#define NATIVE_INPUT_SAMPLES_PER_FRAME (VS_BOARD_CAPTURE_RATE_HZ / 50)

typedef struct {
    uint32_t generation;
    uint8_t data[VS_OUTPUT_BYTES_PER_FRAME];
} playback_frame_t;

static void capture_task(void *context) {
    (void)context;
    int16_t native[NATIVE_INPUT_SAMPLES_PER_FRAME];
    int16_t protocol[VS_INPUT_SAMPLES_PER_FRAME];
    size_t protocol_samples = 0;
    while (true) {
        if (vs_board_audio_read(native, NATIVE_INPUT_SAMPLES_PER_FRAME) != ESP_OK) {
            ESP_LOGW(TAG, "audio capture read failed");
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        uint32_t output_samples = input_resampler_output_capacity;
        esp_ae_err_t result = esp_ae_rate_cvt_process(
            input_resampler, (esp_ae_sample_t)native, NATIVE_INPUT_SAMPLES_PER_FRAME,
            (esp_ae_sample_t)input_resampler_output, &output_samples);
        if (result != ESP_AE_ERR_OK) {
            ESP_LOGW(TAG, "resampler failed (%d), produced %" PRIu32 " samples", result,
                     output_samples);
            continue;
        }
        size_t consumed = 0;
        while (consumed < output_samples) {
            size_t available = VS_INPUT_SAMPLES_PER_FRAME - protocol_samples;
            size_t remaining = output_samples - consumed;
            size_t copied = remaining < available ? remaining : available;
            memcpy(protocol + protocol_samples, input_resampler_output + consumed,
                   copied * sizeof(int16_t));
            protocol_samples += copied;
            consumed += copied;
            if (protocol_samples != VS_INPUT_SAMPLES_PER_FRAME) continue;
            if (monitor_callback)
                monitor_callback(protocol, VS_INPUT_SAMPLES_PER_FRAME, callback_context);
            if (atomic_load(&capture_enabled) && capture_callback)
                capture_callback(protocol, VS_INPUT_SAMPLES_PER_FRAME, callback_context);
            protocol_samples = 0;
        }
    }
}

static void playback_task(void *context) {
    (void)context;
    playback_frame_t frame;
    while (xQueueReceive(playback_queue, &frame, portMAX_DELAY) == pdTRUE) {
        if (frame.generation != atomic_load(&playback_generation)) continue;
        if (vs_board_audio_write((const int16_t *)frame.data, VS_OUTPUT_SAMPLES_PER_FRAME) != ESP_OK)
            ESP_LOGW(TAG, "audio playback write failed");
        if (frame.generation == atomic_load(&playback_generation) &&
            atomic_fetch_sub(&pending_playback_frames, 1) == 1 && drained_callback)
            drained_callback(callback_context);
    }
}

esp_err_t vs_audio_init(vs_audio_capture_callback_t capture, vs_audio_monitor_callback_t monitor,
                        vs_audio_drained_callback_t drained, void *context) {
    capture_callback = capture;
    monitor_callback = monitor;
    drained_callback = drained;
    callback_context = context;
    atomic_init(&capture_enabled, false);
    atomic_init(&playback_generation, 1);
    atomic_init(&pending_playback_frames, 0);
    esp_ae_rate_cvt_cfg_t resampler_config = {
        .src_rate = VS_BOARD_CAPTURE_RATE_HZ,
        .dest_rate = VS_INPUT_SAMPLE_RATE_HZ,
        .channel = 1,
        .bits_per_sample = ESP_AE_BIT16,
        .complexity = 2,
        .perf_type = ESP_AE_RATE_CVT_PERF_TYPE_SPEED,
    };
    esp_ae_err_t resampler_result = esp_ae_rate_cvt_open(&resampler_config, &input_resampler);
    if (resampler_result != ESP_AE_ERR_OK || !input_resampler) {
        ESP_LOGE(TAG, "failed to initialize 24 kHz to 16 kHz resampler (%d)",
                 resampler_result);
        return ESP_FAIL;
    }
    resampler_result = esp_ae_rate_cvt_get_max_out_sample_num(
        input_resampler, NATIVE_INPUT_SAMPLES_PER_FRAME, &input_resampler_output_capacity);
    if (resampler_result != ESP_AE_ERR_OK ||
        input_resampler_output_capacity < VS_INPUT_SAMPLES_PER_FRAME) {
        ESP_LOGE(TAG, "failed to size input resampler buffer (%d, %" PRIu32 " samples)",
                 resampler_result, input_resampler_output_capacity);
        return ESP_FAIL;
    }
    input_resampler_output = heap_caps_malloc(input_resampler_output_capacity * sizeof(int16_t),
                                              MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!input_resampler_output) return ESP_ERR_NO_MEM;
    playback_queue_storage = heap_caps_malloc(PLAYBACK_QUEUE_FRAMES * sizeof(playback_frame_t),
                                              MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!playback_queue_storage) return ESP_ERR_NO_MEM;
    playback_queue = xQueueCreateStatic(PLAYBACK_QUEUE_FRAMES, sizeof(playback_frame_t),
                                        playback_queue_storage, &playback_queue_control);
    if (!playback_queue) {
        free(playback_queue_storage);
        playback_queue_storage = NULL;
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreatePinnedToCore(capture_task, "vs_capture", 4096, NULL, 9, NULL, 0) != pdPASS)
        return ESP_ERR_NO_MEM;
    if (xTaskCreate(playback_task, "vs_playback", 4096, NULL, 7, NULL) != pdPASS)
        return ESP_ERR_NO_MEM;
    return ESP_OK;
}

void vs_audio_set_capture(bool enabled) {
    atomic_store(&capture_enabled, enabled);
}

esp_err_t vs_audio_play(const uint8_t *pcm, size_t bytes, uint32_t timeout_ms) {
    if (!pcm || bytes != VS_OUTPUT_BYTES_PER_FRAME) return ESP_ERR_INVALID_SIZE;
    playback_frame_t frame = {.generation = atomic_load(&playback_generation)};
    memcpy(frame.data, pcm, bytes);
    atomic_fetch_add(&pending_playback_frames, 1);
    if (xQueueSend(playback_queue, &frame, pdMS_TO_TICKS(timeout_ms)) == pdTRUE) return ESP_OK;
    atomic_fetch_sub(&pending_playback_frames, 1);
    return ESP_ERR_TIMEOUT;
}

void vs_audio_stop_playback(void) {
    atomic_fetch_add(&playback_generation, 1);
    xQueueReset(playback_queue);
    atomic_store(&pending_playback_frames, 0);
}

size_t vs_audio_playback_pending(void) { return atomic_load(&pending_playback_frames); }

uint32_t vs_audio_rms(const int16_t *samples, size_t count) {
    if (!samples || count == 0) return 0;
    uint64_t sum = 0;
    for (size_t i = 0; i < count; ++i) {
        int32_t sample = samples[i];
        sum += (uint64_t)(sample * sample);
    }
    return (uint32_t)sqrt((double)sum / count);
}
