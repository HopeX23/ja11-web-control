# JA11 Web Control

A small, dependency-free WebHID controller for the FiiO/JadeAudio JA11.
It reads and controls device volume, headset mic/remote detection, USB Audio
Class mode, built-in EQ programs, and the five-band User 1 PEQ. It also shows
live sample rate and firmware, previews PEQ changes, persistently saves them,
and imports/exports User 1 configurations as JSON.

## Use online

Open **[JA11 Web Control](https://cyfine.github.io/ja11-web-control/)** in a
desktop Chromium browser, connect the dongle directly, then select **Connect
JA11** and approve the browser's device picker.

WebHID access is granted per website. A JA11 previously approved on localhost
must therefore be approved once again on the GitHub Pages address.

## Run

1. Connect a JA11 running firmware 1.9 or newer directly to the Mac.
2. In this directory, run `npm start`.
3. Open `http://localhost:8787` in a desktop Chromium browser with WebHID, such as
   Chrome, Edge, Opera, or a Codex in-app browser build that exposes device
   permissions. Safari and Firefox do not currently expose WebHID.
4. Select **Connect JA11** and approve the browser's device picker.

Changing headset control or UAC mode restarts the dongle, so reconnect after it
re-enumerates. The User 1 persistent-write command is sent only by **Save to
JA11**; **Apply for listening** changes the active sound without committing the
PEQ memory.

## Development

Run the protocol tests with `npm test`. See [PROTOCOL.md](./PROTOCOL.md)
for the wire format and live-verification record.

This project is an independent interoperability tool and is not affiliated
with FiiO. Protocol details were informed by the Unlicense-licensed
`fiiocontrol-oss` project; see the provenance section in `PROTOCOL.md`.

## License

[MIT](./LICENSE).
