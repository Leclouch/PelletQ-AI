# ESP Insights is disabled. This no-op override avoids PlatformIO's
# certificate-embedding generated-source path for the optional component.
idf_component_register(SRCS "empty.c" INCLUDE_DIRS ".")
