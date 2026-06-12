// Parses an Instagram DM export .json with shape:
// {
//   account: "ananya.frames",
//   conversations: [{
//     participants: ["ananya.frames", "vsl.edits"],
//     participant_profiles: { "vsl.edits": { display_name, bio } },
//     messages: [{ sender, timestamp, text }]
//   }]
// }
// Profile bios are emitted as extra "dm" events so the extractor can pick up
// phone numbers hidden in bios (e.g. "for collab dm or call 70256 88904").

function parseInstagram(text, filename) {
  const data = JSON.parse(text);
  const account = data.account || null;
  const conversations = data.conversations || [];
  const events = [];

  conversations.forEach((conv, ci) => {
    const participants = conv.participants || [];
    const convRef = `conv${ci + 1}`;

    (conv.messages || []).forEach((msg, mi) => {
      const other = participants.find((p) => p !== msg.sender) || null;
      events.push({
        type: 'dm',
        timestamp: msg.timestamp ? new Date(msg.timestamp) : null,
        fromRaw: msg.sender,
        toRaw: other,
        content: msg.text || '',
        sourceRef: `${filename}:${convRef}:msg${mi + 1}`,
      });
    });

    const profiles = conv.participant_profiles || {};
    for (const [handle, profile] of Object.entries(profiles)) {
      if (!profile || !profile.bio) continue;
      events.push({
        type: 'dm',
        timestamp: null,
        fromRaw: handle,
        toRaw: null,
        content: `[profile bio of ${handle}${profile.display_name ? ` "${profile.display_name}"` : ''}] ${profile.bio}`,
        sourceRef: `${filename}:${convRef}:bio:${handle}`,
      });
    }
  });

  return { events, account };
}

module.exports = { parseInstagram };
