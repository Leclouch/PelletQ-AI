set(PIO_LIBDEPS_DIR "${CMAKE_CURRENT_LIST_DIR}/../.pio/libdeps/esp32dev")
set(ARDUINOJSON_DIR "${PIO_LIBDEPS_DIR}/ArduinoJson/src")

idf_component_register(
    SRCS
        "main.cpp"
    INCLUDE_DIRS
        "."
        "${ARDUINOJSON_DIR}"
    REQUIRES mqtt espressif__arduino-esp32
)
