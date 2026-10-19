/** 本机回环地址；局域网私有网段另见下方判定。 */
const LOOPBACK = new Set(['127.0.0.1', '::1']);

function ipv4(address: string): number[] | undefined {
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.some((part) => part > 255) ? undefined : parts;
}

/** 允许本机与同一局域网内的设备（例如手机访问 http://<局域网 IP>:5197）调用开发 API。 */
export function isLocalOrLanAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const address = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
  if (LOOPBACK.has(address)) return true;
  const parts = ipv4(address);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}
