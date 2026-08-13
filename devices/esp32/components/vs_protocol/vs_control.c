#include "vs_control.h"

#include <string.h>

void vs_control_init(vs_control_context_t *context) {
    memset(context, 0, sizeof(*context));
}

char *vs_control_device_hello(bool physical_approval) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddStringToObject(root, "type", "device.hello");
    cJSON_AddNumberToObject(root, "seq", 0);
    cJSON *payload = cJSON_AddObjectToObject(root, "payload");
    cJSON_AddBoolToObject(payload, "physicalApproval", physical_approval);
    cJSON *diagnostics = cJSON_AddObjectToObject(payload, "diagnostics");
    cJSON_AddStringToObject(diagnostics, "platform", "esp32s3");
    cJSON_AddStringToObject(diagnostics, "board", "atk-dnesp32s3");
    cJSON_AddStringToObject(diagnostics, "softwareVersion", "0.1.0");
#if CONFIG_VS_PROFILE_WAKENET
    cJSON_AddStringToObject(diagnostics, "buildProfile", "wakenet");
#else
    cJSON_AddStringToObject(diagnostics, "buildProfile", "ptt");
#endif
    char *result = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return result;
}

char *vs_control_turn_message(vs_control_context_t *context, const char *type,
                              const char *turn_id, cJSON *payload) {
    if (!context || !type || !turn_id || !payload || !context->connection_id[0] ||
        !context->conversation_id[0]) { cJSON_Delete(payload); return NULL; }
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddStringToObject(root, "type", type);
    cJSON_AddStringToObject(root, "connectionId", context->connection_id);
    cJSON_AddNumberToObject(root, "seq", context->next_outgoing_seq++);
    cJSON_AddStringToObject(root, "conversationId", context->conversation_id);
    cJSON_AddStringToObject(root, "turnId", turn_id);
    cJSON_AddItemToObject(root, "payload", payload);
    char *result = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return result;
}

esp_err_t vs_control_parse(const char *data, size_t length, cJSON **message) {
    if (!data || !message || length == 0 || length > VS_CONTROL_MAX_BYTES) return ESP_ERR_INVALID_ARG;
    cJSON *root = cJSON_ParseWithLength(data, length);
    if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); return ESP_ERR_INVALID_ARG; }
    const cJSON *version = cJSON_GetObjectItemCaseSensitive(root, "v");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    const cJSON *seq = cJSON_GetObjectItemCaseSensitive(root, "seq");
    const cJSON *payload = cJSON_GetObjectItemCaseSensitive(root, "payload");
    if (!cJSON_IsNumber(version) || version->valueint != 1 || !cJSON_IsString(type) ||
        !type->valuestring || !cJSON_IsNumber(seq) || seq->valuedouble < 0 ||
        seq->valuedouble > UINT32_MAX || !cJSON_IsObject(payload)) {
        cJSON_Delete(root); return ESP_ERR_INVALID_ARG;
    }
    *message = root;
    return ESP_OK;
}

esp_err_t vs_control_accept_server(vs_control_context_t *context, const cJSON *message) {
    const cJSON *seq = cJSON_GetObjectItemCaseSensitive(message, "seq");
    if (!context || !cJSON_IsNumber(seq) || (uint32_t)seq->valuedouble != context->expected_incoming_seq)
        return ESP_ERR_INVALID_STATE;
    context->expected_incoming_seq++;
    return ESP_OK;
}

const char *vs_json_string(const cJSON *object, const char *key) {
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) && item->valuestring ? item->valuestring : NULL;
}
