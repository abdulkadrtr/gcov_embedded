#include <stdint.h>

extern uint32_t _estack, _sdata, _edata, _sidata, _sbss, _ebss;
extern uint32_t __init_array_start, __init_array_end;

int main(void);

typedef void (*init_fn)(void);

void Reset_Handler(void) {
    uint32_t *src = &_sidata, *dst = &_sdata;
    while (dst < &_edata) *dst++ = *src++;

    dst = &_sbss;
    while (dst < &_ebss) *dst++ = 0;

    init_fn *fn = (init_fn *)&__init_array_start;
    while (fn < (init_fn *)&__init_array_end) (*fn++)();

    main();
    while(1);
}

void Default_Handler(void) { while(1); }

__attribute__((section(".isr_vector")))
uint32_t vector_table[] = {
    (uint32_t)&_estack,
    (uint32_t)Reset_Handler,
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
};
