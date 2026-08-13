#include "vs_audio_wire.h"

#include <stdbool.h>
#include <string.h>
#include "esp_random.h"

static const uint8_t MAGIC[4] = {'V', 'S', 'A', '1'};

static void write_u32_be(uint8_t *p, uint32_t value) {
    p[0] = (uint8_t)(value >> 24); p[1] = (uint8_t)(value >> 16);
    p[2] = (uint8_t)(value >> 8); p[3] = (uint8_t)value;
}

static uint32_t read_u32_be(const uint8_t *p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
           ((uint32_t)p[2] << 8) | p[3];
}

static void write_u64_be(uint8_t *p, uint64_t value) {
    for (int i = 7; i >= 0; --i) { p[i] = (uint8_t)value; value >>= 8; }
}

static uint64_t read_u64_be(const uint8_t *p) {
    uint64_t value = 0;
    for (int i = 0; i < 8; ++i) value = (value << 8) | p[i];
    return value;
}

esp_err_t vs_audio_wire_encode(const vs_audio_wire_frame_t *frame, uint8_t *output,
                               size_t capacity, size_t *output_size) {
    if (!frame || !output || !output_size || !frame->payload ||
        frame->direction > VS_AUDIO_OUTPUT || frame->payload_size > VS_AUDIO_MAX_PAYLOAD_BYTES ||
        capacity < VS_AUDIO_HEADER_BYTES + frame->payload_size) return ESP_ERR_INVALID_ARG;
    memcpy(output, MAGIC, 4);
    output[4] = 1;
    output[5] = (uint8_t)frame->direction;
    output[6] = output[7] = 0;
    write_u32_be(output + 8, frame->sequence);
    write_u64_be(output + 12, frame->timestamp_ms);
    memcpy(output + 20, frame->stream_id, 16);
    write_u32_be(output + 36, frame->payload_size);
    memcpy(output + VS_AUDIO_HEADER_BYTES, frame->payload, frame->payload_size);
    *output_size = VS_AUDIO_HEADER_BYTES + frame->payload_size;
    return ESP_OK;
}

esp_err_t vs_audio_wire_decode(const uint8_t *input, size_t size,
                               vs_audio_wire_frame_t *frame) {
    if (!input || !frame || size < VS_AUDIO_HEADER_BYTES || memcmp(input, MAGIC, 4) != 0 ||
        input[4] != 1 || input[5] > 1 || input[6] != 0 || input[7] != 0) return ESP_ERR_INVALID_ARG;
    uint32_t payload_size = read_u32_be(input + 36);
    if (payload_size > VS_AUDIO_MAX_PAYLOAD_BYTES || size != VS_AUDIO_HEADER_BYTES + payload_size)
        return ESP_ERR_INVALID_SIZE;
    frame->direction = (vs_audio_direction_t)input[5];
    frame->sequence = read_u32_be(input + 8);
    frame->timestamp_ms = read_u64_be(input + 12);
    memcpy(frame->stream_id, input + 20, 16);
    frame->payload = input + VS_AUDIO_HEADER_BYTES;
    frame->payload_size = payload_size;
    return ESP_OK;
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

esp_err_t vs_uuid_parse(const char *text, uint8_t output[16]) {
    if (!text || !output || strlen(text) != 36) return ESP_ERR_INVALID_ARG;
    size_t source = 0;
    for (size_t target = 0; target < 16; ++target) {
        if (source == 8 || source == 13 || source == 18 || source == 23) {
            if (text[source++] != '-') return ESP_ERR_INVALID_ARG;
        }
        int high = hex_value(text[source++]);
        int low = hex_value(text[source++]);
        if (high < 0 || low < 0) return ESP_ERR_INVALID_ARG;
        output[target] = (uint8_t)((high << 4) | low);
    }
    return ESP_OK;
}

void vs_uuid_format(const uint8_t input[16], char output[37]) {
    static const char HEX[] = "0123456789abcdef";
    size_t out = 0;
    for (size_t i = 0; i < 16; ++i) {
        if (i == 4 || i == 6 || i == 8 || i == 10) output[out++] = '-';
        output[out++] = HEX[input[i] >> 4];
        output[out++] = HEX[input[i] & 0x0f];
    }
    output[out] = '\0';
}

void vs_uuid_generate(uint8_t output[16]) {
    esp_fill_random(output, 16);
    output[6] = (output[6] & 0x0f) | 0x40;
    output[8] = (output[8] & 0x3f) | 0x80;
}
