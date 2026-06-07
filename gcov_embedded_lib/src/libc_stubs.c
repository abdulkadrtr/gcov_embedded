/*
 * libc_stubs.c — Weak-symbol stubs for libc functions referenced by libgcov.
 */

#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>

typedef struct { int dummy; } FILE;
static FILE _stderr_obj = {0};
__attribute__((weak)) FILE *_impure_ptr = &_stderr_obj;

__attribute__((weak)) void *malloc(size_t n) 
{
    (void)n;
    return NULL;
}

__attribute__((weak)) void free(void *p) 
{
    (void)p;
}

__attribute__((weak)) size_t strlen(const char *s) 
{
    size_t n = 0; while (*s++) n++; return n;
}

__attribute__((weak)) void *memcpy(void *dst, const void *src, size_t n) {
    uint8_t *d = dst; const uint8_t *s = src;
    while (n--) *d++ = *s++; return dst;
}

__attribute__((weak)) char *strchr(const char *s, int c) {
    while (*s) { if (*s == (char)c) return (char *)s; s++; } return NULL;
}

__attribute__((weak)) char *strcat(char *d, const char *s) {
    char *r = d; while (*d) d++; while ((*d++ = *s++)); return r;
}

__attribute__((weak)) char *strcpy(char *d, const char *s) {
    char *r = d; while ((*d++ = *s++)); return r;
}

__attribute__((weak)) int atoi(const char *s) { 
    (void)s; return 0; 
}

__attribute__((weak)) int sprintf(char *s, const char *fmt, ...) { 
    (void)s; (void)fmt; return 0; 
}

__attribute__((weak)) int fprintf(FILE *f, const char *fmt, ...) { 
    (void)f; (void)fmt; return 0; 
}

__attribute__((weak)) int vfprintf(FILE *f, const char *fmt, va_list ap) { 
    (void)f; (void)fmt; (void)ap; return 0; 
}

__attribute__((weak)) FILE *fopen(const char *a, const char *b) { 
    (void)a; (void)b; return NULL; 
}

__attribute__((weak)) int fclose(FILE *f) { 
    (void)f; return 0; 
}

__attribute__((weak)) int fseek(FILE *f, long o, int w) { 
    (void)f; (void)o; (void)w; return 0; 
}

__attribute__((weak)) size_t fread(void *p, size_t s, size_t n, FILE *f) { 
    (void)p; (void)s; (void)n; (void)f; return 0; 
}

__attribute__((weak)) size_t fwrite(const void *p, size_t s, size_t n, FILE *f) { 
    (void)p; (void)s; (void)n; (void)f; return 0; 
}

__attribute__((weak)) void abort(void) { 
    while(1);
}

__attribute__((weak)) void exit(int c) { 
    (void)c; while(1); 
}

__attribute__((weak)) char *getenv(const char *n) { 
    (void)n; return NULL; 
}

__attribute__((weak)) int getpid(void) { 
    return 1; 
}