package com.fieldtrack360.tracker.rnsample

import android.app.Application
import com.fieldtrack360.tracker.TrackerLaunch
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Android parity: no launch-window trap, but the SDK recommends Application.onCreate
    // for filter-state restore timing. Optional on Android, required on iOS.
    TrackerLaunch.ready(this)
    loadReactNative(this)
  }
}
