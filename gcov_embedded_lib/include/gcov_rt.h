/*
 * gcov_rt.h — Public API for the embedded gcov runtime library.
 */
#ifndef GCOV_RT_H
#define GCOV_RT_H

#ifdef __cplusplus
extern "C" {
#endif

struct gcov_info;

extern const struct gcov_info *__gcov_info_start[];
extern const struct gcov_info *__gcov_info_end[];

/**
 * @brief Dump all accumulated gcov coverage data over the transport layer.
 */
void dump_gcov_info(void);

#ifdef __cplusplus
}
#endif

#endif /* GCOV_RT_H */
