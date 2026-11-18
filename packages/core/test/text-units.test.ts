import { describe, expect, it } from 'vitest';
import { quote, splitLines } from '../src/subsurface/text.ts';
import { atoi, formatDegrees, formatMilli, lrint, parseDegrees, parseDuration, parseMilli, parseTemperature } from '../src/subsurface/units.ts';

describe('formatMilli (put_milli)', () => {
  it.each([
    [0, '0.0'],
    [11759, '11.759'],
    [27000, '27.0'],
    [250, '0.25'],
    [1020, '1.02'],
    [1800, '1.8'],
    [-500, '-0.5'],
  ])('%i → %s', (value, text) => {
    expect(formatMilli(value)).toBe(text);
  });
});

describe('number parsing', () => {
  it('rounds like lrint', () => {
    expect(lrint(2.5)).toBe(2);
    expect(lrint(3.5)).toBe(4);
    expect(lrint(-2.5)).toBe(-2);
  });

  it('reads milli values and temperatures', () => {
    expect(parseMilli('1.013bar')).toBe(1013);
    expect(parseMilli('11.759m')).toBe(11759);
    expect(parseTemperature('27.0°C')).toBe(300150);
  });

  it('round-trips degrees', () => {
    for (const text of ['47.906674', '-13.567017', '0.000001']) {
      expect(formatDegrees(parseDegrees(text))).toBe(text);
    }
  });
});

describe('fast paths give the results of the C functions', () => {
  it.each([
    ['0:00', 0], ['1:05', 65], ['45', 2700], ['1:5', 65], ['12:05 min', 725], ['1:', 60], [' 2:30', 150],
    ['-1:05', -55], ['+3', 180], ['x', 0], ['', 0], ['10:-5', 595], ['99999999999999999', 99999999999999999 * 60],
  ])('parseDuration(%j) = %d', (text, value) => {
    expect(parseDuration(text)).toBe(value);
  });
  it.each([['42', 42], ['007', 7], ['12x', 12], [' 7', 7], ['-3', -3], ['', 0], ['x1', 0]])('atoi(%j) = %d', (text, value) => {
    expect(atoi(text)).toBe(value);
  });
  it('splits lines with and without strings alike', () => {
    const { lines } = splitLines('  0:10 3.5m\nbuddy "A, B"\nnotes "two\nlines" x\n  0:20 4.0m');
    expect(lines).toEqual([
      { text: '  0:10 3.5m', strings: [] },
      { text: 'buddy "', strings: ['A, B'] },
      { text: 'notes " x', strings: ['two\nlines'] },
      { text: '  0:20 4.0m', strings: [] },
    ]);
  });
});

describe('quoted strings', () => {
  const samples = [
    'plain',
    '',
    'with "quotes" and \\ backslash',
    'two\nlines',
    'gap\n\n\nafter',
    'trailing newline\n',
    'tab\tinside',
    'Umlaute äöü ß',
  ];

  it.each(samples)('round-trips %j', (text) => {
    const { lines, skipped } = splitLines(`notes "${quote(text)}"\n`);
    expect(skipped).toEqual([]);
    expect(lines).toEqual([{ text: 'notes "', strings: [text] }]);
  });

  it('replaces control characters with "?"', () => {
    expect(quote('a\u0001b')).toBe('a?b');
  });

  it('skips lines that start with a tab or newline', () => {
    expect(splitLines('\tbroken\nok\n').skipped).toEqual(['\tbroken\n']);
  });
});
