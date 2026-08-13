#include "vs_device.h"

#include "esp_log.h"

void app_main(void) {
    ESP_ERROR_CHECK(vs_device_start());
    ESP_LOGI("voice_satellite", "device controller started");
}
