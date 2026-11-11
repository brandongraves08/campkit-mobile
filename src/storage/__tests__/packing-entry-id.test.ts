import { describe, expect, it } from '@jest/globals';
import { assertPackingEntryId } from '../database';

describe('backend packing-entry identifiers', () => {
  it('accepts positive integer backend IDs and legacy UUID identifiers', () => {
    expect(() => assertPackingEntryId('12')).not.toThrow();
    expect(() => assertPackingEntryId('22222222-2222-4222-8222-222222222222')).not.toThrow();
  });

  it.each(['0', '-1', '01', '1.2', '9007199254740992', 'not-an-id'])('rejects malformed or out-of-range entry ID %s', (entryId) => {
    expect(() => assertPackingEntryId(entryId)).toThrow(/packing entry ID/i);
  });
});
