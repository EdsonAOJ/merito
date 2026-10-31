import { isWithinReplayWindow } from './webhook-replay';

describe('isWithinReplayWindow', () => {
  const now = new Date('2026-10-31T18:00:00Z');

  it('should accepts an event within the past 5 minutes', () => {
    const occurredAt = new Date('2026-10-31T17:57:00Z');

    expect(isWithinReplayWindow(occurredAt, now)).toBe(true);
  });

  it('should accepts an event within the next 5 minutes', () => {
    const occurredAt = new Date('2026-10-31T18:02:00Z');

    expect(isWithinReplayWindow(occurredAt, now)).toBe(true);
  });

  it('should rejects an expired event', () => {
    const occurredAt = new Date('2026-10-31T17:50:00Z');

    expect(isWithinReplayWindow(occurredAt, now)).toBe(false);
  });

  it('should rejects an event too far in the future', () => {
    const occurredAt = new Date('2026-10-31T18:10:00Z');

    expect(isWithinReplayWindow(occurredAt, now)).toBe(false);
  });

  it('should rejects an invalid date', () => {
    expect(isWithinReplayWindow(new Date('invalid'), now)).toBe(false);
  });
});
