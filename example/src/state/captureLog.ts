import { Platform } from 'react-native';
import type {
  DeviceSensors,
  FixDecision,
  ProviderState,
  Track,
  TrackerEvent,
  TrackPoint,
  RawFix,
} from '@fieldtrack360/react-native-tracker';

// The durable record — the port of SampleApp/Core/CaptureLog.swift.
//
// Instrument before you tune. The single most expensive mistake available on this project is
// changing a constant to fix a field report without first knowing which layer the artefact appeared
// in, and this log is what makes that knowable a week later, on a device nobody has a debugger
// attached to.
//
// TWO DELIBERATE DIVERGENCES FROM THE iOS SAMPLE, both forced by the platform rather than chosen:
//
//  1. IT IS IN MEMORY, NOT A FILE. React Native ships no filesystem API, and the sample takes no
//     dependency to get one. The consequence is real and worth stating: the log does not survive a
//     relaunch, so the cross-launch comparison — where OEM and permission problems show up — is not
//     available here. Everything else about the format is identical, so a log shared from this app
//     and one shared from the iOS sample are read the same way.
//  2. THE JUMP BLOCK CANNOT WINDOW DECISIONS. The wire `FixDecision` carries no fix
//     timestamp, so "what was offered between these two stored points" cannot be answered from JS.
//     The jump itself is still reported; the `└─` line says why the breakdown is missing rather
//     than printing a breakdown computed over the wrong set.

/// How many lines the log holds before it starts dropping. A buffer depth, not a tuning constant:
/// nothing compares it and nothing decides on it.
const CAPACITY = 8000;

/// Consecutive stored points further apart than this are reported in the `JUMP` block.
///
/// DISTANCE, NOT TIME, is the trigger: a 300 m hop is a defect whether it took 12 s or 12 min. A
/// reporting threshold in a host app, not an engine constant — nothing in the pipeline reads it.
const JUMP_THRESHOLD_M = 250;

/// The width of the line-kind column. Purely cosmetic; it is what makes the log scannable by eye in
/// a mail client with no syntax highlighting.
const KIND_WIDTH = 8;

export class CaptureLog {
  private lines: string[] = [];

  /// Reported in the log rather than swallowed: a log with a hole in it that says so is
  /// diagnosable, and one that lies about being complete is not.
  private dropped = 0;

  /// The run banner, kept so `clear()` can re-emit it. Step 2 of the field-run protocol is "clear
  /// the capture log", immediately before a run — losing the device and permission context at
  /// exactly that moment would make the run that follows uninterpretable.
  private headerLines: string[] = [];

  // MARK: - Append

  append(line: string) {
    if (this.lines.length >= CAPACITY) {
      this.lines.shift();
      this.dropped += 1;
    }
    this.lines.push(line);
  }

  /// Something the app itself wants on the record: a button press, a refused start, a scenario
  /// label. `kind` is the caller's own column name so a field tester can grep for it.
  note(kind: string, detail: string) {
    this.append(stampedLine(kind, detail));
  }

  // MARK: - Run header

  /// Emitted at every launch. Carries the context that makes the rest of the log interpretable.
  ///
  /// Without it a log is a list of verdicts with no way to tell whether the device had background
  /// authorization, full accuracy, a pedometer, or a wake path at all — and those four facts
  /// explain most of what the verdicts below will say.
  runHeader(input: {
    sensors?: DeviceSensors;
    tier: string;
    accuracy: string;
    /** iOS Motion & Fitness, or `unavailable` on Android. */
    motion: string;
    /** Android ACTIVITY_RECOGNITION, or `unavailable` on iOS. Recorded next to `motion` rather than
     *  instead of it: the pair says which platform the log came from and which of the two consents
     *  was actually askable, and a header carrying only the applicable one cannot be diffed against
     *  a header from the other platform. */
    activity: string;
    /** Android POST_NOTIFICATIONS, or `unavailable` on iOS. In the header because a run whose
     *  foreground-service notification was never visible is a run the OS was free to kill early,
     *  and that is the first thing to check when a log stops mid-trip with no error in it. */
    notifications: string;
    provider?: ProviderState;
  }) {
    const rule = '='.repeat(78);
    const lines = [rule];
    lines.push(banner('RUN', new Date().toISOString()));
    lines.push(banner('APP', 'react-native-tracker sample'));
    lines.push(banner('DEVICE', `${Platform.OS} ${String(Platform.Version)}`));
    lines.push(
      banner(
        'PERM',
        `tier=${input.tier} accuracy=${input.accuracy} motion=${input.motion}` +
          ` activityRecognition=${input.activity} notifications=${input.notifications}`
      )
    );
    lines.push(banner('PROVIDER', describeProvider(input.provider)));
    lines.push(banner('SENSORS', describeSensors(input.sensors)));
    lines.push(...LEGEND);
    lines.push(rule);

    this.headerLines = lines;
    for (const line of lines) {
      this.append(line);
    }
  }

  // MARK: - Events

  /// One line per SDK event, in the log's own vocabulary.
  ///
  /// Every case of the 16-case union is handled. A log that records four of sixteen is a log whose
  /// silence means nothing, because nobody can tell "it did not happen" from "we do not write that
  /// one down".
  event(event: TrackerEvent) {
    switch (event.type) {
      case 'location':
        this.append(stampedLine('POINT', describePoint(event.point)));
        break;
      case 'locationRejected':
        this.append(stampedLine('DECISION', describeDecision(event.decision)));
        break;
      case 'motionChange': {
        const at = event.point
          ? coordinate(event.point.latitude, event.point.longitude)
          : 'n/a';
        this.append(stampedLine('MOTION', `state=${event.state} at=${at}`));
        break;
      }
      case 'activityChange':
        this.append(
          stampedLine(
            'ACTIVITY',
            `type=${event.activity} confidence=${event.confidence}`
          )
        );
        break;
      case 'enabledChange':
        this.append(stampedLine('ENABLED', `tracking=${event.enabled}`));
        break;
      case 'providerChange':
        this.append(stampedLine('PROVIDER', describeProvider(event.state)));
        break;
      case 'heartbeat':
        this.append(
          stampedLine('HEART', `at=${new Date(event.atMs).toISOString()}`)
        );
        break;
      // The centre and radius travel with the line, because a crossing read back a week later has
      // to be interpretable after the fence itself has been removed.
      case 'geofenceEnter':
      case 'geofenceExit':
      case 'geofenceDwell': {
        const kind = event.type.replace('geofence', '').toLowerCase();
        const { crossing } = event;
        this.append(
          stampedLine(
            'FENCE',
            `${kind} id=${crossing.geofenceId} ` +
              `centre=${coordinate(crossing.latitude, crossing.longitude)} ` +
              `r=${crossing.radiusM != null ? Math.round(crossing.radiusM) : 'n/a'}m`
          )
        );
        break;
      }
      // Android-only, and worth a line of their own: the SDK confirming an arm or a removal is how
      // a tester tells "the fence never armed" from "the fence armed and never fired".
      case 'geofenceAdded':
      case 'geofenceRemoved':
        this.append(
          stampedLine(
            'FENCE',
            `${event.type === 'geofenceAdded' ? 'added' : 'removed'} id=${event.geofenceId}`
          )
        );
        break;
      case 'powerSaveChange':
        this.append(stampedLine('POWER', `lowPower=${event.enabled}`));
        break;
      case 'sessionInterrupted':
        this.append(
          stampedLine(
            'SESSION',
            `interrupted id=${event.session.id}` +
              ` started=${new Date(event.session.startedAtMs).toISOString()}` +
              ` tag=${event.session.tag ?? 'none'}`
          )
        );
        break;
      case 'diagnostic':
        this.append(stampedLine('DIAG', event.message));
        break;
      case 'error':
        this.append(
          stampedLine('ERROR', `code=${event.code} message=${event.message}`)
        );
        break;
      default:
        // A log that silently drops an unrecognised event is a log whose silence no longer means
        // anything.
        this.append(
          stampedLine(
            'EVENT',
            'unrecognised event — SDK is newer than this build'
          )
        );
    }
  }

  // MARK: - Session dump

  /// The part that turns a log into an answer.
  ///
  /// Four analysis blocks, each justified by a question somebody actually asks after a field run,
  /// preceded by the layer counts and the RAW FIXES → STORED POINTS ratio. A wide gap in that ratio
  /// is the thing to go and explain.
  sessionDump(input: {
    sessionId: string;
    rawFixes: RawFix[];
    decisions: FixDecision[];
    points: TrackPoint[];
  }) {
    const { sessionId, rawFixes, decisions, points } = input;
    this.append(banner('DUMP', '-'.repeat(66)));
    this.append(
      banner('DUMP', `session=${sessionId} at=${new Date().toISOString()}`)
    );
    this.append(
      banner(
        'DUMP',
        `layers: rawFixes=${rawFixes.length} decisions=${decisions.length}` +
          ` storedPoints=${points.length} ratio=${ratio(rawFixes.length, points.length)}`
      )
    );
    if (rawFixes.length === 0) {
      this.append(
        banner(
          'DUMP',
          'the raw-fix layer is empty — enable persistRawFixes before the run, or layer 1 cannot answer anything'
        )
      );
    }

    this.histogram(decisions);
    this.acceptedBy(points);
    this.cadence(points);
    this.jumps(points);
    this.append(banner('DUMP', '-'.repeat(66)));
  }

  /// `HIST` — verdicts grouped by `VERDICT/reason`, descending.
  ///
  /// The single highest-value block in the log. A wall of Drift Suppressed and a wall of Sigma Gate
  /// Outlier look equally alarming and have opposite fixes; this tells you which one you have.
  private histogram(decisions: FixDecision[]) {
    if (decisions.length === 0) {
      this.append(
        banner(
          'HIST',
          'no decisions recorded — no fix was ever offered to the pipeline'
        )
      );
      return;
    }
    const counts = new Map<string, number>();
    for (const decision of decisions) {
      const key = `${decision.verdict.toUpperCase()}/${decision.reason}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of descending(counts)) {
      this.append(banner('HIST', tally(key, count, decisions.length)));
    }
  }

  /// `ACCEPTBY` — stored points grouped by the reason that accepted them.
  private acceptedBy(points: TrackPoint[]) {
    if (points.length === 0) {
      this.append(banner('ACCEPTBY', 'no points were stored for this session'));
      return;
    }
    const counts = new Map<string, number>();
    for (const point of points) {
      counts.set(point.acceptReason, (counts.get(point.acceptReason) ?? 0) + 1);
    }
    for (const [key, count] of descending(counts)) {
      this.append(banner('ACCEPTBY', tally(key, count, points.length)));
    }
  }

  /// `CADENCE` — the seconds between stored points.
  ///
  /// The ceiling on turn fidelity. If the median is 60 s while driving, no filter change will help —
  /// the tier gate is the problem, and the constant somebody was about to change is not.
  private cadence(points: TrackPoint[]) {
    // Points arrive ordered by id and are deliberately not re-sorted: ordering by timeMs is a
    // correctness mistake, not a preference.
    const deltas: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const delta = (points[index]!.timeMs - points[index - 1]!.timeMs) / 1000;
      if (delta >= 0) {
        deltas.push(delta);
      }
    }
    if (deltas.length === 0) {
      this.append(
        banner('CADENCE', 'fewer than two stored points — no cadence to report')
      );
      return;
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[middle - 1]! + sorted[middle]!) / 2
        : sorted[middle]!;
    this.append(
      banner(
        'CADENCE',
        `points=${points.length} median=${number(median, 1)}s` +
          ` min=${number(sorted[0]!, 1)}s` +
          ` max=${number(sorted[sorted.length - 1]!, 1)}s`
      )
    );
  }

  /// `JUMP` — consecutive stored points more than 250 m apart.
  ///
  /// On iOS this block also names what was offered in between, because "fixes were offered and
  /// rejected" and "no fix was offered at all" look identical on a map and are different bugs — the
  /// first is the pipeline's, the second is background execution's. The wire `FixDecision` carries
  /// no timestamp, so that half cannot be computed here; the line says so rather than guessing.
  private jumps(points: TrackPoint[]) {
    if (points.length < 2) {
      this.append(
        banner('JUMP', 'fewer than two stored points — nothing to compare')
      );
      return;
    }

    let found = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const distanceM = metres(from, to);
      if (distanceM <= JUMP_THRESHOLD_M) {
        continue;
      }

      found += 1;
      const durationSec = Math.max((to.timeMs - from.timeMs) / 1000, 0);
      const implied = durationSec > 0 ? distanceM / durationSec : 0;
      this.append(
        banner(
          'JUMP',
          `#${found} dist=${number(distanceM, 1)}m` +
            ` dt=${number(durationSec, 1)}s` +
            ` implied=${number(implied, 1)}m/s` +
            ` from=${coordinate(from.latitude, from.longitude)}` +
            ` to=${coordinate(to.latitude, to.longitude)}`
        )
      );
      this.append(
        banner(
          'JUMP',
          '└─ the offered-fix breakdown for this window is not available on the wire: FixDecision ' +
            'carries no fix timestamp, so a capture gap and a filter gap cannot be told apart from JS'
        )
      );
    }

    if (found === 0) {
      this.append(
        banner(
          'JUMP',
          `none — no consecutive stored points more than ${JUMP_THRESHOLD_M} m apart`
        )
      );
    }
  }

  // MARK: - Track summary

  /// The built track's numbers, so the log carries what the Track tab was showing.
  trackSummary(track: Track) {
    this.append(
      banner(
        'TRACK',
        `dist=${number(track.stats.distanceMeters, 1)}m` +
          ` total=${track.stats.durationSec}s` +
          ` moving=${track.stats.movingDurationSec}s` +
          ` stopped=${track.stats.stoppedDurationSec}s` +
          ` points=${track.points.length}` +
          ` segments=${track.segments.length}` +
          ` stops=${track.stops.length}` +
          ` arrows=${track.arrows.length}`
      )
    );
    const activity = Object.entries(track.stats.activityBreakdownSec ?? {})
      .sort((left, right) =>
        right[1] === left[1]
          ? left[0].localeCompare(right[0])
          : right[1] - left[1]
      )
      .map(([name, seconds]) => `${name}=${seconds}s`)
      .join(' ');
    this.append(
      banner('TRACK', `activity: ${activity === '' ? 'none' : activity}`)
    );
    this.append(
      banner(
        'TRACK',
        `warnings: ${track.warnings.length === 0 ? 'none' : track.warnings.join(', ')}`
      )
    );
  }

  // MARK: - Size and clear

  /// Rounded up, so a log with anything in it never reports 0 KB and reads as missing.
  sizeKB(): number {
    const bytes = this.text().length;
    return Math.ceil(bytes / 1024);
  }

  text(): string {
    const dropped =
      this.dropped > 0
        ? [
            banner(
              'DROP',
              `${this.dropped} lines were dropped — the buffer filled`
            ),
          ]
        : [];
    return [...dropped, ...this.lines].join('\n');
  }

  /// Empties the log and re-emits the run banner.
  clear() {
    this.lines = [];
    this.dropped = 0;
    for (const line of this.headerLines) {
      this.append(line);
    }
    this.note('NOTE', 'capture log cleared');
  }

  isEmpty(): boolean {
    return this.lines.length === 0;
  }
}

// MARK: - The embedded legend

/// The log gets shared with people who have never seen the codebase, and a file of key=value pairs
/// with no units is a file nobody outside the project can act on.
const LEGEND: string[] = [
  banner('HOWTO', 'HOW TO READ THIS FILE'),
  banner('HOWTO', 'Every event line is: <local time> | KIND | key=value …'),
  banner(
    'HOWTO',
    'Units: distances m, speeds m/s, times s, angles deg, accuracy m.'
  ),
  banner(
    'HOWTO',
    'POINT    a fix that WAS stored. odo=session odometer. spd/brg=n/a means the platform flagged them invalid — that is not zero.'
  ),
  banner(
    'HOWTO',
    'DECISION a fix that was NOT stored. moved=distance from the last stored point, sigma=filter innovation, gate=the threshold it was compared against.'
  ),
  banner(
    'HOWTO',
    'MOTION   capture state machine: stopped/moving/stopPending/stationary. It gates the sampling rate, never capture itself.'
  ),
  banner(
    'HOWTO',
    "ACTIVITY the platform's activity label with its confidence."
  ),
  banner(
    'HOWTO',
    'PROVIDER authorization, precise location, Location Services and power save, as they changed.'
  ),
  banner(
    'HOWTO',
    'ERROR    an SDK error code and message. backgroundPermissionMissing is a DEGRADATION, not a failure — capture continues in the foreground.'
  ),
  banner(
    'HOWTO',
    'DIAG     an SDK diagnostic. SESSION a session left open by termination. ENABLED tracking on/off. POWER power save. HEART the health loop is alive.'
  ),
  banner(
    'HOWTO',
    'NOTE     something this app recorded. DROP lines lost because the buffer was full.'
  ),
  banner(
    'HOWTO',
    'HIST     verdict histogram, descending. A wall of Drift Suppressed is a departure-ladder problem; a wall of Sigma Gate Outlier is a filter-lag problem. THEY HAVE OPPOSITE FIXES.'
  ),
  banner(
    'HOWTO',
    'ACCEPTBY accepted points grouped by the reason that accepted them.'
  ),
  banner(
    'HOWTO',
    'CADENCE  seconds between stored points. The ceiling on turn fidelity: a 60 s median while driving is a tier-gate problem, and no filter change will help.'
  ),
  banner(
    'HOWTO',
    'JUMP     consecutive stored points more than 250 m apart. On this platform the offered-fix breakdown is unavailable — FixDecision carries no timestamp on the wire.'
  ),
  banner('HOWTO', "TRACK    the built track's summary numbers."),
  banner(
    'HOWTO',
    'Read HIST first, then JUMP. Between them they name most problems before anyone opens a debugger.'
  ),
];

// MARK: - Line formatting

function stampedLine(kind: string, payload: string): string {
  return `${clock(new Date())} | ${pad(kind, KIND_WIDTH)} | ${payload}`;
}

/// A line with no timestamp column: banners and analysis blocks, which describe a span rather than
/// an instant.
function banner(kind: string, payload: string): string {
  return `${pad(kind, KIND_WIDTH)} | ${payload}`;
}

function describePoint(point: TrackPoint): string {
  return (
    `at=${coordinate(point.latitude, point.longitude)}` +
    ` acc=${number(point.accuracyM, 1)}` +
    // Validity travels as a flag: `n/a` is not `0`, and printing 0 here would teach a reader that
    // the device was stationary when the platform simply did not know.
    ` spd=${point.hasSpeed ? number(point.speedMps, 1) : 'n/a'}` +
    ` brg=${point.hasBearing ? number(point.bearingDeg, 1) : 'n/a'}` +
    ` odo=${number(point.odometerM, 1)}` +
    ` status=${point.movementStatus}` +
    ` act=${point.detectedActivity ?? 'none'}` +
    ` stop=${point.ios?.isSignificantStop == null ? 'n/a' : yesNo(point.ios.isSignificantStop)}` +
    ` batt=${point.batteryPct != null ? `${point.batteryPct}%` : 'n/a'}` +
    ` reason=${point.acceptReason}`
  );
}

function describeDecision(decision: FixDecision): string {
  return (
    `verdict=${decision.verdict.toUpperCase()}` +
    ` reason=${decision.reason}` +
    ` moved=${number(decision.distanceMovedM, 1)}` +
    ` sigma=${number(decision.sigma, 1)}` +
    ` gate=${number(decision.threshold, 1)}` +
    ` spd=${number(decision.effectiveSpeedMps, 1)}` +
    ` motion=${decision.motionState}` +
    // Layer 2. The filter's opinion is invisible unless it is written down for every fix, accepted
    // or not — the stored point carries the RAW coordinates by design.
    ` filter=${coordinate(decision.filterLatitude, decision.filterLongitude)}`
  );
}

function describeProvider(provider?: ProviderState): string {
  if (!provider) {
    return 'not read yet';
  }
  const parts = [
    `auth=${provider.permissionTier}`,
    `accuracy=${provider.accuracyAuthorization}`,
    `powerSave=${yesNo(provider.powerSave)}`,
  ];
  // The platform halves are absent, not false, on the other platform — so they are printed only
  // when present. "no significant-location-change" and "we cannot tell" are different facts.
  if (provider.ios) {
    parts.push(
      `services=${onOff(provider.ios.locationServicesEnabled)}`,
      `slc=${yesNo(provider.ios.significantLocationChangeAvailable)}`,
      `region=${yesNo(provider.ios.regionMonitoringAvailable)}`
    );
  }
  if (provider.android) {
    parts.push(
      `gps=${onOff(provider.android.gpsEnabled)}`,
      `network=${onOff(provider.android.networkEnabled)}`,
      `fused=${yesNo(provider.android.fusedAvailable)}`
    );
  }
  return parts.join(' ');
}

function describeSensors(sensors?: DeviceSensors): string {
  if (!sensors) {
    return 'not probed yet';
  }
  const parts = [`quality=${sensors.motionQuality}`];
  if (sensors.ios) {
    parts.push(
      `activity=${yesNo(sensors.ios.activityRecognition)}`,
      `steps=${yesNo(sensors.ios.stepCounting)}`
    );
  }
  if (sensors.android) {
    parts.push(
      `accel=${yesNo(sensors.android.accelerometer)}`,
      `steps=${yesNo(sensors.android.stepDetector)}`,
      `sigMotion=${yesNo(sensors.android.significantMotion)}`
    );
  }
  return parts.join(' ');
}

// MARK: - Values

function coordinate(latitude?: number, longitude?: number): string {
  if (latitude == null || longitude == null) {
    return 'n/a';
  }
  return `${number(latitude, 6)},${number(longitude, 6)}`;
}

function number(value: number, places: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(places);
}

function ratio(rawFixes: number, storedPoints: number): string {
  if (storedPoints === 0) {
    return 'n/a';
  }
  return `${number(rawFixes / storedPoints, 1)}:1`;
}

/// Descending by count, then ascending by name — so two dumps of the same session produce identical
/// blocks and a diff between them means something.
function descending(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((left, right) =>
    left[1] === right[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]
  );
}

function tally(label: string, count: number, total: number): string {
  const share = total > 0 ? (100 * count) / total : 0;
  return `${pad(label, 34)}${padLeft(String(count), 6)}  ${number(share, 1)}%`;
}

function clock(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const three = (value: number) => String(value).padStart(3, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.` +
    three(date.getMilliseconds())
  );
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off';
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/// Straight-line metres between two stored points.
///
/// The odometer delta was the alternative and is wrong for exactly the case this block exists to
/// catch: after a filter reseed the odometer does not advance, so the one teleport that matters most
/// would report as a 0 m jump.
function metres(from: TrackPoint, to: TrackPoint): number {
  const earthRadiusM = 6_371_000;
  const toRadians = Math.PI / 180;
  const lat1 = from.latitude * toRadians;
  const lat2 = to.latitude * toRadians;
  const deltaLat = (to.latitude - from.latitude) * toRadians;
  const deltaLng = (to.longitude - from.longitude) * toRadians;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  return (
    2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  );
}
