import Foundation
import UIKit
import TrackerCore

// permissions subsystem — iOS half of the bridge. @objc static entry points behind the
// ObjC++ TurboModule host (TrackerModule.mm), each taking plain ObjC block closures so no
// React headers are needed here (matches the getState scaffold in TrackerModule.swift).
//
// PermissionManager (TrackerCore.swiftinterface, lines 59-72) is @MainActor, and
// Tracker.shared.permissions() (line 374) is @MainActor too, so every call runs inside
// `Task { @MainActor in }`. Enum→wire goes through TrackerMappers:
//   - permissionTier(AuthorizationTier)   VALUE rename whenInUse → foreground
//   - accuracyAuthorization(LocationAccuracy) VALUE rename reduced/full → approximate/precise
// MotionAuthorization.rawValue is already the wire vocabulary (notDetermined/denied/restricted/
// authorized) so it needs no mapper.
//
// BackgroundRequest is a union: it is synthesised to { kind } by `backgroundRequestKind` below.
// The URL inside `.needsSettings` stays native — openAppSettings() acts on settingsURL.
// (This tiny union→kind map is kept local to the permissions subsystem; assembly may lift it
// into TrackerMappers verbatim if it prefers all vocabulary centralised.)
//
// platform gaps: Android-only methods REJECT here with the bridge code
// `unsupportedOnPlatform`, naming the method and the platform.
extension TrackerImpl {

  // MARK: - Reads

  /// getPermissionTier() — iOS `permissions().tier() -> AuthorizationTier` (surface line 60).
  @objc(getPermissionTierOnResolve:onReject:)
  public static func getPermissionTier(onResolve: @escaping (NSString) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let tier = Tracker.shared.permissions().tier()
      onResolve(TrackerMappers.permissionTier(tier) as NSString)
    }
  }

  /// getAccuracy() — iOS `permissions().accuracy() -> LocationAccuracy` (surface line 61).
  @objc(getAccuracyOnResolve:onReject:)
  public static func getAccuracy(onResolve: @escaping (NSString) -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let accuracy = Tracker.shared.permissions().accuracy()
      onResolve(TrackerMappers.accuracyAuthorization(accuracy) as NSString)
    }
  }

  /// shouldStopAsking(attempts) — iOS `shouldStopAsking(attempts: Int) -> Bool` (surface line 67).
  /// Number crosses as double; the .mm casts to NSInteger before this selector.
  @objc(shouldStopAskingAttempts:onResolve:onReject:)
  public static func shouldStopAsking(attempts: Int,
                                      onResolve: @escaping (NSNumber) -> Void,
                                      onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let stop = Tracker.shared.permissions().shouldStopAsking(attempts: attempts)
      onResolve(NSNumber(value: stop))
    }
  }

  /// getBackgroundRequest() — iOS has no non-prompting background query; maps this to the
  /// `requestAlways()` result shape (surface line 64). If already determined, requestAlways()
  /// returns immediately without a system prompt.
  @objc(getBackgroundRequestOnResolve:onReject:)
  public static func getBackgroundRequest(onResolve: @escaping (NSDictionary) -> Void,
                                          onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let req = await Tracker.shared.permissions().requestAlways()
      onResolve(["kind": backgroundRequestKind(req)] as NSDictionary)
    }
  }

  // MARK: - Requests

  /// requestForeground() — iOS `requestWhenInUse() async -> AuthorizationTier` (surface line 63).
  @objc(requestForegroundOnResolve:onReject:)
  public static func requestForeground(onResolve: @escaping (NSString) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let tier = await Tracker.shared.permissions().requestWhenInUse()
      onResolve(TrackerMappers.permissionTier(tier) as NSString)
    }
  }

  /// requestBackground() — iOS `requestAlways() async -> BackgroundRequest` (surface line 64),
  /// synthesised to { kind }.
  @objc(requestBackgroundOnResolve:onReject:)
  public static func requestBackground(onResolve: @escaping (NSDictionary) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let req = await Tracker.shared.permissions().requestAlways()
      onResolve(["kind": backgroundRequestKind(req)] as NSDictionary)
    }
  }

  /// openAppSettings() — iOS `settingsURL` (surface line 68) opened via UIApplication.
  /// Resolves true when the OS accepted the open request.
  @objc(openAppSettingsOnResolve:onReject:)
  public static func openAppSettings(onResolve: @escaping (NSNumber) -> Void,
                                     onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let url = Tracker.shared.permissions().settingsURL
      UIApplication.shared.open(url, options: [:]) { success in
        onResolve(NSNumber(value: success))
      }
    }
  }

  // MARK: - iOS-only

  /// ios.requestMotion() — iOS `requestMotion() async -> MotionAuthorization` (surface line 65).
  /// rawValue is already the wire vocabulary.
  @objc(iosRequestMotionOnResolve:onReject:)
  public static func iosRequestMotion(onResolve: @escaping (NSString) -> Void,
                                      onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let auth = await Tracker.shared.permissions().requestMotion()
      onResolve(auth.rawValue as NSString)
    }
  }

  /// ios.getMotionAuthorization() — iOS `motionAuthorization() -> MotionAuthorization` (surface line 62).
  @objc(iosGetMotionAuthorizationOnResolve:onReject:)
  public static func iosGetMotionAuthorization(onResolve: @escaping (NSString) -> Void,
                                               onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let auth = Tracker.shared.permissions().motionAuthorization()
      onResolve(auth.rawValue as NSString)
    }
  }

  /// ios.requestTemporaryFullAccuracy(purposeKey) — iOS
  /// `requestTemporaryFullAccuracy(purposeKey: String) async -> LocationAccuracy` (surface line 66).
  @objc(iosRequestTemporaryFullAccuracyPurposeKey:onResolve:onReject:)
  public static func iosRequestTemporaryFullAccuracy(purposeKey: NSString,
                                                     onResolve: @escaping (NSString) -> Void,
                                                     onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let accuracy = await Tracker.shared.permissions().requestTemporaryFullAccuracy(purposeKey: purposeKey as String)
      onResolve(TrackerMappers.accuracyAuthorization(accuracy) as NSString)
    }
  }

  // MARK: - Android-only → reject on iOS

  /// android.hasActivityRecognition() — Android-only; rejects on iOS.
  @objc(androidHasActivityRecognitionOnResolve:onReject:)
  public static func androidHasActivityRecognition(onResolve: @escaping (NSNumber) -> Void,
                                                   onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidHasActivityRecognition() is Android-only; not available on iOS")
  }

  /// android.requestActivityRecognition() — Android-only; rejects on iOS.
  @objc(androidRequestActivityRecognitionOnResolve:onReject:)
  public static func androidRequestActivityRecognition(onResolve: @escaping (NSNumber) -> Void,
                                                       onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidRequestActivityRecognition() is Android-only; not available on iOS")
  }

  /// android.hasNotificationPermission() — Android-only; rejects on iOS.
  @objc(androidHasNotificationPermissionOnResolve:onReject:)
  public static func androidHasNotificationPermission(onResolve: @escaping (NSNumber) -> Void,
                                                      onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidHasNotificationPermission() is Android-only; not available on iOS")
  }

  /// android.requestNotification() — Android-only; rejects on iOS.
  @objc(androidRequestNotificationOnResolve:onReject:)
  public static func androidRequestNotification(onResolve: @escaping (NSNumber) -> Void,
                                                onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidRequestNotification() is Android-only; not available on iOS")
  }

  // MARK: - Device integrity + online licence → Android-only, reject on iOS

  // The device-integrity layer and the online licence check are Android-only surfaces. iOS 1.0.0
  // has neither: TrackerCore ships the offline gate (licenseMissing/licenseInvalid/
  // licenseBundleMismatch) plus its own `licenseDeactivated` event, and no integrity probes at
  // all. These reject rather than resolving an empty report on purpose — a report claiming
  // `waived: false, findings: []` would assert this device was probed and found clean, which is
  // exactly the claim iOS cannot make.

  /// android.integrity() — Android-only; rejects on iOS.
  @objc(androidIntegrityOnResolve:onReject:)
  public static func androidIntegrity(onResolve: @escaping (NSString) -> Void,
                                      onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidIntegrity() is Android-only; not available on iOS")
  }

  /// android.checkIntegrity() — Android-only; rejects on iOS.
  @objc(androidCheckIntegrityOnResolve:onReject:)
  public static func androidCheckIntegrity(onResolve: @escaping (NSString) -> Void,
                                           onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidCheckIntegrity() is Android-only; not available on iOS")
  }

  /// android.licenseInfo() — Android-only; rejects on iOS. The iOS licence surface is the
  /// `licenseDeactivated` event, which carries an untyped status string and only fires to
  /// deactivate; there is no cached verdict to read.
  @objc(androidLicenseInfoOnResolve:onReject:)
  public static func androidLicenseInfo(onResolve: @escaping (NSString) -> Void,
                                        onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidLicenseInfo() is Android-only; not available on iOS")
  }

  /// android.checkLicense() — Android-only; rejects on iOS.
  @objc(androidCheckLicenseOnResolve:onReject:)
  public static func androidCheckLicense(onResolve: @escaping (NSString) -> Void,
                                         onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidCheckLicense() is Android-only; not available on iOS")
  }

  // MARK: - BackgroundRequest union → wire kind

  /// iOS `BackgroundRequest` (surface lines 52-58) → wire kind string. The associated `URL` on
  /// `.needsSettings` stays native (openAppSettings() acts on settingsURL); `needsWhenInUseFirst`
  /// maps to the wire's `needsForegroundFirst`.
  private static func backgroundRequestKind(_ req: BackgroundRequest) -> String {
    switch req {
    case .alreadyGranted: return "alreadyGranted"
    case .granted: return "granted"
    case .denied: return "denied"
    case .needsWhenInUseFirst: return "needsForegroundFirst"
    case .needsSettings: return "needsSettings"
    }
  }
}