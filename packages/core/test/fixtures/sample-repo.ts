/**
 * A small, made-up Subsurface repository in canonical form. Every value is synthetic.
 *
 * It covers: settings with a named dive computer and a fingerprint, sites with and without
 * taxonomy, a filter preset, a trip whose dives span two months (so dive directories carry a
 * month prefix), a dive with two dive computers and pictures, a dive outside any trip, escaped
 * and multi-line strings, events including a gas change, and samples using most fields.
 */
const lines = (...l: string[]): string => `${l.join('\n')}\n`;

export const sampleRepo = {
  '00-Subsurface': lines(
    'version 3',
    'divecomputerid "Garmin Descent Mk2" deviceid=5d41402a serial="1234567890" nickname="Test watch"',
    'fingerprint model=26707b96 serial=00000000 deviceid=ab668286 diveid=1c2d3e4f data="31323334353637383930315f41435449564954592e666974"',
    'autogroup',
    'units METRIC',
    'prefs DCCEILING',
  ),
  '01-Divesites': {
    'Site-0000abcd': lines(
      'name "Test Reef"',
      'description ""',
      'notes ""',
      'gps 27.123456 33.987654',
      'geo cat 2 origin 0 "Egypt"',
    ),
    'Site-00c0ffee': lines(
      'name "Lake Spot"',
      'description "Entry by the jetty"',
      'notes "Line one',
      '\tLine two"',
      'gps 47.906674 -13.567017',
    ),
  },
  '02-Filterpresets': {
    'Preset-000': lines('name "Deep dives"', 'constraint type="max_depth" rangemode="greater" data="30000"'),
  },
  '2026': {
    '04': {
      '26-TestTrip': {
        '00-Trip': lines('date 2026-04-26', 'time 10:13:05', 'location "Test Trip, Somewhere"', 'notes ""'),
        '04-26-Sun-10=13=05': {
          'Dive-1': lines(
            'duration 42:44 min',
            'rating 4',
            'visibility 3',
            'tags "Training", "Lake"',
            'divesiteid 00c0ffee',
            'divemaster "Alex Example"',
            'buddy "Sam Sample"',
            'suit "7 mm wetsuit"',
            'notes "First line',
            '',
            '\tafter empty"',
            'cylinder vol=12.0l workpressure=232.0bar description="12L Steel" o2=32.0% start=200.0bar end=50.0bar',
            'weightsystem weight=6.0kg description="Belt"',
            'airtemp 18.0°C',
          ),
          Divecomputer: lines(
            'model "Garmin Descent Mk2"',
            'deviceid 5d41402a',
            'diveid 1a2b3c4d',
            'maxdepth 12.345m',
            'meandepth 7.8m',
            'watertemp 14.0°C',
            'salinity 1000g/l',
            'keyvalue "Serial" "1234567890"',
            'event 0:30 type=26 flags=4 name="Safety stop begin"',
            'event 1:00 type=11 flags=1 value=32 name="gaschange" cylinder=0 o2=32.0%',
            '  0:00 0.0m 15.2°C ndl=99:00 heartbeat=90',
            '  0:10 3.5m',
            '  0:20 8.25m 14.9°C ndl=55:00 cns=1% po2=0.3bar heartbeat=95',
            '  0:30 12.345m in_deco=1 stoptime=1:00 stopdepth=3.0m',
            '  0:40 10.0m 14.0°C in_deco=0 stoptime=0:00 stopdepth=0.0m',
            '  0:50 0.0m 200.0bar:0 bearing=90°',
          ),
        },
        '05-01-Fri-11=31=26': {
          'Dive-2': lines(
            'duration 34:55 min',
            'divesiteid 00c0ffee',
            'divemaster ""',
            'buddy ""',
            'suit ""',
            'notes ""',
          ),
          'Divecomputer-001': lines('model "Garmin Descent Mk2"', 'diveid 0badf00d', 'maxdepth 9.0m', '  0:00 1.0m', '  0:30 9.0m'),
          'Divecomputer-002': lines(
            'model "Manually added dive"',
            'date 2026-05-01',
            'time 11:30:00',
            'duration 30:00min',
            'dctype CCR',
            'numberofoxygensensors 3',
            'maxdepth 8.5m',
            'surfacepressure 1.013bar',
            'surfacetime 1:30min',
          ),
          Pictures: {
            '+00=05=00': lines('filename "photos/one.jpg"', 'gps 27.100000 33.900000'),
            '-00=01=30': lines('filename "photos/two.jpg"'),
          },
        },
      },
    },
    '07': {
      '18-Sat-10=19=29': {
        'Dive-3': lines(
          'duration 5:00 min',
          'notrip',
          'invalid',
          'divemaster ""',
          'buddy "Solo"',
          'suit ""',
          'notes "Quote \\"inside\\" and backslash \\\\ end"',
          'weightsystem weight=0.0kg description=""',
          'watertemp 21.5°C',
        ),
        Divecomputer: lines('model ""', 'lastmanualtime 5:00min', 'maxdepth 3.0m'),
      },
    },
  },
};
