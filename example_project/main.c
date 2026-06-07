/*
 * main.c — Example application demonstrating MC/DC coverage levels.
 */

#include <stdint.h>
#include "test.h"

#include "gcov_rt.h"
#include "gcov_transport.h"

#define RCC_CFGR     (*(volatile uint32_t*)0x40021004)
#define RCC_APB2ENR  (*(volatile uint32_t*)0x40021018)
#define GPIOC_CRH    (*(volatile uint32_t*)0x40011004)
#define GPIOC_BSRR   (*(volatile uint32_t*)0x40011010)
#define GPIOA_CRH    (*(volatile uint32_t*)0x40010804)
#define USART1_SR    (*(volatile uint32_t*)0x40013800)
#define USART1_DR    (*(volatile uint32_t*)0x40013804)
#define USART1_BRR   (*(volatile uint32_t*)0x40013808)
#define USART1_CR1   (*(volatile uint32_t*)0x4001380C)
#define SYSTICK_CTRL (*(volatile uint32_t*)0xE000E010)
#define SYSTICK_LOAD (*(volatile uint32_t*)0xE000E014)
#define SYSTICK_VAL  (*(volatile uint32_t*)0xE000E018)

/**
 * @brief Transmit one character via USART1 (gcov transport: uart_putc).
 */
void uart_putc(char c) {
    while (!(USART1_SR & (1 << 7)));
    USART1_DR = (uint32_t)c;
}

/**
 * @brief Transmit a null-terminated string via USART1 (gcov transport: uart_print).
 */
void uart_print(const char *s) {
    while (*s) uart_putc(*s++);
}

static void uart_init(void) {
    RCC_APB2ENR |= (1 << 2) | (1 << 14);
    GPIOA_CRH   &= ~(0xF << 4);
    GPIOA_CRH   |=  (0xB << 4);          
    USART1_BRR   = 0x341;                
    USART1_CR1   = (1<<3)|(1<<13);
}

static void systick_init(void) {
    SYSTICK_LOAD = 7999;
    SYSTICK_VAL  = 0;
    SYSTICK_CTRL = 0x5;
}

void delay_ms(uint32_t ms) {
    for (uint32_t i = 0; i < ms; i++) {
        SYSTICK_VAL = 0;
        while (!(SYSTICK_CTRL & (1 << 16)));
    }
}

int low_mcdc(int a, int b, int c)
{
    if ((a > 0) && (b > 0) && (c > 0))
    {
        return 1;
    }
    return 0;
}

int medium_mcdc(int a, int b, int c)
{
    if ((a > 0) && (b > 0) && (c > 0))
    {
        return 1;
    }
    return 0;
}

int main(void) {
    RCC_CFGR    &= ~(0x3);
    RCC_APB2ENR |=  (1 << 4);              
    GPIOC_CRH   &= ~(0xF << 20);
    GPIOC_CRH   |=  (0x2 << 20);           

    uart_init();
    systick_init();

    low_mcdc(1,1,1);
    low_mcdc(0,1,1);

    medium_mcdc(1,1,1);
    medium_mcdc(0,1,1);
    medium_mcdc(1,0,1);

    full_mcdc(1,1,1);
    full_mcdc(0,1,1);
    full_mcdc(1,0,1);
    full_mcdc(1,1,0);

    dump_gcov_info();

    while (1) {
        GPIOC_BSRR = (1 << 29);
        delay_ms(500);
        GPIOC_BSRR = (1 << 13);
        delay_ms(500);
    }
}
