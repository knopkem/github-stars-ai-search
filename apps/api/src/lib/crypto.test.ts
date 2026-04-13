import { describe, expect, it } from 'vitest';
import { EncryptionService } from './crypto.js';

describe('EncryptionService', () => {
  it('round-trips encrypted values', () => {
    const service = new EncryptionService(Buffer.alloc(32, 7));
    const encrypted = service.encrypt('super-secret-token');
    expect(service.decrypt(encrypted)).toBe('super-secret-token');
  });
});
