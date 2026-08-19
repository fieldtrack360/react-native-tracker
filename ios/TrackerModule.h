#import <RNTrackerSpec/RNTrackerSpec.h>

// TurboModule host. Conforms to the codegen-generated NativeTrackerSpec protocol; the
// actual work lives in Swift (TrackerModule.swift) and is reached through TrackerImpl.
// This file stays thin sequencing over the facade (rule 2).
@interface TrackerModule : NSObject <NativeTrackerSpec>
@end
