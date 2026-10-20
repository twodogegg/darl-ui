// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isLocalOrLanAddress } from '../examples/agent-chat/server/local-access';

describe('local or LAN access',()=>{
  it('accepts loopback and private LAN addresses',()=>{
    for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1','192.168.0.146','::ffff:192.168.0.146','10.0.0.5','172.16.0.9','172.31.255.1','169.254.3.4'])
      expect(isLocalOrLanAddress(address),address).toBe(true);
  });
  it('rejects public, empty and malformed addresses',()=>{
    for(const address of [undefined,'','8.8.8.8','172.32.0.1','10.0.0.256','fe80::1','localhost'])
      expect(isLocalOrLanAddress(address),String(address)).toBe(false);
  });
});
