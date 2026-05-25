import { describe, it, expect } from 'vitest';
import { fmtTime, parseResolution, calcEta, clamp } from './utils';

describe('fmtTime', () => {
  it('formats zero seconds', () => {
    expect(fmtTime(0)).toBe('0:00');
  });

  it('formats seconds only', () => {
    expect(fmtTime(30)).toBe('0:30');
    expect(fmtTime(59)).toBe('0:59');
  });

  it('formats minutes and seconds', () => {
    expect(fmtTime(90)).toBe('1:30');
    expect(fmtTime(600)).toBe('10:00');
    expect(fmtTime(61)).toBe('1:01');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(fmtTime(3600)).toBe('1:00:00');
    expect(fmtTime(3661)).toBe('1:01:01');
    expect(fmtTime(7200)).toBe('2:00:00');
  });

  it('handles fractional seconds by flooring', () => {
    expect(fmtTime(90.7)).toBe('1:30');
    expect(fmtTime(0.1)).toBe('0:00');
  });
});

describe('parseResolution', () => {
  it('parses standard resolution', () => {
    expect(parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 });
  });

  it('parses resolution embedded in text', () => {
    expect(parseResolution('Video: h264 1280x720 yuv420p')).toEqual({ width: 1280, height: 720 });
  });

  it('returns null for no match', () => {
    expect(parseResolution('no resolution here')).toBeNull();
    expect(parseResolution('')).toBeNull();
  });

  it('parses small resolution', () => {
    expect(parseResolution('320x240')).toEqual({ width: 320, height: 240 });
  });
});

describe('calcEta', () => {
  it('calculates ETA correctly', () => {
    expect(calcEta(100, 2)).toBe(50);
    expect(calcEta(60, 1)).toBe(60);
    expect(calcEta(30, 0.5)).toBe(60);
  });

  it('returns null for zero speed', () => {
    expect(calcEta(100, 0)).toBeNull();
  });

  it('returns null for negative speed', () => {
    expect(calcEta(100, -1)).toBeNull();
  });

  it('returns 0 for zero remaining', () => {
    expect(calcEta(0, 2)).toBe(0);
  });
});

describe('clamp', () => {
  it('clamps value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles min equals max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});
