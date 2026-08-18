#include "vs_wake.h"

#include <stdatomic.h>
#include <string.h>
#include "esp_afe_sr_models.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "model_path.h"

static const char *TAG = "vs_wake";
static const esp_afe_sr_iface_t *afe_iface;
static esp_afe_sr_data_t *afe_data;
static srmodel_list_t *models;
static int16_t *pending;
static size_t pending_count;
static size_t pending_capacity;
static SemaphoreHandle_t feed_mutex;
static atomic_bool enabled;
static vs_wake_callback_t detection_callback;
static void *callback_context;
static char wake_word[64] = "你好小智";

static void detection_task(void *context) {
    (void)context;
    while (true) {
        afe_fetch_result_t *result = afe_iface->fetch_with_delay(afe_data, portMAX_DELAY);
        if (!result || result->ret_value != ESP_OK ||
            result->wakeup_state != WAKENET_DETECTED)
            continue;

        bool expected = true;
        if (atomic_compare_exchange_strong(&enabled, &expected, false) &&
            detection_callback)
            detection_callback(wake_word, callback_context);
    }
}

esp_err_t vs_wake_init(vs_wake_callback_t callback, void *context) {
    detection_callback = callback;
    callback_context = context;
    atomic_init(&enabled, false);
    feed_mutex = xSemaphoreCreateMutex();
    if (!feed_mutex) return ESP_ERR_NO_MEM;

    models = esp_srmodel_init("model");
    if (!models || models->num <= 0) return ESP_ERR_NOT_FOUND;
    char *model_name = esp_srmodel_filter(models, ESP_WN_PREFIX, NULL);
    if (!model_name) return ESP_ERR_NOT_FOUND;

    char *words = esp_srmodel_get_wake_words(models, model_name);
    if (words && words[0]) {
        strlcpy(wake_word, words, sizeof(wake_word));
        char *separator = strchr(wake_word, ';');
        if (separator) *separator = '\0';
    }

    afe_config_t *config = afe_config_init("M", models, AFE_TYPE_VC, AFE_MODE_HIGH_PERF);
    if (!config) return ESP_ERR_NO_MEM;
    config->aec_init = false;
    config->ns_init = false;
    config->vad_init = false;
    config->wakenet_init = true;
    config->wakenet_model_name = model_name;
    config->agc_init = false;
    config->memory_alloc_mode = AFE_MEMORY_ALLOC_MORE_PSRAM;

    afe_iface = esp_afe_handle_from_config(config);
    if (afe_iface) afe_data = afe_iface->create_from_config(config);
    afe_config_free(config);
    if (!afe_iface || !afe_data) return ESP_FAIL;

    pending_capacity = afe_iface->get_feed_chunksize(afe_data);
    pending = heap_caps_malloc(pending_capacity * sizeof(int16_t),
                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!pending) return ESP_ERR_NO_MEM;
    if (xTaskCreate(detection_task, "vs_wake_afe", 4096, NULL, 3, NULL) != pdPASS)
        return ESP_ERR_NO_MEM;

    afe_iface->print_pipeline(afe_data);
    ESP_LOGI(TAG, "WakeNet AFE %s (%s) ready at %d Hz, feed chunk %u", model_name,
             wake_word, afe_iface->get_samp_rate(afe_data), (unsigned)pending_capacity);
    return ESP_OK;
}

void vs_wake_set_enabled(bool value) {
    if (!feed_mutex) return;
    xSemaphoreTake(feed_mutex, portMAX_DELAY);
    pending_count = 0;
    atomic_store(&enabled, value);
    xSemaphoreGive(feed_mutex);
}

void vs_wake_feed(const int16_t *samples, size_t count) {
    if (!atomic_load(&enabled) || !samples || !afe_data) return;
    xSemaphoreTake(feed_mutex, portMAX_DELAY);
    while (count > 0 && atomic_load(&enabled)) {
        size_t take = pending_capacity - pending_count;
        if (take > count) take = count;
        memcpy(pending + pending_count, samples, take * sizeof(int16_t));
        pending_count += take;
        samples += take;
        count -= take;
        if (pending_count == pending_capacity) {
            afe_iface->feed(afe_data, pending);
            pending_count = 0;
        }
    }
    xSemaphoreGive(feed_mutex);
}
