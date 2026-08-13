#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VS_AUDIO_HEADER_BYTES 40
#define VS_AUDIO_MAX_PAYLOAD_BYTES (64 * 1024)

typedef enum {
    VS_AUDIO_INPUT = 0,
    VS_AUDIO_OUTPUT = 1,
} vs_audio_direction_t;

typedef struct {
    vs_audio_direction_t direction;
    uint32_t sequence;
    uint64_t timestamp_ms;
    uint8_t stream_id[16];
    const uint8_t *payload;
    uint32_t payload_size;
} vs_audio_wire_frame_t;

esp_err_t vs_audio_wire_encode(const vs_audio_wire_frame_t *frame, uint8_t *output,
                               size_t output_capacity, size_t *output_size);
esp_err_t vs_audio_wire_decode(const uint8_t *input, size_t input_size,
                               vs_audio_wire_frame_t *frame);
esp_err_t vs_uuid_parse(const char *text, uint8_t output[16]);
void vs_uuid_format(const uint8_t input[16], char output[37]);
void vs_uuid_generate(uint8_t output[16]);

#ifdef __cplusplus
}
#endif
