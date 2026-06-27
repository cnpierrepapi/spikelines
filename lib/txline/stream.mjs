// Robust SSE reader over fetch (the TxODDS reference example mis-parses with a
// "Message: " prefix + an undefined var; this follows the real SSE spec + the
// docs.yaml shape: data messages have id="ts:index" + JSON data; heartbeats have
// event:"heartbeat").
import { cfg } from "./config.mjs";

function parseSseEvent(raw) {
  const out = { event: "message", id: null, data: "" };
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    let val = i === -1 ? "" : line.slice(i + 1);
    if (val.startsWith(" ")) val = val.slice(1);
    if (field === "data") out.data += (out.data ? "\n" : "") + val;
    else if (field === "event") out.event = val;
    else if (field === "id") out.id = val;
  }
  if (!out.data) return null;
  try {
    out.json = JSON.parse(out.data);
  } catch {
    /* leave as raw string */
  }
  return out;
}

export async function openStream(path, { jwt, apiToken, onEvent, signal } = {}) {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": apiToken,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`stream ${path} ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseEvent(rawEvent);
        if (ev) onEvent(ev);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
