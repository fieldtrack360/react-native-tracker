#import "TrackerSyncModule.h"
#import <React/RCTBridgeModule.h>
// event emission (RN 0.87 New Arch): the injectable RCTCallableJSModules lets a TurboModule call
// RCTDeviceEventEmitter.emit without subclassing RCTEventEmitter or declaring supportedEvents. Same
// pattern as the main module, on a DISTINCT device event "TrackerSyncEmit". The class is declared in
// RCTBridgeModule.h — there is no separate header in 0.87.

// Second TurboModule host — the SEPARATE "TrackerSync" module. Bridges to the Swift
// implementation TrackerSyncImpl. CocoaPods generates "Tracker-Swift.h" (module name = pod name
// "Tracker"), which exposes the @objc members of BOTH TrackerImpl and TrackerSyncImpl — one pod, one
// Swift header. Every method stays thin sequencing (rule 2).
//
// BUILD NOTE: configure takes a plain NSString (the config JSON) and there are no object-typed
// params, so this module needs NONE of the codegen C++ argument structs (JS::NativeTrackerSync::Spec*)
// that the main .mm uses — the second host is strictly simpler.
#import "Tracker-Swift.h"

@implementation TrackerSyncModule

// RN injects RCTCallableJSModules into any TurboModule that synthesizes it (bridge + bridgeless).
@synthesize callableJSModules = _callableJSModules;

// Install the emit closure once. invokeModule:method:withArgs: marshals onto the JS thread, so the
// closure is safe to call from whatever thread the events() consumer Task runs on.
- (instancetype)init
{
  if (self = [super init]) {
    __weak TrackerSyncModule *weakSelf = self;
    [TrackerSyncImpl setEmitter:^(NSInteger subId, id payload) {
      __strong TrackerSyncModule *strongSelf = weakSelf;
      if (strongSelf == nil) { return; }
      RCTCallableJSModules *modules = strongSelf->_callableJSModules;
      if (modules == nil) { return; }
      NSDictionary *body = @{ @"id": @(subId), @"payload": (payload ?: (id)[NSNull null]) };
      [modules invokeModule:@"RCTDeviceEventEmitter"
                     method:@"emit"
                   withArgs:@[@"TrackerSyncEmit", body]];
    }];
  }
  return self;
}

// teardown — cancel every active subscriber Task on module dealloc / bridge reload.
- (void)dealloc
{
  [TrackerSyncImpl cancelAllSubscriptions];
}

// ── configure ──────────────────────────────────────────────────────────────────
- (void)configure:(NSString *)configJson
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl configureConfigJSON:configJson
                            onResolve:^{ resolve(nil); }
                             onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── requestSync ────────────────────────────────────────────────────────────────
- (void)requestSync:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl requestSyncOnResolve:^{ resolve(nil); }
                               onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── syncNow ────────────────────────────────────────────────────────────────────
- (void)syncNow:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl syncNowOnResolve:^(NSDictionary *result) { resolve(result); }
                          onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── pendingCount ───────────────────────────────────────────────────────────────
- (void)pendingCount:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl pendingCountOnResolve:^(NSDictionary *result) { resolve(result); }
                               onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── ios.onSyncEvent subscriptions ────────────────────────────────────────────────
// addListener/removeListeners are NativeEventEmitter bookkeeping — the RCTDeviceEventEmitter.emit
// path needs no supportedEvents, so they are no-ops.
- (void)addListener:(NSString *)eventName {}
- (void)removeListeners:(double)count {}

- (void)subscribeSyncEvents:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl subscribeSyncEventsOnResolve:^(NSNumber *subscriptionId) { resolve(subscriptionId); }
                                       onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)unsubscribe:(double)subscriptionId
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [TrackerSyncImpl unsubscribeId:(NSInteger)subscriptionId
                      onResolve:^{ resolve(nil); }
                       onReject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

// ── TurboModule plumbing ──────────────────────────────────────────────────────
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeTrackerSyncSpecJSI>(params);
}

// Same registration as the main module, under the DISTINCT JS name "TrackerSync".
RCT_EXPORT_MODULE(TrackerSync)

@end