# Leash wrist firmware (M5StickS3)

Holds the wrist shard of the manager key. Shows what it is asked to sign, decoded
from the raw calldata, and signs only when you press A. Hold B for 2 seconds to
revoke every key. Goes to sleep as a signer after 2 minutes without motion.

Development firmware: no secure boot, no flash encryption, reflashable any time.

```bash
pip install platformio
pio run -e sticks3 -t upload        # flash
pio device monitor                  # watch the JSON link
```

The first flash over UiFlow2 needs download mode: hold the side reset button while
plugged in until the green LED flashes, flash, then click the button once to boot.
After that, flashing resets the stick by itself.

`sticks3-autotest` presses A by itself. It exists only for the hardware self-test
(`cd ../../hub && npm run selftest`, with the hub stopped). Never leave it on the wrist.

A full backup of the original UiFlow2 flash is in `~/leash-backups/`. Restore with:

```bash
esptool.py --port /dev/cu.usbmodem* write_flash 0 ~/leash-backups/sticks3-uiflow2-14c19fd5ceac.bin
```
