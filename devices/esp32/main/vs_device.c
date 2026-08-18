#include "vs_device.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "esp_log.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "vs_audio.h"
#include "vs_audio_wire.h"
#include "vs_board.h"
#include "vs_control.h"
#include "vs_storage.h"
#include "vs_transport.h"
#include "vs_wake.h"

static const char *TAG = "vs_device";

typedef enum {
    EVENT_LINK_CONNECTED,
    EVENT_LINK_DISCONNECTED,
    EVENT_LINK_TEXT,
    EVENT_LINK_BINARY,
    EVENT_BUTTON_DOWN,
    EVENT_BUTTON_UP,
    EVENT_WAKE,
    EVENT_ENDPOINT,
    EVENT_INPUT_DRAINED,
    EVENT_PLAYBACK_DRAINED,
} device_event_type_t;

typedef struct {
    device_event_type_t type;
    uint8_t *data;
    size_t size;
} device_event_t;

typedef struct {
    bool end;
    uint32_t generation;
    size_t size;
    uint8_t data[VS_AUDIO_HEADER_BYTES + VS_INPUT_BYTES_PER_FRAME];
} outgoing_audio_t;

typedef enum {
    DEVICE_OFFLINE,
    DEVICE_IDLE,
    DEVICE_CAPTURING,
    DEVICE_WAITING,
    DEVICE_SPEAKING,
    DEVICE_APPROVAL,
} device_state_t;

typedef struct {
    QueueHandle_t events;
    QueueHandle_t outgoing_audio;
    SemaphoreHandle_t capture_mutex;
    vs_device_config_t config;
    vs_control_context_t control;
    device_state_t state;
    atomic_bool capture_active;
    atomic_bool endpoint_queued;
    atomic_uint audio_sequence;
    atomic_uint capture_generation;
    uint8_t input_stream[16];
    char input_stream_text[37];
    char turn_id[37];
    char permission_id[129];
    uint8_t output_stream[16];
    bool output_stream_active;
    bool turn_terminal_received;
    bool server_endpointing;
    bool pending_wake_restart;
    uint32_t expected_output_sequence;
    esp_timer_handle_t capture_timer;
} device_t;

static device_t device;
static StaticQueue_t outgoing_audio_queue_control;
static uint8_t *outgoing_audio_queue_storage;
static void cancel_turn(void);
static esp_err_t begin_capture(bool server_endpointing);

// Sending one WebSocket message per 20 ms audio frame can be slower than real
// time on a high-latency public link. Keep the complete bounded capture window
// in PSRAM so capture never truncates merely because the network is draining
// more slowly than the microphone produces frames.
#define OUTGOING_AUDIO_QUEUE_FRAMES (((CONFIG_VS_MAX_CAPTURE_MS + 19) / 20) + 1)

static void post_event_wait(device_event_type_t type, const void *data, size_t size,
                            TickType_t wait) {
    device_event_t event = {.type = type, .size = size};
    if (size > 0) {
        event.data = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!event.data) {
            ESP_LOGE(TAG, "event allocation failed");
            return;
        }
        memcpy(event.data, data, size);
    }
    if (xQueueSend(device.events, &event, wait) != pdTRUE) {
        free(event.data);
        ESP_LOGE(TAG, "event queue overflow");
    }
}

static void post_event(device_event_type_t type, const void *data, size_t size) {
    post_event_wait(type, data, size, 0);
}

static void board_button(bool pressed, void *context) {
    (void)context;
    post_event(pressed ? EVENT_BUTTON_DOWN : EVENT_BUTTON_UP, NULL, 0);
}

static void wake_detected(const char *word, void *context) {
    (void)context;
    ESP_LOGI(TAG, "wake word: %s", word ? word : "detected");
    post_event(EVENT_WAKE, NULL, 0);
}

static void playback_drained(void *context) {
    (void)context;
    post_event(EVENT_PLAYBACK_DRAINED, NULL, 0);
}

static void transport_event(const vs_transport_event_t *event, void *context) {
    (void)context;
    switch (event->type) {
        case VS_TRANSPORT_CONNECTED: post_event(EVENT_LINK_CONNECTED, NULL, 0); break;
        case VS_TRANSPORT_DISCONNECTED:
        case VS_TRANSPORT_ERROR: post_event(EVENT_LINK_DISCONNECTED, NULL, 0); break;
        case VS_TRANSPORT_TEXT:
            post_event_wait(EVENT_LINK_TEXT, event->data, event->size, pdMS_TO_TICKS(500));
            break;
        case VS_TRANSPORT_BINARY:
            post_event_wait(EVENT_LINK_BINARY, event->data, event->size, pdMS_TO_TICKS(500));
            break;
    }
}

static void captured_audio(const int16_t *samples, size_t count, void *context) {
    (void)context;
    if (count != VS_INPUT_SAMPLES_PER_FRAME) return;
    xSemaphoreTake(device.capture_mutex, portMAX_DELAY);
    if (!atomic_load(&device.capture_active)) {
        xSemaphoreGive(device.capture_mutex);
        return;
    }
    outgoing_audio_t packet = {0};
    packet.generation = atomic_load(&device.capture_generation);
    uint32_t sequence = atomic_fetch_add(&device.audio_sequence, 1);
    vs_audio_wire_frame_t frame = {
        .direction = VS_AUDIO_INPUT,
        .sequence = sequence,
        .timestamp_ms = sequence * 20ULL,
        .payload = (const uint8_t *)samples,
        .payload_size = count * sizeof(int16_t),
    };
    memcpy(frame.stream_id, device.input_stream, 16);
    size_t encoded = 0;
    if (vs_audio_wire_encode(&frame, packet.data, sizeof(packet.data), &encoded) != ESP_OK) {
        xSemaphoreGive(device.capture_mutex);
        bool expected = false;
        if (atomic_compare_exchange_strong(&device.endpoint_queued, &expected, true))
            post_event(EVENT_ENDPOINT, NULL, 0);
        return;
    }
    packet.size = encoded;
    if (xQueueSend(device.outgoing_audio, &packet, 0) != pdTRUE) {
        xSemaphoreGive(device.capture_mutex);
        bool expected = false;
        if (atomic_compare_exchange_strong(&device.endpoint_queued, &expected, true)) {
            ESP_LOGW(TAG, "outgoing audio queue saturated; ending capture");
            post_event(EVENT_ENDPOINT, NULL, 0);
        }
        return;
    }
    xSemaphoreGive(device.capture_mutex);
}

static void audio_sender_task(void *context) {
    (void)context;
    outgoing_audio_t packet;
    while (xQueueReceive(device.outgoing_audio, &packet, portMAX_DELAY) == pdTRUE) {
        if (packet.generation != atomic_load(&device.capture_generation)) continue;
        if (packet.end) {
            post_event(EVENT_INPUT_DRAINED, NULL, 0);
            continue;
        }
        if (vs_transport_send_binary(packet.data, packet.size) != ESP_OK)
            post_event(EVENT_LINK_DISCONNECTED, NULL, 0);
    }
}

static void monitored_audio(const int16_t *samples, size_t count, void *context) {
    (void)context;
    vs_wake_feed(samples, count);
    uint32_t level = vs_audio_rms(samples, count);
    if (atomic_load(&device.capture_active)) vs_board_display_set_audio_level(level);
}

static esp_err_t send_json(char *text) {
    if (!text) return ESP_ERR_NO_MEM;
    esp_err_t result = vs_transport_send_text(text);
    free(text);
    return result;
}

static esp_err_t send_turn(const char *type, cJSON *payload) {
    return send_json(vs_control_turn_message(&device.control, type, device.turn_id, payload));
}

static void stop_capture(void) {
    xSemaphoreTake(device.capture_mutex, portMAX_DELAY);
    atomic_store(&device.capture_active, false);
    atomic_fetch_add(&device.capture_generation, 1);
    vs_audio_set_capture(false);
    xQueueReset(device.outgoing_audio);
    xSemaphoreGive(device.capture_mutex);
    if (device.capture_timer) esp_timer_stop(device.capture_timer);
}

static void set_idle(void) {
    atomic_store(&device.capture_active, false);
    atomic_store(&device.endpoint_queued, false);
    device.state = vs_transport_connected() ? DEVICE_IDLE : DEVICE_OFFLINE;
    device.permission_id[0] = '\0';
    device.output_stream_active = false;
    device.turn_terminal_received = false;
    device.server_endpointing = false;
    device.pending_wake_restart = false;
    vs_board_set_output(false);
    vs_board_set_status(false);
    vs_board_display_set_audio_level(0);
    if (device.state == DEVICE_IDLE) {
#if CONFIG_VS_PROFILE_WAKENET
        vs_board_display_set_state("WakeReady");
#else
        vs_board_display_set_state("Ready");
#endif
    } else {
        vs_board_display_set_state("Offline");
    }
#if CONFIG_VS_PROFILE_WAKENET
    vs_wake_set_enabled(device.state == DEVICE_IDLE);
#endif
}

static void capture_timeout(void *context) {
    (void)context;
    bool expected = false;
    if (atomic_compare_exchange_strong(&device.endpoint_queued, &expected, true))
        post_event(EVENT_ENDPOINT, NULL, 0);
}

static esp_err_t begin_capture(bool server_endpointing) {
    if (device.state != DEVICE_IDLE || !device.control.connection_id[0]) return ESP_ERR_INVALID_STATE;
    vs_uuid_generate(device.input_stream);
    vs_uuid_format(device.input_stream, device.input_stream_text);
    uint8_t turn[16];
    vs_uuid_generate(turn);
    vs_uuid_format(turn, device.turn_id);
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddStringToObject(payload, "audioStreamId", device.input_stream_text);
    cJSON_AddStringToObject(payload, "endpointing", server_endpointing ? "server" : "device");
    ESP_RETURN_ON_ERROR(send_turn("turn.start", payload), TAG, "turn.start");
    device.server_endpointing = server_endpointing;
    atomic_store(&device.audio_sequence, 0);
    atomic_store(&device.endpoint_queued, false);
    xSemaphoreTake(device.capture_mutex, portMAX_DELAY);
    atomic_fetch_add(&device.capture_generation, 1);
    xQueueReset(device.outgoing_audio);
    atomic_store(&device.capture_active, true);
    xSemaphoreGive(device.capture_mutex);
    device.state = DEVICE_CAPTURING;
    vs_wake_set_enabled(server_endpointing);
    vs_audio_set_capture(true);
    vs_board_set_status(true);
    vs_board_display_set_audio_level(0);
    vs_board_display_set_state("Listening");
    vs_board_display_set_transcript("已唤醒，请讲话…");
    esp_timer_stop(device.capture_timer);
    if (!server_endpointing)
        esp_timer_start_once(device.capture_timer, CONFIG_VS_MAX_CAPTURE_MS * 1000ULL);
    ESP_LOGI(TAG, "capture started, turn=%s", device.turn_id);
    return ESP_OK;
}

static void end_capture(void) {
    if (device.state != DEVICE_CAPTURING || device.server_endpointing) return;
    xSemaphoreTake(device.capture_mutex, portMAX_DELAY);
    atomic_store(&device.capture_active, false);
    vs_audio_set_capture(false);
    esp_timer_stop(device.capture_timer);
    device.state = DEVICE_WAITING;
    vs_board_display_set_audio_level(0);
    vs_board_display_set_state("Recognizing");
    vs_board_display_set_transcript("语音已结束，正在识别…");
    outgoing_audio_t sentinel = {
        .end = true,
        .generation = atomic_load(&device.capture_generation),
    };
    if (xQueueSend(device.outgoing_audio, &sentinel, pdMS_TO_TICKS(1000)) != pdTRUE) {
        xSemaphoreGive(device.capture_mutex);
        ESP_LOGE(TAG, "outgoing audio queue did not drain");
        cancel_turn();
        return;
    }
    xSemaphoreGive(device.capture_mutex);
    vs_wake_set_enabled(true);
}

static void stop_server_capture(const char *reason) {
    if (device.state != DEVICE_CAPTURING || !device.server_endpointing) return;
    xSemaphoreTake(device.capture_mutex, portMAX_DELAY);
    atomic_store(&device.capture_active, false);
    atomic_fetch_add(&device.capture_generation, 1);
    vs_audio_set_capture(false);
    xQueueReset(device.outgoing_audio);
    xSemaphoreGive(device.capture_mutex);
    esp_timer_stop(device.capture_timer);
    device.state = DEVICE_WAITING;
    vs_board_display_set_audio_level(0);
    if (reason && !strcmp(reason, "no_speech")) {
        vs_board_display_set_state("Recognizing");
        vs_board_display_set_transcript("没有听到语音");
    } else {
        vs_board_display_set_state("Recognizing");
        vs_board_display_set_transcript("语音已结束，正在识别…");
    }
    vs_wake_set_enabled(true);
}

static void interrupt_for_wake(void) {
    if (device.state != DEVICE_CAPTURING && device.state != DEVICE_WAITING &&
        device.state != DEVICE_SPEAKING && device.state != DEVICE_APPROVAL)
        return;
    stop_capture();
    vs_audio_stop_playback();
    vs_board_set_output(false);
    vs_wake_set_enabled(false);
    device.pending_wake_restart = true;
    device.state = DEVICE_WAITING;
    vs_board_display_set_state("CloudConnecting");
    vs_board_display_set_transcript("已打断，正在开始新一轮…");
    if (send_turn("turn.cancel", cJSON_CreateObject()) != ESP_OK) set_idle();
}

static void finish_and_maybe_restart(void) {
    bool restart = device.pending_wake_restart;
    vs_audio_stop_playback();
    set_idle();
    if (restart) begin_capture(true);
}

static void cancel_turn(void) {
    if (!device.turn_id[0] || device.state == DEVICE_IDLE || device.state == DEVICE_OFFLINE) return;
    stop_capture();
    vs_audio_stop_playback();
    send_turn("turn.cancel", cJSON_CreateObject());
    set_idle();
}

static void resolve_permission(const char *decision) {
    if (device.state != DEVICE_APPROVAL || !device.permission_id[0]) return;
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddStringToObject(payload, "requestId", device.permission_id);
    cJSON_AddStringToObject(payload, "decision", decision);
    send_turn("permission.resolve", payload);
    device.permission_id[0] = '\0';
    device.state = DEVICE_WAITING;
}

static void process_button(bool pressed) {
    if (pressed && device.state == DEVICE_APPROVAL) {
        resolve_permission("allow");
        return;
    }
    if (pressed && device.state == DEVICE_SPEAKING) {
        cancel_turn();
        return;
    }
    if (pressed && device.state == DEVICE_WAITING) {
        cancel_turn();
        return;
    }
    if (pressed && device.state == DEVICE_IDLE) {
        begin_capture(false);
        return;
    }
    if (!pressed && device.state == DEVICE_CAPTURING) end_capture();
}

static void send_pong(const cJSON *message) {
    const cJSON *payload_in = cJSON_GetObjectItemCaseSensitive(message, "payload");
    const cJSON *timestamp = cJSON_GetObjectItemCaseSensitive(payload_in, "timestampMs");
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddStringToObject(root, "type", "pong");
    cJSON_AddStringToObject(root, "connectionId", device.control.connection_id);
    cJSON_AddNumberToObject(root, "seq", device.control.next_outgoing_seq++);
    cJSON *payload = cJSON_AddObjectToObject(root, "payload");
    cJSON_AddNumberToObject(payload, "timestampMs", cJSON_IsNumber(timestamp) ? timestamp->valuedouble : 0);
    char *text = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    send_json(text);
}

static void process_control(const uint8_t *data, size_t size) {
    cJSON *message = NULL;
    if (vs_control_parse((const char *)data, size, &message) != ESP_OK ||
        vs_control_accept_server(&device.control, message) != ESP_OK) {
        cJSON_Delete(message);
        ESP_LOGE(TAG, "invalid server control message");
        cancel_turn();
        return;
    }
    const char *type = vs_json_string(message, "type");
    const cJSON *payload = cJSON_GetObjectItemCaseSensitive(message, "payload");
    if (!type || !cJSON_IsObject(payload)) goto invalid;
    if (!strcmp(type, "device.welcome")) {
        const char *connection = vs_json_string(message, "connectionId");
        const char *conversation = vs_json_string(message, "conversationId");
        if (!connection || !conversation) goto invalid;
        strlcpy(device.control.connection_id, connection, sizeof(device.control.connection_id));
        strlcpy(device.control.conversation_id, conversation, sizeof(device.control.conversation_id));
        device.control.next_outgoing_seq = 1;
        ESP_LOGI(TAG, "relay connected");
        vs_board_display_set_connectivity(true, true);
        set_idle();
#if CONFIG_VS_PROFILE_WAKENET
        vs_board_display_set_transcript("请说“你好小智”");
#else
        vs_board_display_set_transcript("按住 BOOT 键说话");
#endif
    } else if (!strcmp(type, "turn.state")) {
        const char *state = vs_json_string(payload, "state");
        if (state && !strcmp(state, "SPEAKING")) {
            device.state = DEVICE_SPEAKING;
            vs_board_display_set_state("Speaking");
            vs_wake_set_enabled(true);
        } else if (state && !strcmp(state, "TRANSCRIBING")) {
            vs_board_display_set_state("Recognizing");
        } else if (state && !strcmp(state, "WAITING_AGENT")) {
            vs_board_display_set_state("Forwarding");
        }
    } else if (!strcmp(type, "transcript.final")) {
        const char *text = vs_json_string(payload, "text");
        if (!text || !text[0]) goto invalid;
        ESP_LOGI(TAG, "transcript: %s", text);
        vs_board_display_set_transcript(text);
        vs_board_display_set_state("Recognized");
        vs_wake_set_enabled(true);
    } else if (!strcmp(type, "turn.input_stop")) {
        const char *reason = vs_json_string(payload, "reason");
        if (!reason) goto invalid;
        stop_server_capture(reason);
    } else if (!strcmp(type, "permission.request")) {
        const char *request_id = vs_json_string(payload, "requestId");
        if (!request_id) goto invalid;
#if CONFIG_VS_PHYSICAL_APPROVAL
        strlcpy(device.permission_id, request_id, sizeof(device.permission_id));
        device.state = DEVICE_APPROVAL;
        ESP_LOGW(TAG, "approval requested: %s (press BOOT to allow)",
                 vs_json_string(payload, "summary") ? vs_json_string(payload, "summary") : "tool request");
#else
        strlcpy(device.permission_id, request_id, sizeof(device.permission_id));
        device.state = DEVICE_APPROVAL;
        resolve_permission("deny");
#endif
    } else if (!strcmp(type, "audio.start")) {
        const char *stream = vs_json_string(payload, "audioStreamId");
        if (!stream || vs_uuid_parse(stream, device.output_stream) != ESP_OK) goto invalid;
        device.output_stream_active = true;
        device.turn_terminal_received = false;
        device.expected_output_sequence = 0;
        device.state = DEVICE_SPEAKING;
        vs_wake_set_enabled(true);
        vs_audio_stop_playback();
        vs_board_set_output(true);
    } else if (!strcmp(type, "audio.end")) {
        device.output_stream_active = false;
    } else if (!strcmp(type, "turn.done")) {
        ESP_LOGI(TAG, "turn completed");
        if (device.pending_wake_restart) {
            finish_and_maybe_restart();
            cJSON_Delete(message);
            return;
        }
        device.turn_terminal_received = true;
        if (vs_audio_playback_pending() == 0) set_idle();
    } else if (!strcmp(type, "turn.error")) {
        const char *code = vs_json_string(payload, "code");
        ESP_LOGW(TAG, "turn failed: %s", code ? code : "unknown");
        if (!device.pending_wake_restart && (!code || strcmp(code, "cancelled")))
            vs_board_display_set_state("Error");
        finish_and_maybe_restart();
    } else if (!strcmp(type, "ping")) {
        send_pong(message);
    }
    cJSON_Delete(message);
    return;
invalid:
    ESP_LOGE(TAG, "malformed server message %s", type ? type : "unknown");
    cJSON_Delete(message);
    cancel_turn();
}

static void process_binary(const uint8_t *data, size_t size) {
    vs_audio_wire_frame_t frame;
    if (!device.output_stream_active || vs_audio_wire_decode(data, size, &frame) != ESP_OK ||
        frame.direction != VS_AUDIO_OUTPUT || memcmp(frame.stream_id, device.output_stream, 16) != 0 ||
        frame.sequence != device.expected_output_sequence || frame.payload_size != VS_OUTPUT_BYTES_PER_FRAME) {
        ESP_LOGE(TAG, "invalid output audio frame");
        cancel_turn();
        return;
    }
    device.expected_output_sequence++;
    if (vs_audio_play(frame.payload, frame.payload_size, 100) != ESP_OK) {
        ESP_LOGE(TAG, "playback backpressure");
        cancel_turn();
    }
}

static void controller_task(void *context) {
    (void)context;
    device_event_t event;
    while (xQueueReceive(device.events, &event, portMAX_DELAY) == pdTRUE) {
        switch (event.type) {
            case EVENT_LINK_CONNECTED:
                vs_board_display_set_connectivity(true, false);
                vs_board_display_set_state("CloudConnecting");
                vs_board_display_set_transcript("Wi-Fi 已连接，正在连接云端…");
                vs_control_init(&device.control);
                send_json(vs_control_device_hello(CONFIG_VS_PHYSICAL_APPROVAL));
                break;
            case EVENT_LINK_DISCONNECTED:
                vs_board_display_set_connectivity(true, false);
                vs_board_display_set_transcript("连接中断，正在重新连接云端…");
                device.control.connection_id[0] = '\0';
                stop_capture();
                vs_audio_stop_playback();
                set_idle();
                break;
            case EVENT_LINK_TEXT: process_control(event.data, event.size); break;
            case EVENT_LINK_BINARY: process_binary(event.data, event.size); break;
            case EVENT_BUTTON_DOWN: process_button(true); break;
            case EVENT_BUTTON_UP: process_button(false); break;
            case EVENT_WAKE:
                if (device.state == DEVICE_IDLE) begin_capture(true);
                else interrupt_for_wake();
                break;
            case EVENT_ENDPOINT:
                if (device.server_endpointing) cancel_turn();
                else end_capture();
                break;
            case EVENT_INPUT_DRAINED:
                if (device.state == DEVICE_WAITING &&
                    send_turn("turn.input_end", cJSON_CreateObject()) != ESP_OK)
                    cancel_turn();
                break;
            case EVENT_PLAYBACK_DRAINED:
                if (device.turn_terminal_received) set_idle();
                break;
        }
        free(event.data);
    }
}

esp_err_t vs_device_start(void) {
    memset(&device, 0, sizeof(device));
    atomic_init(&device.capture_active, false);
    atomic_init(&device.endpoint_queued, false);
    atomic_init(&device.audio_sequence, 0);
    atomic_init(&device.capture_generation, 0);
    device.state = DEVICE_OFFLINE;
    device.events = xQueueCreate(32, sizeof(device_event_t));
    outgoing_audio_queue_storage = heap_caps_malloc(
        OUTGOING_AUDIO_QUEUE_FRAMES * sizeof(outgoing_audio_t),
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (outgoing_audio_queue_storage) {
        device.outgoing_audio = xQueueCreateStatic(
            OUTGOING_AUDIO_QUEUE_FRAMES, sizeof(outgoing_audio_t),
            outgoing_audio_queue_storage, &outgoing_audio_queue_control);
    }
    device.capture_mutex = xSemaphoreCreateMutex();
    if (!device.events || !device.outgoing_audio || !device.capture_mutex) return ESP_ERR_NO_MEM;
    ESP_RETURN_ON_ERROR(vs_storage_init(), TAG, "storage init");
    const esp_timer_create_args_t timer_config = {
        .callback = capture_timeout,
        .name = "capture_limit",
        .skip_unhandled_events = true,
    };
    ESP_RETURN_ON_ERROR(esp_timer_create(&timer_config, &device.capture_timer), TAG, "timer");
    ESP_RETURN_ON_ERROR(vs_board_init(board_button, &device), TAG, "board");
    ESP_RETURN_ON_ERROR(vs_storage_load(&device.config), TAG, "config load");
    if (!vs_storage_is_provisioned(&device.config)) {
        ESP_LOGW(TAG, "Relay configuration missing; waiting for one serial provisioning frame");
        vs_board_display_set_state("Provisioning");
        vs_board_display_set_transcript("等待串口安全配置");
        ESP_RETURN_ON_ERROR(vs_storage_provision_serial(&device.config), TAG, "serial provisioning");
    }
    vs_board_display_set_connectivity(false, false);
    vs_board_display_set_state("WiFiConnecting");
    vs_board_display_set_transcript("正在连接 Wi-Fi…");
    ESP_RETURN_ON_ERROR(vs_wake_init(wake_detected, &device), TAG, "wake");
    ESP_RETURN_ON_ERROR(vs_audio_init(captured_audio, monitored_audio, playback_drained, &device), TAG, "audio");
    ESP_RETURN_ON_ERROR(vs_transport_wifi_connect(device.config.wifi_ssid,
                                                   device.config.wifi_password, 30000), TAG, "wifi");
    vs_board_display_set_connectivity(true, false);
    vs_board_display_set_state("CloudConnecting");
    vs_board_display_set_transcript("Wi-Fi 已连接，正在连接云端…");
    if (xTaskCreate(controller_task, "vs_controller", 8192, NULL, 10, NULL) != pdPASS)
        return ESP_ERR_NO_MEM;
    if (xTaskCreate(audio_sender_task, "vs_audio_sender", 4096, NULL, 8, NULL) != pdPASS)
        return ESP_ERR_NO_MEM;
    return vs_transport_start(device.config.relay_url, device.config.device_token,
                              transport_event, &device);
}
