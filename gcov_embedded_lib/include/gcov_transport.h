/*
 * gcov_transport.h — Transport abstraction layer for embedded gcov.
 */

#ifndef GCOV_TRANSPORT_H
#define GCOV_TRANSPORT_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Transmit a single character over the transport.
 * 
 * @param c  The character to send.
 */
void uart_putc(char c);

/**
 * @brief Transmit a null-terminated string over the transport.
 *
 * @param s  Pointer to a null-terminated string.
 */
void uart_print(const char *s);

#ifdef __cplusplus
}
#endif

#endif /* GCOV_TRANSPORT_H */
