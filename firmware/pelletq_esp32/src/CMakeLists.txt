set(PIO_LIBDEPS_DIR "${CMAKE_CURRENT_LIST_DIR}/../.pio/libdeps/esp32dev")
set(TFT_ESPI_DIR "${PIO_LIBDEPS_DIR}/TFT_eSPI")
set(ESP32_SERVO_DIR "${PIO_LIBDEPS_DIR}/ESP32Servo/src")
set(ARDUINOJSON_DIR "${PIO_LIBDEPS_DIR}/ArduinoJson/src")

idf_component_register(
    SRCS
        "main.cpp"
        "${TFT_ESPI_DIR}/TFT_eSPI.cpp"
        "${ESP32_SERVO_DIR}/ESP32PWM.cpp"
        "${ESP32_SERVO_DIR}/ESP32Servo.cpp"
    INCLUDE_DIRS
        "."
        "${TFT_ESPI_DIR}"
        "${ESP32_SERVO_DIR}"
        "${ARDUINOJSON_DIR}"
    REQUIRES mqtt espressif__arduino-esp32
)
