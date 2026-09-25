// Copy to secrets.h (gitignored). Everything here is optional.
// Networks are normally added from the phone (Wrist WiFi) and confirmed with A on the wrist.
// WIFI_SSID, if set, seeds the saved list the first time the wrist boots.
#pragma once
// #define WIFI_SSID "your-network"
// #define WIFI_PASS "password"
// mDNS name of the laptop running the hub (scutil --get LocalHostName).
#define HUB_MDNS "Hussains-MacBook-Pro"
// Last-resort hub address if nothing else finds it.
#define HUB_IP "0.0.0.0"
#define HUB_PORT 8788
