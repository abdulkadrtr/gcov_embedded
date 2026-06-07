/*
 * gcov_embedded_lib — gcov_linker.ld.inc
 *
 * To enable gcov data collection, include this file at the
 * SECTIONS block in your linker script:
 *
 *   SECTIONS
 *   {
 *       INCLUDE gcov_embedded_lib/ld/gcov_linker.ld.inc <- only this line
 *
 *       .text : { ... } > FLASH
 *       ...
 *   }
 *
 */

.gcov_info : {
    . = ALIGN(8);
    __gcov_info_start = .;
    KEEP(*(.gcov_info))
    __gcov_info_end = .;
} > FLASH
