#!/usr/bin/env python3
"""
gcov_embedded_lib  -  gcov_server.py

Usage:
    python gcov_server.py --port /dev/ttyUSB0              # Linux
    python gcov_server.py --port COM3                      # Windows
    python gcov_server.py --port /dev/ttyUSB0 --baud 9600  # Custom baud
    python gcov_server.py --port COM3 --output-dir ./out   # Custom output dir

Dependencies:
    pip install pyserial
"""

import argparse
import serial
import sys
import os

TIMEOUT = 30

files: dict = {}  # fid → {path, data, offset}


def handle_line(line: str, ser: serial.Serial, output_dir: str) -> None:
    global files

    if line == "/BEGIN":
        print("[*] GCOV dump started")
        files = {}

    elif line == "/END":
        print("[*] GCOV dump completed.")
        for fid, f in files.items():
            path = f["path"]
            with open(path, "wb") as fp:
                fp.write(f["data"])
            print(f"[+] Saved: {path}  ({len(f['data'])} bytes)")

    elif line.startswith("/OPEN "):
        parts = line.split(" ", 2)
        if len(parts) < 3:
            print(f"[!] Error /OPEN line: {line!r}")
            return
        try:
            fid = int(parts[1])
        except ValueError:
            print(f"[!] Invalid fid in /OPEN: {parts[1]!r}")
            return
        path = parts[2].strip()
        if output_dir:
            path = os.path.join(output_dir, path)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        open(path, "wb").close()
        files[fid] = {"path": path, "data": bytearray(), "offset": 0}
        print(f"[+] OPEN   fid={fid}  path={path}")

    elif line.startswith("/WRITE "):
        parts = line.split(" ", 3)
        if len(parts) < 4:
            print(f"[!] Error /WRITE line: {line!r}")
            return
        try:
            fid    = int(parts[1])
            offset = int(parts[2])
            length = int(parts[3])
        except ValueError:
            print(f"[!] Invalid numeric field in /WRITE: {line!r}")
            return

        data = ser.read(length)
        if len(data) != length:
            print(
                f"[!] Warning: {length} bytes expected, {len(data)} received — "
                "data loss may have occurred! (check baud rate or timeout)"
            )

        if fid in files:
            f = files[fid]
            needed = offset + len(data)
            if len(f["data"]) < needed:
                f["data"].extend(b"\x00" * (needed - len(f["data"])))
            f["data"][offset : offset + len(data)] = data
            print(f"    WRITE  fid={fid}  offset={offset}  len={len(data)}")
        else:
            print(f"[!] Unknown fid={fid}; did /OPEN arrive?")

    elif line.startswith("/CLOSE "):
        try:
            fid = int(line.split(" ")[1])
        except (ValueError, IndexError):
            print(f"[!] Invalid /CLOSE line: {line!r}")
            return
        print(f"[+] CLOSE  fid={fid}")

    elif line.startswith("/ERROR "):
        print(f"[!] Device error: {line[7:].strip()}")

    else:
        # Coverage stream mixed with application logs; ignore
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="gcov_embedded_lib — serial host that receives .gcda files"
    )
    parser.add_argument("--port", required=True,
                        help="Serial port (e.g. /dev/ttyUSB0 or COM3)")
    parser.add_argument("--baud", type=int, default=115200,
                        help="Baud rate (default: 115200)")
    parser.add_argument("--output-dir", default=".",
                        help="Directory for received .gcda files (default: current dir)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    port       = args.port
    baud       = args.baud
    output_dir = args.output_dir

    if output_dir and output_dir != ".":
        os.makedirs(output_dir, exist_ok=True)

    print(f"[*] {port}  baud={baud}  timeout={TIMEOUT}s  output={output_dir} — listening.")
    try:
        ser = serial.Serial(port, baud, timeout=TIMEOUT)
    except serial.SerialException as exc:
        print(f"[!] Port not available: {exc}")
        sys.exit(1)

    try:
        while True:
            raw = ser.readline()
            if not raw:
                continue
            line = raw.decode("latin-1").strip()
            if not line:
                continue
            handle_line(line, ser, output_dir)
    except KeyboardInterrupt:
        print("\n[*] Stopping server.")
    finally:
        ser.close()


if __name__ == "__main__":
    main()