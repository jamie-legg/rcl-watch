/**
 * Reconstructs Armagetron stream-format messages from a raw UDP datagram.
 *
 * Datagram layout (see `rec_peer` in `src/network/nNetwork.cpp`): messages
 * occupy bytes `[0, len - 2)`; the final 2 bytes are the sender's claimed net
 * id (big-endian).
 *
 * Each legacy stream message (see `nSendBuffer::AddMessage` +
 * `nStreamMessage::OnRead`):
 *   - descriptor : uint16 BE. (No `0x8000` flag: these are 0.2.8-era servers.)
 *   - messageId  : uint16 BE.
 *   - wordLen    : uint16 BE = number of 16-bit data words.
 *   - data       : `wordLen` words (each uint16 BE).
 *
 * The fixed-length framing lets us iterate every message and length-skip the
 * descriptors we don't decode. The framing has been verified to tile real
 * datagrams exactly.
 */

export type StreamMessage = {
  descriptor: number;
  messageId: number;
  words: number[];
};

export type ParsedDatagram = {
  senderId: number;
  messages: StreamMessage[];
};

export function parseDatagram(bytes: Uint8Array): ParsedDatagram {
  const messages: StreamMessage[] = [];
  if (bytes.length < 2) {
    return { senderId: 0, messages };
  }

  const end = bytes.length - 2;
  const senderId = (bytes[end] << 8) | bytes[end + 1];

  let pos = 0;
  while (pos + 6 <= end) {
    const descriptor = (bytes[pos] << 8) | bytes[pos + 1];
    const messageId = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const wordLen = (bytes[pos + 4] << 8) | bytes[pos + 5];
    const total = 6 + wordLen * 2;
    if (pos + total > end) break; // misframed / truncated

    const words: number[] = new Array(wordLen);
    for (let w = 0; w < wordLen; w++) {
      const o = pos + 6 + w * 2;
      words[w] = (bytes[o] << 8) | bytes[o + 1];
    }
    messages.push({ descriptor, messageId, words });
    pos += total;
  }

  return { senderId, messages };
}
