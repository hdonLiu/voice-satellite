cmake_minimum_required(VERSION 3.16)

set(VS_FIRMWARE_PROFILE "ptt" CACHE STRING "Voice Satellite firmware profile")
if(NOT VS_FIRMWARE_PROFILE STREQUAL "ptt" AND NOT VS_FIRMWARE_PROFILE STREQUAL "wakenet")
  message(FATAL_ERROR "VS_FIRMWARE_PROFILE must be ptt or wakenet")
endif()
list(APPEND EXTRA_COMPONENT_DIRS
  "${CMAKE_CURRENT_LIST_DIR}/profiles/${VS_FIRMWARE_PROFILE}/components")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(voice_satellite)
