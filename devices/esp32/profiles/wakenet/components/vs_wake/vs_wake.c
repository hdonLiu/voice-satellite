#include "vs_wake.h"

#include <stdatomic.h>
#include <string.h>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_wn_iface.h"
#include "esp_wn_models.h"
#include "model_path.h"

static const char *TAG = "vs_wake";
static esp_wn_iface_t *wake_iface;
static model_iface_data_t *wake_data;
static srmodel_list_t *models;
static int16_t *pending;
static size_t pending_count;
static size_t pending_capacity;
static atomic_bool enabled;
static vs_wake_callback_t detection_callback;
static void *callback_context;

esp_err_t vs_wake_init(vs_wake_callback_t callback, void *context) {
    detection_callback = callback;
    callback_context = context;
    atomic_init(&enabled, false);
    models = esp_srmodel_init("model");
    if (!models || models->num <= 0) return ESP_ERR_NOT_FOUND;
    char *model_name = esp_srmodel_filter(models, ESP_WN_PREFIX, NULL);
    if (!model_name) return ESP_ERR_NOT_FOUND;
    wake_iface = (esp_wn_iface_t *)esp_wn_handle_from_name(model_name);
    if (!wake_iface) return ESP_ERR_NOT_FOUND;
    wake_data = wake_iface->create(model_name, DET_MODE_95);
    if (!wake_data) return ESP_ERR_NO_MEM;
    pending_capacity = wake_iface->get_samp_chunksize(wake_data);
    pending = heap_caps_malloc(pending_capacity * sizeof(int16_t),
                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!pending) return ESP_ERR_NO_MEM;
    ESP_LOGI(TAG, "WakeNet %s ready at %d Hz, chunk %u", model_name,
             wake_iface->get_samp_rate(wake_data), (unsigned)pending_capacity);
    return ESP_OK;
}

void vs_wake_set_enabled(bool value) {
    atomic_store(&enabled, value);
    if (!value) pending_count = 0;
}

void vs_wake_feed(const int16_t *samples, size_t count) {
    if (!atomic_load(&enabled) || !samples || !wake_data) return;
    while (count > 0 && atomic_load(&enabled)) {
        size_t take = pending_capacity - pending_count;
        if (take > count) take = count;
        memcpy(pending + pending_count, samples, take * sizeof(int16_t));
        pending_count += take;
        samples += take;
        count -= take;
        if (pending_count == pending_capacity) {
            int result = wake_iface->detect(wake_data, pending);
            pending_count = 0;
            if (result > 0) {
                atomic_store(&enabled, false);
                if (detection_callback)
                    detection_callback(wake_iface->get_word_name(wake_data, result),
                                       callback_context);
            }
        }
    }
}
