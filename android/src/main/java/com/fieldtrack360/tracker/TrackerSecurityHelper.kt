package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.facebook.react.bridge.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// Device integrity + the online licence check — both Android-only, so the whole file has no iOS
// twin; the iOS module answers these four methods with `unsupportedOnPlatform`. Thin transport
// over the facade; all wire vocabulary lives in TrackerMappers.
//
// Both surfaces cross as JSON STRINGS rather than codegen-typed maps: IntegrityReport carries an
// unbounded `findings` list, and LicenseInfo can be absent entirely (no check has completed yet),
// which the wire expresses as the literal "null" — a codegen object type has no way to say that.
//
// The whole integrity layer is waived on a debuggable install. `integrity()` there returns a
// report with `waived = true` and no findings; that is NOT a clean device, and the mapper carries
// the flag across precisely so the host can tell the two apart.
object Security {

  // integrity() — the last evaluation. Synchronous on the facade (already in hand), so it
  // resolves inline without touching the scope.
  fun integrity(facade: Tracker, promise: Promise) {
    try {
      promise.resolve(TrackerMappers.integrityReportJson(facade.integrity()).toString())
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "integrity failed", t)
    }
  }

  // checkIntegrity() — forces a fresh evaluation. Suspend, and genuinely expensive: it reads
  // /proc, enumerates visible packages and opens a loopback socket. Never call it per frame.
  fun checkIntegrity(facade: Tracker, scope: CoroutineScope, promise: Promise) {
    scope.launch {
      try {
        promise.resolve(TrackerMappers.integrityReportJson(facade.checkIntegrity()).toString())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "checkIntegrity failed", t)
      }
    }
  }

  // licenseInfo() — the cached verdict, or the literal "null" when no check has completed. Costs
  // no network. "null" means NOT CHECKED, which is not a refusal; a host that renders it as one
  // shows a licence warning to every user during the first seconds after ready().
  fun licenseInfo(facade: Tracker, scope: CoroutineScope, promise: Promise) {
    scope.launch {
      try {
        val info = facade.licenseInfo()
        promise.resolve(
          if (info == null) "null" else TrackerMappers.licenseInfoJson(info).toString()
        )
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "licenseInfo failed", t)
      }
    }
  }

  // checkLicense() — asks the licence server now. Fail-open by design: a network failure or an
  // unverifiable response is not an error here, it resolves whatever verdict is cached (possibly
  // "null"). Reading a server outage as a refusal would stop a paying customer.
  fun checkLicense(facade: Tracker, scope: CoroutineScope, promise: Promise) {
    scope.launch {
      try {
        val info = facade.checkLicense()
        promise.resolve(
          if (info == null) "null" else TrackerMappers.licenseInfoJson(info).toString()
        )
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "checkLicense failed", t)
      }
    }
  }
}
