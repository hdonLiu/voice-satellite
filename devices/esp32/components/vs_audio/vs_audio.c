#include "vs_audio.h"

#include <math.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
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

#define PLAYBACK_QUEUE_FRAMES 100

typedef struct {
    uint32_t generation;
    uint8_t data[VS_OUTPUT_BYTES_PER_FRAME];
} playback_frame_t;

static void downsample_24k_to_16k(const int16_t input[480], int16_t output[320]) {
    // 3 input samples -> 2 output samples, with a small anti-aliasing average.
    for (size_t group = 0; group < 160; ++group) {
        const int32_t a = input[group * 3];
        const int32_t b = input[group * 3 + 1];
        const int32_t c = input[group * 3 + 2];
        output[group * 2] = (int16_t)((2 * a + b) / 3);
        output[group * 2 + 1] = (int16_t)((b + 2 * c) / 3);
    }
}

static void capture_task(void *context) {
    (void)context;
    int16_t native[480];
    int16_t protocol[VS_INPUT_SAMPLES_PER_FRAME];
    while (true) {
        if (vs_board_audio_read(native, 480) != ESP_OK) {
            ESP_LOGW(TAG, "audio capture read failed");
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        downsample_24k_to_16k(native, protocol);
        if (monitor_callback) monitor_callback(protocol, VS_INPUT_SAMPLES_PER_FRAME, callback_context);
        if (atomic_load(&capture_enabled) && capture_callback)
            capture_callback(protocol, VS_INPUT_SAMPLES_PER_FRAME, callback_context);
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
