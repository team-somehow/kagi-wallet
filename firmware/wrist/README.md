# Kagi wrist firmware (M5StickS3)

Holds the Kagi Wallet shard of the manager key. Shows what it is asked to sign, decoded
from the raw calldata, and signs only when you press A. Hold B for 2 seconds to
revoke every key. Goes to sleep as a signer after 2 minutes without motion.

Development firmware: no secure boot, no flash encryption, reflashable any time.

## Flash without building

The website's Get Kagi section flashes the release image from Chrome or Edge over
Web Serial, and can set a device's vault role over the same cable. The image is also
attached to each GitHub release as `kagi-firmware-<version>.bin`, a merged image
that goes at offset 0:

```bash
esptool.py --chip esp32s3 write_flash 0x0 kagi-firmware-0.6.2.bin
```

Release images are built without `src/secrets.h`; add WiFi networks from the phone.

## WiFi

The Kagi Wallet joins a 2.4 GHz network and dials out to the hub on TCP port 8788. It never
listens. It finds the laptop by mDNS name first, then falls back to a fixed IP. USB
serial still works when the stick is plugged in.

```bash
cp src/secrets.example.h src/secrets.h   # gitignored: SSID, password, hub name and IP
```

The laptop and the stick must be on the same network. A phone hotspot works: the
firmware forces WPA2 without PMF, because the stick fails WPA2/WPA3 transition mode.
The top right of the Kagi Wallet screen shows the link: wifi, no hub, or no wifi. Status
messages carry the WiFi address and the last disconnect reason for debugging.

The link is plain TCP on the local network, with no encryption. Anything on that
network can send requests, so pairing, signing and erasing the shard all need a
press of A on the Kagi Wallet.

```bash
pip install platformio
pio run -e sticks3 -t upload        # flash
pio device monitor                  # watch the JSON link
```

The first flash over UiFlow2 needs download mode: hold the side reset button while
plugged in until the green LED flashes, flash, then click the button once to boot.
After that, flashing resets the stick by itself.

`sticks3-autotest` presses A by itself. It exists only for the hardware self-test
(`cd ../../hub && npm run selftest`, with the hub stopped). Never leave it on the Kagi Wallet.

A full backup of the original UiFlow2 flash is in `~/leash-backups/`. Restore with:

```bash
esptool.py --port /dev/cu.usbmodem* write_flash 0 ~/leash-backups/sticks3-uiflow2-14c19fd5ceac.bin
```
