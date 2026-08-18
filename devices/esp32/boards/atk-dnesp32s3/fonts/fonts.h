#pragma once

#include "lvgl.h"

#if !LV_USE_FONT_COMPRESSED
#error "Voice Satellite fonts require LV_USE_FONT_COMPRESSED"
#endif

LV_FONT_DECLARE(vs_font_cjk_16);
LV_FONT_DECLARE(vs_font_ui_22);
