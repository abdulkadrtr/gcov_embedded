TOOLCHAIN_PREFIX ?= arm-none-eabi

CC      = $(TOOLCHAIN_PREFIX)-gcc
OBJCOPY = $(TOOLCHAIN_PREFIX)-objcopy
GCOV    = $(TOOLCHAIN_PREFIX)-gcov

BUILD_DIR = build
KIT_DIR   = gcov_embedded_lib

KIT_SRCS  = $(KIT_DIR)/src/gcov_rt.c \
            $(KIT_DIR)/src/libc_stubs.c

APP_DIR   = example_project
APP_SRCS  = $(APP_DIR)/startup.c \
            $(APP_DIR)/main.c \
            $(APP_DIR)/test.c

GCOV_SRCS = $(APP_DIR)/main.c \
            $(APP_DIR)/test.c

KIT_OBJS  = $(patsubst $(KIT_DIR)/src/%.c, $(BUILD_DIR)/kit_%.o, $(KIT_SRCS))
APP_OBJS  = $(patsubst $(APP_DIR)/%.c,     $(BUILD_DIR)/%.o,     $(APP_SRCS))

CFLAGS_BASE = -mcpu=cortex-m3 -mthumb -O0 \
              -nostdlib -nostartfiles -ffreestanding \
              -I$(KIT_DIR)/include

CFLAGS_GCOV = $(CFLAGS_BASE) \
              -fprofile-arcs -ftest-coverage \
              -fprofile-info-section \
              -fcondition-coverage \
              -fno-inline

LDFLAGS = -T $(APP_DIR)/stm32.ld

LIBGCOV = $(shell $(CC) $(CFLAGS_BASE) -print-file-name=libgcov.a)
LIBGCC  = $(shell $(CC) $(CFLAGS_BASE) -print-libgcc-file-name)

.PHONY: all flash gcov clean

all: $(BUILD_DIR)/firmware.bin

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/kit_%.o: $(KIT_DIR)/src/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS_BASE) -c $< -o $@

$(BUILD_DIR)/startup.o: $(APP_DIR)/startup.c | $(BUILD_DIR)
	$(CC) $(CFLAGS_BASE) -c $< -o $@

define compile_gcov
$(BUILD_DIR)/$(notdir $(basename $(1))).o: $(1) | $(BUILD_DIR)
	$(CC) $(CFLAGS_GCOV) -c $$< -o $$@
endef

$(foreach src,$(GCOV_SRCS),$(eval $(call compile_gcov,$(src))))

$(BUILD_DIR)/%.o: $(APP_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS_BASE) -c $< -o $@

$(BUILD_DIR)/firmware.elf: $(KIT_OBJS) $(APP_OBJS)
	$(CC) $(CFLAGS_BASE) $(LDFLAGS) -o $@ $^ $(LIBGCOV) $(LIBGCC)

$(BUILD_DIR)/firmware.bin: $(BUILD_DIR)/firmware.elf
	$(OBJCOPY) -O binary $< $@

flash: $(BUILD_DIR)/firmware.bin
	stm32flash -w $(BUILD_DIR)/firmware.bin -v -g 0x0 /dev/ttyUSB0

gcov:
	mkdir -p coverage_result
	$(GCOV) -b -c -g --object-directory $(BUILD_DIR) $(GCOV_SRCS)
	mv *.gcov coverage_result/ 2>/dev/null || true

clean:
	rm -rf $(BUILD_DIR)