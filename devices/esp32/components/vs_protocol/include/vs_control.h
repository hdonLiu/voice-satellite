#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VS_CONTROL_MAX_BYTES (32 * 1024)

typedef struct {
    uint32_t next_outgoing_seq;
    uint32_t expected_incoming_seq;
    char connection_id[129];
    char conversation_id[129];
} vs_control_context_t;

void vs_control_init(vs_control_context_t *context);
char *vs_control_device_hello(bool physical_approval);
char *vs_control_turn_message(vs_control_context_t *context, const char *type,
                              const char *turn_id, cJSON *payload);
esp_err_t vs_control_parse(const char *data, size_t length, cJSON **message);
esp_err_t vs_control_accept_server(vs_control_context_t *context, const cJSON *message);
const char *vs_json_string(const cJSON *object, const char *key);

#ifdef __cplusplus
}
#endif
