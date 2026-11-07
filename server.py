#!/usr/bin/env python3
"""Local HTTP server for JA11 Web Control with live USB audio stream status endpoint."""

import glob
import http.server
import json
import re
import socketserver
import subprocess

PORT = 8787


def format_sample_rate(hz):
    if hz % 1000 == 0:
        return f"{hz // 1000} kHz"
    return f"{hz / 1000:g} kHz"


def read_pipewire_ja11_status():
    try:
        out = subprocess.check_output(["pw-dump"], timeout=0.4, stderr=subprocess.DEVNULL)
        nodes = json.loads(out)
    except Exception:
        return None, None
    for node in nodes:
        props = node.get("info", {}).get("props", {})
        name = props.get("node.name", "")
        if "JA11" in name and "output" in name:
            formats = node.get("info", {}).get("params", {}).get("Format", [])
            for fmt in formats:
                rate = fmt.get("rate")
                raw_fmt = fmt.get("format", "")
                bits_m = re.search(r"(\d+)", raw_fmt)
                sr = format_sample_rate(int(rate)) if rate else None
                bd = f"{bits_m.group(1)}-bit" if bits_m else None
                if sr or bd:
                    return sr, bd
    return None, None


def read_ja11_stream_status():
    pw_rate, pw_bits = read_pipewire_ja11_status()
    for path in sorted(glob.glob("/proc/asound/card*/stream*")):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        if "JA11" not in text and "2972:" not in text:
            continue
        playback = text.split("Capture:")[0]
        status_match = re.search(
            r"Playback:\s+Status:\s+(\S+)(.*?)(?=Interface\s+\d+\s+Altset|\Z)",
            playback,
            re.DOTALL,
        )
        bit_depth = pw_bits
        sample_rate = pw_rate
        if status_match and status_match.group(1) == "Running":
            header = status_match.group(2)
            if not sample_rate:
                freq_m = re.search(r"Momentary freq\s*=\s*(\d+)\s*Hz", header)
                if freq_m:
                    sample_rate = format_sample_rate(int(freq_m.group(1)))
            iface_m = re.search(r"Interface\s*=\s*(\d+)", header)
            altset_m = re.search(r"Altset\s*=\s*(\d+)", header)
            if iface_m and altset_m:
                iface, altset = iface_m.group(1), altset_m.group(1)
                block_m = re.search(
                    rf"Interface\s+{iface}\s+Altset\s+{altset}\b(.*?)(?=Interface\s+\d+|\Z)",
                    playback,
                    re.DOTALL,
                )
                if block_m:
                    bits_m = re.search(r"Bits:\s*(\d+)", block_m.group(1))
                    if bits_m:
                        bit_depth = f"{bits_m.group(1)}-bit"
        if not bit_depth or not sample_rate:
            for hw_path in sorted(
                glob.glob(path.rsplit("/", 1)[0] + "/pcm*p/sub*/hw_params")
            ):
                try:
                    with open(hw_path, "r", encoding="utf-8", errors="replace") as hf:
                        hw = hf.read()
                    if not bit_depth:
                        fmt = re.search(r"format:\s+(\S+)", hw)
                        if fmt:
                            bits = re.search(r"(\d+)", fmt.group(1))
                            if bits:
                                bit_depth = f"{bits_m.group(1) if 'bits_m' in locals() and bits_m else bits.group(1)}-bit"
                    if not sample_rate:
                        rate_m = re.search(r"rate:\s+(\d+)", hw)
                        if rate_m:
                            sample_rate = format_sample_rate(int(rate_m.group(1)))
                except OSError:
                    pass
        return {"sampleRate": sample_rate, "bitDepth": bit_depth}
    return {"sampleRate": pw_rate, "bitDepth": pw_bits}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/stream-status":
            body = json.dumps(read_ja11_stream_status()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving HTTP on 0.0.0.0 port {PORT} (http://localhost:{PORT}/) ...", flush=True)
        httpd.serve_forever()
