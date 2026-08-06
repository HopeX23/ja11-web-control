# JA11 HID protocol notes

The FiiO/JadeAudio JA11 exposes a vendor HID interface after firmware 1.9.

- USB vendor ID: `0x2972`
- USB product ID: `0x0102` (decimal 258)
- HID report ID: `2`
- EQ: 5 parametric bands
- Filter type values: `0 = PK`, `1 = LSC`, `2 = HSC`
- Device command interval in FiiO's JA11 configuration: `200 ms`

WebHID omits the report ID from the byte payload passed to `sendReport()` and
from `event.data`; every packet below is therefore the payload for report ID 2.

## Packet families

| Operation | Payload shape |
| --- | --- |
| Read one-byte value `cc` | `bb 0b 00 00 cc 00 00 ee` |
| Set one-byte value `cc = vv` | `aa 0a 00 00 cc 01 vv 00 ee` |
| Read master gain | `bb 0b 00 00 17 00 00 ee` |
| Read band `n` | `bb 0b 00 00 15 01 nn ee` |
| Set master gain | `aa 0a 00 00 17 02 lo hi 00 ee` |
| Set band | `aa 0a 00 00 15 08 nn gainHi gainLo freqHi freqLo qHi qLo type 00 ee` |
| Commit to device | `aa 0a 00 00 19 01 03 00 00 ee` |

Master gain uses signed 16-bit little-endian fixed point with scale 2560 per
dB. Band gain uses signed 16-bit big-endian tenths of a dB. Frequency is an
unsigned 16-bit big-endian integer in Hz. Q is unsigned 16-bit big-endian in
hundredths.

The implementation deliberately separates applying the live parameters from
the final commit command, so inspecting and importing configurations cannot
accidentally write persistent state.

Packet encoders reject non-finite, out-of-range, and unsupported-precision PEQ
values before any HID write. UI normalization therefore cannot hide a mismatch
between the displayed draft and the bytes sent to the JA11.

## Device state and control commands

The current official FiiO Control APK contains both a JA11 device configuration
and a JA11-specific native packet builder/parser. Together they identify these
commands:

| Dec | Hex | Value | Meaning |
| ---: | ---: | --- | --- |
| 2 | `02` | `0..60` | Independent device output volume |
| 9 | `09` | enum below | Current stream/sample-rate label |
| 11 | `0b` | 2 bytes | Firmware major and minor version |
| 18 | `12` | `0/1` | Headset microphone / inline remote detection |
| 21 | `15` | structured | Five-band PEQ band |
| 22 | `16` | `0..4` | Active EQ program |
| 23 | `17` | signed fixed point | PEQ master gain |
| 25 | `19` | `03` | Save User 1 PEQ to device |
| 27 | `1b` | none | Reset PEQ |
| 32 | `20` | `0/1` | UAC 1.0 / UAC 2.0 mode |

EQ program values are `0 = Vocal`, `1 = Classic`, `2 = Bass`, `3 = User 1`,
and `4 = Off`. The APK's JSON lists the four programs, while its JA11-specific
Java state logic explicitly maps response value `4` to EQ disabled. Firmware
2.20 on the connected device also returned `4` while EQ was off.

UAC values are `0 = UAC 1.0` and `1 = UAC 2.0`. Headset control and UAC changes
can alter the USB interface and are therefore handled as restart/reconnect
operations in the UI. A headset-control change was observed to re-enumerate the
connected firmware 2.20 device. UAC switching was not changed merely for test
purposes.

Sample-rate values are:

| Value | Display |
| ---: | --- |
| 0–10 | 32k, 44.1k, 48k, 88.2k, 96k, 176.4k, 192k, 352.8k, 384k, 705.6k, 768k |
| 11–14 | DSD64, DSD128, DSD256, DSD512 |

## Responses

After WebHID removes report ID 2, a simple response has this form:

`bb 0b seqHi seqLo command length payload… check ee`

The JA11 Android parser reads the command at byte 4, length at byte 5, and the
first one-byte value at byte 6. Firmware command 11 returns major and minor in
bytes 6 and 7. The PEQ response formats are described above and implemented in
`protocol.js`.

The official APK calculates a table-based check byte and increments a sequence
field. Packet captures in `fiiocontrol-oss`, this controller, and direct tests
against JA11 firmware 2.20 show that zero sequence/check bytes are accepted for
the control commands documented here. The parser intentionally ignores the
response check byte.

## Live verification

The connected JA11 was read through both WebHID and macOS HIDAPI. The verified
state was firmware 2.20, 352.8 kHz, volume 60/60, headset control on, UAC 2.0,
and EQ off. Device volume was changed `60 → 59 → 60` and verified after each
write. Headset control was changed off and restored on after its USB restart.
The EQ program was written as its existing `Off` value and read back unchanged.

## Provenance

The original PEQ packet structure was independently documented by the
open-source `adithyasource/fiiocontrol-oss` JA11 driver (Unlicense). The device
state table, one-byte command format, response parser, restart behavior, and EQ
Off value were then cross-checked against FiiO Control Android v4.3.0 and the
connected JA11.

Sources:

- https://github.com/adithyasource/fiiocontrol-oss
- https://forum.fiio.com/phoneNote/showNoteContent.do?id=202105071628040377809
- https://www.jadeaudio.com/Details?article_id=177&brd=1
