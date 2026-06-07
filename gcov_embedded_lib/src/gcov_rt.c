/*
 * gcov_rt.c — Embedded gcov runtime implementation for bare-metal targets.
 */

#include "../include/gcov_rt.h"
#include "../include/gcov_transport.h"
#include <stdint.h>
#include <stddef.h>

/** Size of the staging buffer (bytes) used to batch /WRITE payloads. */
#ifndef GCOV_BUF_SIZE
#define GCOV_BUF_SIZE 256
#endif

#ifndef GCOV_POOL_SIZE
#define GCOV_POOL_SIZE 256
#endif


static uint8_t  _pool[GCOV_POOL_SIZE]; 
static uint32_t _pool_idx;            

typedef struct {
    uint8_t  buf[GCOV_BUF_SIZE];
    uint32_t len;
    uint32_t offset;
    uint8_t  fid;
} _Ctx;

static _Ctx _ctx;

extern void __gcov_info_to_gcda(
    const struct gcov_info *info,
    void (*filename_fn)(const char *, void *),
    void (*dump_fn)(const void *, unsigned, void *),
    void *(*allocate_fn)(unsigned, void *),
    void *arg
);

static void *_cb_allocate(unsigned length, void *arg) {
    (void)arg;
    uint32_t aligned = (length + 7) & ~7u;
    if (_pool_idx + aligned > GCOV_POOL_SIZE) {
        uart_print("/ERROR POOL EXHAUSTED\n");
        return NULL;
    }
    void *p    = &_pool[_pool_idx];
    _pool_idx += aligned;
    return p;
}

static void _print_u32(uint32_t v) {
    if (v == 0) { uart_putc('0'); return; }
    char tmp[10];
    int  i = 0;
    while (v) { tmp[i++] = '0' + (uint8_t)(v % 10); v /= 10; }
    while (i--) uart_putc(tmp[i]);
}

static void _flush(_Ctx *c) {
    if (c->len == 0) return;
    uart_print("/WRITE ");
    _print_u32(c->fid);    uart_putc(' ');
    _print_u32(c->offset); uart_putc(' ');
    _print_u32(c->len);    uart_putc('\n');
    for (uint32_t i = 0; i < c->len; i++)
        uart_putc((char)c->buf[i]);
    c->offset += c->len;
    c->len     = 0;
}

static void _cb_filename(const char *filename, void *arg) {
    _Ctx *c   = (_Ctx *)arg;
    c->len    = 0;
    c->offset = 0;
    uart_print("/OPEN ");
    _print_u32(c->fid);
    uart_putc(' ');
    uart_print(filename);
    uart_putc('\n');
}

static void _cb_dump(const void *data, unsigned length, void *arg) {
    _Ctx           *c   = (_Ctx *)arg;
    const uint8_t  *src = (const uint8_t *)data;
    for (unsigned i = 0; i < length; i++) {
        c->buf[c->len++] = src[i];
        if (c->len == GCOV_BUF_SIZE) _flush(c);
    }
}

/**
 * @brief Dump all accumulated gcov coverage data over the transport layer.
 */
void dump_gcov_info(void) {
    uart_print("/BEGIN\n");

    const struct gcov_info *const *info = __gcov_info_start;
    uint8_t fid = 0;

    while (info < __gcov_info_end) {
        /* Reset context and pool for each translation unit */
        _ctx.fid    = fid;
        _ctx.len    = 0;
        _ctx.offset = 0;
        _pool_idx   = 0;

        __gcov_info_to_gcda(*info, _cb_filename, _cb_dump, _cb_allocate, &_ctx);
        _flush(&_ctx);   /* Flush any remaining bytes in the staging buffer */

        uart_print("/CLOSE ");
        _print_u32(fid);
        uart_putc('\n');

        fid++;
        info++;
    }

    uart_print("/END\n");
}
