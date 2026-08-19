#import <RNTrackerSpec/RNTrackerSpec.h>

// Second TurboModule host — the SEPARATE "TrackerSync" module, distinct from "Tracker".
// Conforms to the codegen-generated NativeTrackerSyncSpec protocol (same codegen library
// RNTrackerSpec as the main module); the work lives in Swift (TrackerSyncModule.swift) and is reached
// through TrackerSyncImpl. This file stays thin sequencing over the facade (rule 2).
@interface TrackerSyncModule : NSObject <NativeTrackerSyncSpec>
@end