set(PIO_LIBDEPS_DIR "${CMAKE_CURRENT_LIST_DIR}/../.pio/libdeps/esp32dev")
set(ESP32_SERVO_DIR "${PIO_LIBDEPS_DIR}/ESP32Servo/src")

idf_component_register(
    SRCS
        "main.cpp"
        "${ESP32_SERVO_DIR}/ESP32PWM.cpp"
        "${ESP32_SERVO_DIR}/ESP32Servo.cpp"
    INCLUDE_DIRS
        "."
        "${ESP32_SERVO_DIR}"
    REQUIRES espressif__arduino-esp32
)
