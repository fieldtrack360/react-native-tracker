#import "TrackerModule.h"
#import <React/RCTBridgeModule.h>
// event emission (RN 0.87 New Arch): the injectable RCTCallableJSModules lets a TurboModule call
// RCTDeviceEventEmitter.emit without subclassing RCTEventEmitter or declaring supportedEvents. The
// protocol is declared in RCTBridgeModule.h — there is no separate header in 0.87.

// Bridges to the Swift implementation. CocoaPods generates "Tracker-Swift.h" (module name = pod
// name) exposing the @objc members of TrackerImpl and its per-subsystem extensions. Every method
// stays thin sequencing — no behaviour here; wire vocabulary lives in TrackerMappers.swift.
//
// BUILD NOTE: object-parameter methods take the codegen-generated C++ argument structs, reconciled
// against the emitted RNTrackerSpec.h: a named spec type keeps its name (PointQueryWire,
// TrackOptionsWire, TrackFixWire, GeofenceWire); an inline object literal becomes
// Spec<Method><Param> (SpecGetCurrentLocationOptions, SpecSetOsrmSnapProviderConfig,
// SpecGeofenceGetEventsOpts). The Swift side takes plain NSDictionary, so each struct is flattened
// here — an absent optional is simply not written, so the Swift mapper's "key missing → SDK default"
// rule holds.
#import "Tracker-Swift.h"

// PointQuery struct → wire dictionary.
static NSDictionary *RCTTrackerPointQueryDict(JS::NativeTracker::PointQueryWire &query)
{
  NSMutableDictionary *d = [NSMutableDictionary dictionary];
  if (NSString *sessionId = query.sessionId()) { d[@"sessionId"] = sessionId; }
  if (auto v = query.fromMs()) { d[@"fromMs"] = @(*v); }
  if (auto v = query.toMs()) { d[@"toMs"] = @(*v); }
  if (auto v = query.limit()) { d[@"limit"] = @(*v); }
  if (auto v = query.offset()) { d[@"offset"] = @(*v); }
  return d;
}

// TrackOptions struct → wire dictionary.
static NSDictionary *RCTTrackerTrackOptionsDict(JS::NativeTracker::TrackOptionsWire &options)
{
  NSMutableDictionary *d = [NSMutableDictionary dictionary];
  if (auto v = options.zoom()) { d[@"zoom"] = @(*v); }
  if (auto v = options.includeRawPoints()) { d[@"includeRawPoints"] = @(*v); }
  if (auto v = options.consolidateStops()) { d[@"consolidateStops"] = @(*v); }
  if (auto v = options.stopRadiusM()) { d[@"stopRadiusM"] = @(*v); }
  if (auto v = options.stopMinDwellSec()) { d[@"stopMinDwellSec"] = @(*v); }
  if (NSString *smoothing = options.smoothing()) { d[@"smoothing"] = smoothing; }
  if (auto v = options.splineSpacingM()) { d[@"splineSpacingM"] = @(*v); }
  if (auto v = options.bezierMinAngleDeg()) { d[@"bezierMinAngleDeg"] = @(*v); }
  if (auto v = options.bezierCutbackM()) { d[@"bezierCutbackM"] = @(*v); }
  if (auto v = options.snapToRoad()) { d[@"snapToRoad"] = @(*v); }
  if (auto v = options.snapMaxOffRoadM()) { d[@"snapMaxOffRoadM"] = @(*v); }
  if (auto v = options.polylinePrecision()) { d[@"polylinePrecision"] = @(*v); }
  if (auto bands = options.speedBandsKmph()) {
    NSMutableArray *values = [NSMutableArray array];
    for (double band : *bands) { [values addObject:@(band)]; }
    d[@"speedBandsKmph"] = values;
  }
  if (auto v = options.arrowMinSegmentM()) { d[@"arrowMinSegmentM"] = @(*v); }
  if (auto v = options.simplifyEpsilonM()) { d[@"simplifyEpsilonM"] = @(*v); }
  return d;
}

@implementation TrackerModule

// RN injects RCTCallableJSModules into any TurboModule that synthesizes it (bridge + bridgeless).
@synthesize callableJSModules = _callableJSModules;

// Install the emit closure once. invokeModule:method:withArgs: marshals onto the JS thread, so the
// closure is safe to call from whatever thread a native stream consumer runs on.
- (instancetype)init
{
  if (self = [super init]) {
    __weak TrackerModule *weakSelf = self;
    [TrackerImpl setEmitter:^(NSInteger subId, id payload) {
      __strong TrackerModule *strongSelf = weakSelf;
      if (strongSelf == nil) { return; }
      RCTCallableJSModules *modules = strongSelf->_callableJSModules;
      if (modules == nil) { return; }
      NSDictionary *body = @{ @"id": @(subId), @"payload": (payload ?: (id)[NSNull null]) };
      [modules invokeModule:@"RCTDeviceEventEmitter"
                     method:@"emit"
                   withArgs:@[@"TrackerEmit", body]];
    }];
  }
  return self;
}

// teardown — cancel every active subscriber Task on module dealloc / bridge reload.
- (void)dealloc
{
  [TrackerImpl cancelAllSubscriptions];
}

// ── getState (Phase 1 probe) ─────────────────────────────────────────────────
- (void)getState:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getStateOnResolve:^(NSDictionary *state) { resolve(state); }
                        onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
- (void)ready:(NSString *)configJson
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl readyWithConfigJSON:configJson
                        onResolve:^(NSDictionary *result) { resolve(result); }
                         onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)start:(NSString *)tag
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl startWithTag:tag
                 onResolve:^(NSDictionary *result) { resolve(result); }
                  onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)stop:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl stopOnResolve:^(NSDictionary *result) { resolve(result); }
                    onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Reads ────────────────────────────────────────────────────────────────────
- (void)getPoints:(JS::NativeTracker::PointQueryWire &)query
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getPointsQuery:RCTTrackerPointQueryDict(query)
                    onResolve:^(NSString *json) { resolve(json); }
                     onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getCount:(JS::NativeTracker::PointQueryWire &)query
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getCountQuery:RCTTrackerPointQueryDict(query)
                   onResolve:^(NSNumber *count) { resolve(count); }
                    onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getOdometerMeters:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getOdometerMetersOnResolve:^(NSNumber *meters) { resolve(meters); }
                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getSessions:(NSNumber *)fromMs
               toMs:(NSNumber *)toMs
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getSessionsFromMs:fromMs
                           toMs:toMs
                      onResolve:^(NSArray *sessions) { resolve(sessions); }
                       onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)currentSession:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl currentSessionOnResolve:^(NSDictionary *session) { resolve(session); }
                              onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Current location ──────────────────────────────────────────────────────────
- (void)getCurrentLocation:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getCurrentLocationOnResolve:^(NSDictionary *result) { resolve(result); }
                                  onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Plotting ──────────────────────────────────────────────────────────────────
- (void)buildTrack:(JS::NativeTracker::PointQueryWire &)query
           options:(JS::NativeTracker::TrackOptionsWire &)options
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl buildTrackQuery:RCTTrackerPointQueryDict(query)
                       options:RCTTrackerTrackOptionsDict(options)
                     onResolve:^(NSString *json) { resolve(json); }
                      onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)exportPolylineJson:(JS::NativeTracker::PointQueryWire &)query
                   options:(JS::NativeTracker::TrackOptionsWire &)options
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl exportPolylineJsonQuery:RCTTrackerPointQueryDict(query)
                               options:RCTTrackerTrackOptionsDict(options)
                             onResolve:^(NSString *json) { resolve(json); }
                              onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)exportGeoJson:(JS::NativeTracker::PointQueryWire &)query
              options:(JS::NativeTracker::TrackOptionsWire &)options
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl exportGeoJsonQuery:RCTTrackerPointQueryDict(query)
                          options:RCTTrackerTrackOptionsDict(options)
                        onResolve:^(NSString *json) { resolve(json); }
                         onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Road snapping ─────────────────────────────────────────────────────────────
- (void)setOsrmSnapProvider:(JS::NativeTracker::SpecSetOsrmSnapProviderConfig &)config
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl setOsrmSnapProviderWithBaseURL:config.baseUrl()
                                      profile:config.profile()
                                    onResolve:^{ resolve(nil); }
                                     onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)clearRoadSnapProvider:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl clearRoadSnapProviderOnResolve:^{ resolve(nil); }
                                     onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Live surface ──────────────────────────────────────────────────────────────
- (void)setActiveRoute:(NSArray *)points
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl setActiveRoutePoints:points
                         onResolve:^{ resolve(nil); }
                          onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)isOffRoute:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl isOffRouteOnResolve:^(NSNumber *off) { resolve(off); }
                          onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
- (void)getRawFixes:(NSString *)sessionId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getRawFixesSessionId:sessionId
                          onResolve:^(NSString *json) { resolve(json); }
                           onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getRawPoints:(NSString *)sessionId
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getRawPointsSessionId:sessionId
                           onResolve:^(NSString *json) { resolve(json); }
                            onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getDecisions:(NSString *)sessionId
               limit:(NSNumber *)limit
              offset:(NSNumber *)offset
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getDecisionsSessionId:sessionId
                               limit:limit
                              offset:offset
                           onResolve:^(NSString *json) { resolve(json); }
                            onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)offerFix:(JS::NativeTracker::TrackFixWire &)fix
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
  NSMutableDictionary *d = [NSMutableDictionary dictionary];
  d[@"timeMs"] = @(fix.timeMs());
  d[@"monotonicNanos"] = @(fix.monotonicNanos());
  d[@"receivedAtMonotonicNanos"] = @(fix.receivedAtMonotonicNanos());
  d[@"latitude"] = @(fix.latitude());
  d[@"longitude"] = @(fix.longitude());
  d[@"accuracyM"] = @(fix.accuracyM());
  if (auto v = fix.altitudeM()) { d[@"altitudeM"] = @(*v); }
  if (auto v = fix.verticalAccuracyM()) { d[@"verticalAccuracyM"] = @(*v); }
  d[@"speedMps"] = @(fix.speedMps());
  d[@"bearingDeg"] = @(fix.bearingDeg());
  d[@"hasSpeed"] = @(fix.hasSpeed());
  d[@"hasBearing"] = @(fix.hasBearing());
  if (NSString *p = fix.provider()) { d[@"provider"] = p; }
  d[@"isMock"] = @(fix.isMock());
  if (auto v = fix.speedAccuracyMps()) { d[@"speedAccuracyMps"] = @(*v); }
  if (auto v = fix.bearingAccuracyDeg()) { d[@"bearingAccuracyDeg"] = @(*v); }
  [TrackerImpl offerFixFix:d
                 onResolve:^{ resolve(nil); }
                  onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getSensors:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getSensorsOnResolve:^(NSDictionary *sensors) { resolve(sensors); }
                          onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)iosChangePace:(BOOL)isMoving
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl changePaceIsMoving:isMoving
                        onResolve:^(NSDictionary *result) { resolve(result); }
                         onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Permissions ───────────────────────────────────────────────────────────────
- (void)getPermissionTier:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getPermissionTierOnResolve:^(NSString *tier) { resolve(tier); }
                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getAccuracy:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getAccuracyOnResolve:^(NSString *accuracy) { resolve(accuracy); }
                           onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)shouldStopAsking:(double)attempts
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl shouldStopAskingAttempts:(NSInteger)attempts
                             onResolve:^(NSNumber *stop) { resolve(stop); }
                              onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)requestForeground:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl requestForegroundOnResolve:^(NSString *tier) { resolve(tier); }
                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)requestBackground:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl requestBackgroundOnResolve:^(NSDictionary *req) { resolve(req); }
                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)openAppSettings:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl openAppSettingsOnResolve:^(NSNumber *opened) { resolve(opened); }
                               onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getBackgroundRequest:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getBackgroundRequestOnResolve:^(NSDictionary *req) { resolve(req); }
                                    onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)iosRequestMotion:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl iosRequestMotionOnResolve:^(NSString *auth) { resolve(auth); }
                                onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)iosGetMotionAuthorization:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl iosGetMotionAuthorizationOnResolve:^(NSString *auth) { resolve(auth); }
                                         onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)iosRequestTemporaryFullAccuracy:(NSString *)purposeKey
                                resolve:(RCTPromiseResolveBlock)resolve
                                 reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl iosRequestTemporaryFullAccuracyPurposeKey:purposeKey
                                              onResolve:^(NSString *accuracy) { resolve(accuracy); }
                                               onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)getBatteryInfo:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl getBatteryInfoOnResolve:^(NSDictionary *v) { resolve(v); }
                              onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidIntegrity:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidIntegrityOnResolve:^(NSString *v) { resolve(v); }
                                onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidCheckIntegrity:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidCheckIntegrityOnResolve:^(NSString *v) { resolve(v); }
                                     onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidLicenseInfo:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidLicenseInfoOnResolve:^(NSString *v) { resolve(v); }
                                  onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidCheckLicense:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidCheckLicenseOnResolve:^(NSString *v) { resolve(v); }
                                   onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidHasActivityRecognition:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidHasActivityRecognitionOnResolve:^(NSNumber *v) { resolve(v); }
                                             onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidRequestActivityRecognition:(RCTPromiseResolveBlock)resolve
                                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidRequestActivityRecognitionOnResolve:^(NSNumber *v) { resolve(v); }
                                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidHasNotificationPermission:(RCTPromiseResolveBlock)resolve
                                  reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidHasNotificationPermissionOnResolve:^(NSNumber *v) { resolve(v); }
                                                onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)androidRequestNotification:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl androidRequestNotificationOnResolve:^(NSNumber *v) { resolve(v); }
                                          onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Geofencing ────────────────────────────────────────────────────────────────
- (void)geofenceAdd:(JS::NativeTracker::GeofenceWire &)fence
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  NSMutableDictionary *d = [NSMutableDictionary dictionary];
  d[@"id"] = fence.id_() ?: @"";
  d[@"latitude"] = @(fence.latitude());
  d[@"longitude"] = @(fence.longitude());
  d[@"radiusM"] = @(fence.radiusM());
  if (auto v = fence.notifyOnEntry()) { d[@"notifyOnEntry"] = @(*v); }
  if (auto v = fence.notifyOnExit()) { d[@"notifyOnExit"] = @(*v); }
  if (auto v = fence.dwellAfterMs()) { d[@"dwellAfterMs"] = @(*v); }
  [TrackerImpl geofenceAddFence:d
                     onResolve:^(NSDictionary *result) { resolve(result); }
                      onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceList:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl geofenceListOnResolve:^(NSArray *fences) { resolve(fences); }
                            onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceGet:(NSString *)identifier
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl geofenceGetId:identifier
                  onResolve:^(NSDictionary *fence) { resolve(fence); }
                   onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceRemove:(NSString *)identifier
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl geofenceRemoveId:identifier
                     onResolve:^(NSDictionary *result) { resolve(result); }
                      onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceRemoveAll:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl geofenceRemoveAllOnResolve:^(NSDictionary *result) { resolve(result); }
                                 onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceGetEvents:(JS::NativeTracker::SpecGeofenceGetEventsOpts &)opts
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  NSMutableDictionary *o = [NSMutableDictionary dictionary];
  if (NSString *geofenceId = opts.geofenceId()) { o[@"geofenceId"] = geofenceId; }
  if (auto v = opts.fromMs()) { o[@"fromMs"] = @(*v); }
  if (auto v = opts.toMs()) { o[@"toMs"] = @(*v); }
  if (auto v = opts.limit()) { o[@"limit"] = @(*v); }
  if (auto v = opts.offset()) { o[@"offset"] = @(*v); }
  [TrackerImpl geofenceGetEventsOpts:o
                          onResolve:^(NSArray *crossings) { resolve(crossings); }
                           onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)geofenceDeleteEvents:(JS::NativeTracker::SpecGeofenceDeleteEventsOpts &)opts
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  NSMutableDictionary *o = [NSMutableDictionary dictionary];
  if (NSString *geofenceId = opts.geofenceId()) { o[@"geofenceId"] = geofenceId; }
  if (auto v = opts.fromMs()) { o[@"fromMs"] = @(*v); }
  if (auto v = opts.toMs()) { o[@"toMs"] = @(*v); }
  [TrackerImpl geofenceDeleteEventsOpts:o
                              onResolve:^(NSNumber *count) { resolve(count); }
                               onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── Subscriptions ──────────────────────────────────────────────────────────────
// addListener/removeListeners are NativeEventEmitter bookkeeping — the RCTDeviceEventEmitter.emit
// path needs no supportedEvents, so they are no-ops.
- (void)addListener:(NSString *)eventName {}
- (void)removeListeners:(double)count {}

- (void)subscribe:(NSString *)stream
              arg:(NSString *)arg
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl subscribeStream:stream
                           arg:arg
                     onResolve:^(NSNumber *subscriptionId) { resolve(subscriptionId); }
                      onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)unsubscribe:(double)subscriptionId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerImpl unsubscribeId:(NSInteger)subscriptionId
                  onResolve:^{ resolve(nil); }
                   onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── TurboModule plumbing ──────────────────────────────────────────────────────
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeTrackerSpecJSI>(params);
}

// Registers the class under the JS name the spec asks for (TurboModuleRegistry.getEnforcing('Tracker')).
// The macro supplies +moduleName AND the +load-time RCTRegisterModule that makes the class findable —
// a hand-written +moduleName alone leaves the module unregistered and getEnforcing throws.
RCT_EXPORT_MODULE(Tracker)

@end
